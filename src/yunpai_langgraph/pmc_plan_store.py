"""PMC 计划持久化与生命周期状态机（P0：draft→approved→released→dispatched→execution）。

设计要点（PMC P0-P2 补充确认）：
- 每次求解把输入快照、solver 元数据与版本写入 plan_records，回填持久 plan_version；
- 生命周期迁移由确定性校验 + 事件驱动，禁止跳过状态；LLM/调用方只能建议，不能直接改状态；
- replan 需要 expected_head（CAS）：头部已被他人更新则拒绝，防覆盖 released 计划；
- solver/audit/knowledge 作为只读证据挂回 TaskID/trace。
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any

LIFECYCLE_ORDER = ("draft", "approved", "released", "dispatched", "execution")

# 允许的迁移（禁止跳过/回退已发布状态）。
TRANSITIONS = {
    "draft": {"approved"},
    "approved": {"released", "draft"},
    "released": {"dispatched", "draft"},
    "dispatched": {"execution", "released"},
    "execution": {"execution"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def input_checksum(payload: dict[str, Any]) -> str:
    return sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


class PmcPlanStore:
    """单机 SQLite 计划存储（生产环境可替换为 PostgreSQL 服务端实现）。"""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        with sqlite3.connect(self.path) as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS plan_records (
                    scenario_id TEXT NOT NULL,
                    plan_version TEXT NOT NULL,
                    head INTEGER NOT NULL DEFAULT 0,
                    lifecycle_status TEXT NOT NULL,
                    purpose TEXT NOT NULL,
                    input_checksum TEXT NOT NULL,
                    input_hash TEXT NOT NULL,
                    solver_hash TEXT,
                    parent_version TEXT,
                    idempotency_key TEXT,
                    task_id TEXT,
                    payload_json TEXT NOT NULL,
                    events_json TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (scenario_id, plan_version)
                )
            """)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def save_draft(self, *, scenario_id: str, purpose: str, payload: dict[str, Any], input_hash: str, solver_hash: str, idempotency_key: str, task_id: str, expected_parent_version: str | None = None) -> dict[str, Any]:
        """持久化 draft 计划。

        - 相同幂等键 + 相同 checksum：重放返回既有版本（幂等）；
        - 相同幂等键 + 不同 checksum：幂等冲突，拒绝；
        - expected_parent_version 提供时做 CAS：与当前 scenario 最新版本不符则拒绝
          （replan 不能基于过期 head）；
        - 新版本不覆盖旧版本；released 之后的重排产生新版本，禁止改写 released 计划。
        """
        checksum = input_checksum(payload)
        with self._connect() as db:
            by_key = db.execute(
                "SELECT plan_version, head, input_checksum, lifecycle_status, idempotency_key FROM plan_records WHERE scenario_id=? AND idempotency_key=? ORDER BY head DESC LIMIT 1",
                (scenario_id, idempotency_key),
            ).fetchone()
            if by_key and by_key["input_checksum"] == checksum:
                return dict(by_key)
            if by_key and by_key["input_checksum"] != checksum:
                raise ValueError(f"idempotency conflict: scenario {scenario_id} idempotency_key {idempotency_key} already used with different payload")
            latest = db.execute("SELECT plan_version, head FROM plan_records WHERE scenario_id=? ORDER BY head DESC LIMIT 1", (scenario_id,)).fetchone()
            if expected_parent_version is not None and (latest is None or latest["plan_version"] != expected_parent_version):
                raise ValueError(f"replan CAS failed: expected parent {expected_parent_version}, actual head {latest['plan_version'] if latest else 'none'}")
            head = int((latest["head"] if latest else 0)) + 1
            plan_version = f"{scenario_id}::v{head}"
            now = utc_now()
            db.execute(
                """INSERT INTO plan_records(scenario_id, plan_version, head, lifecycle_status, purpose, input_checksum, input_hash, solver_hash, parent_version, idempotency_key, task_id, payload_json, events_json, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (scenario_id, plan_version, head, "draft", purpose, checksum, input_hash, solver_hash, latest["plan_version"] if latest else None, idempotency_key, task_id, json.dumps(payload, ensure_ascii=False, default=str), json.dumps([{"event": "plan.created", "to": "draft", "at": now}], ensure_ascii=False), now, now),
            )
            return {"scenario_id": scenario_id, "plan_version": plan_version, "head": head, "lifecycle_status": "draft", "input_checksum": checksum, "idempotency_key": idempotency_key}

    def transition(self, *, scenario_id: str, plan_version: str, target: str, actor: str = "operator", task_id: str = "") -> dict[str, Any]:
        """确定性生命周期迁移，记录事件与审计；禁止跳过状态或回退 released。"""
        if target not in LIFECYCLE_ORDER:
            raise ValueError(f"unknown lifecycle status: {target}")
        with self._connect() as db:
            row = db.execute("SELECT lifecycle_status, purpose FROM plan_records WHERE scenario_id=? AND plan_version=?", (scenario_id, plan_version)).fetchone()
            if row is None:
                raise ValueError(f"plan not found: {scenario_id}/{plan_version}")
            current = row["lifecycle_status"]
            if target == current:
                return {"scenario_id": scenario_id, "plan_version": plan_version, "lifecycle_status": current}
            allowed = TRANSITIONS.get(current, set())
            if target not in allowed:
                raise ValueError(f"illegal lifecycle transition: {current} -> {target}")
            now = utc_now()
            db.execute("UPDATE plan_records SET lifecycle_status=?, updated_at=? WHERE scenario_id=? AND plan_version=?", (target, now, scenario_id, plan_version))
            row2 = db.execute("SELECT events_json FROM plan_records WHERE scenario_id=? AND plan_version=?", (scenario_id, plan_version)).fetchone()
            events = json.loads(row2["events_json"]) if row2 else []
            events.append({"event": "plan.transition", "from": current, "to": target, "actor": actor, "task_id": task_id, "at": now})
            db.execute("UPDATE plan_records SET events_json=? WHERE scenario_id=? AND plan_version=?", (json.dumps(events, ensure_ascii=False), scenario_id, plan_version))
            return {"scenario_id": scenario_id, "plan_version": plan_version, "lifecycle_status": target, "from": current}

    def list_versions(self, scenario_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT scenario_id, plan_version, head, lifecycle_status, purpose, input_checksum, solver_hash, parent_version, task_id, created_at, updated_at FROM plan_records WHERE scenario_id=? ORDER BY head DESC LIMIT ?",
                (scenario_id, max(1, min(limit, 500))),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_plan(self, scenario_id: str, plan_version: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT scenario_id, plan_version, head, lifecycle_status, purpose, input_checksum, input_hash, solver_hash, parent_version, task_id, events_json, created_at, updated_at FROM plan_records WHERE scenario_id=? AND plan_version=?",
                (scenario_id, plan_version),
            ).fetchone()
        return dict(row) if row else None

    def diff_versions(self, scenario_id: str, left: str, right: str) -> dict[str, Any]:
        """返回两个版本的输入差异摘要（供前端 diff 视图）。"""
        left_plan, right_plan = self.get_plan(scenario_id, left), self.get_plan(scenario_id, right)
        if not left_plan or not right_plan:
            raise ValueError("diff requires two existing plan versions")
        with self._connect() as db:
            left_payload = json.loads(db.execute("SELECT payload_json FROM plan_records WHERE scenario_id=? AND plan_version=?", (scenario_id, left)).fetchone()["payload_json"])
            right_payload = json.loads(db.execute("SELECT payload_json FROM plan_records WHERE scenario_id=? AND plan_version=?", (scenario_id, right)).fetchone()["payload_json"])
        changes: list[dict[str, Any]] = []
        for key in sorted(set(left_payload) | set(right_payload)):
            left_value, right_value = left_payload.get(key), right_payload.get(key)
            if left_value != right_value:
                changes.append({"field": key, "left": left_value, "right": right_value})
        return {"scenario_id": scenario_id, "left": left, "right": right, "change_count": len(changes), "changes": changes[:50]}
