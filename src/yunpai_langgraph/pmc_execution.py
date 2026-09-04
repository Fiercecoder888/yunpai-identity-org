"""PMC P2 执行闭环的本地最小实现（fixture 语义 + 持久化骨架）。

任务书/PMC P2：派工确认、开完工、报工、良品/报废、停机、执行偏差全部事件化
回写 plan/WIP，带 TaskID 与 trace；M5→M3/M4 物料影响只允许 proposal，不直接写
库存/采购事实；solver/audit/knowledge 只读。

边界声明：
- 本模块只做“本地耐久记录/汇总/proposal”，不发送 MES、不采集现场、不写 M0/M3/M4
  的 canonical 事实；部署方提供真实 M5 URL 时由 registry bind_http 覆盖同名单工具。
- 每次写入幂等受理（plan_version + idempotency_key 唯一），缺失必填字段抛错。
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DISPATCH_STATUSES = ("pending", "confirmed", "retry", "cancelled")
EXECUTION_EVENT_TYPES = ("start", "complete", "report", "scrap", "downtime", "deviation")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PmcExecutionStore:
    """本地执行事件与派工记录（单机 SQLite；生产由真实 M5 服务承担）。"""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        with sqlite3.connect(self.path) as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS dispatch_records (
                    dispatch_id TEXT PRIMARY KEY,
                    plan_version TEXT NOT NULL,
                    operation_key TEXT NOT NULL,
                    order_id TEXT,
                    status TEXT NOT NULL,
                    worker_id TEXT,
                    idempotency_key TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(plan_version, idempotency_key, operation_key)
                )
            """)
            db.execute("""
                CREATE TABLE IF NOT EXISTS execution_events (
                    event_id TEXT PRIMARY KEY,
                    plan_version TEXT NOT NULL,
                    operation_key TEXT,
                    order_id TEXT,
                    worker_id TEXT,
                    event_type TEXT NOT NULL,
                    qty_good REAL,
                    qty_scrap REAL,
                    downtime_minutes REAL,
                    note TEXT,
                    idempotency_key TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    reported_at TEXT NOT NULL,
                    UNIQUE(plan_version, idempotency_key)
                )
            """)
            db.execute("""
                CREATE TABLE IF NOT EXISTS material_impact_proposals (
                    proposal_id TEXT PRIMARY KEY,
                    plan_version TEXT NOT NULL,
                    scenario_id TEXT NOT NULL,
                    material_code TEXT NOT NULL,
                    required_qty REAL NOT NULL,
                    required_date TEXT,
                    proposal_status TEXT NOT NULL DEFAULT 'suggested',
                    target_module TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(plan_version, idempotency_key, material_code)
                )
            """)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    def create_dispatch(self, *, plan_version: str, operation_keys: list[str], order_id: str, worker_id: str, idempotency_key: str, task_id: str) -> dict[str, Any]:
        """为 released 计划创建 pending 派工记录；不发送 MES，初始状态只能 pending。"""
        if not operation_keys:
            raise ValueError("dispatch requires operation_keys")
        if not idempotency_key:
            raise ValueError("dispatch requires idempotency_key")
        with self._connect() as db:
            existing = db.execute("SELECT count(*) AS c FROM dispatch_records WHERE plan_version=? AND idempotency_key=?", (plan_version, idempotency_key)).fetchone()
            if existing and existing["c"]:
                return {"status": "pending_replay", "plan_version": plan_version, "idempotency_key": idempotency_key, "record_count": existing["c"], "sent_to_mes": False}
            now = utc_now()
            for index, operation_key in enumerate(operation_keys, start=1):
                dispatch_id = f"disp-{plan_version}-{index}-{abs(hash(idempotency_key)) % 1000000}"
                db.execute(
                    """INSERT OR REPLACE INTO dispatch_records(dispatch_id, plan_version, operation_key, order_id, status, worker_id, idempotency_key, task_id, created_at, updated_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (dispatch_id, plan_version, operation_key, order_id, "pending", worker_id, idempotency_key, task_id, now, now),
                )
            return {"status": "pending_created", "plan_version": plan_version, "dispatch_count": len(operation_keys), "sent_to_mes": False, "detail": "本地耐久待派工记录；无 MES sender，未发送、未谎称已发送"}

    def confirm_dispatch(self, *, plan_version: str, dispatch_id: str, action: str, actor: str = "operator") -> dict[str, Any]:
        """派工确认/重试：pending -> confirmed / retry（重试回到 pending）。"""
        if action not in {"confirm", "retry"}:
            raise ValueError(f"unsupported dispatch action: {action}")
        with self._connect() as db:
            row = db.execute("SELECT status FROM dispatch_records WHERE plan_version=? AND dispatch_id=?", (plan_version, dispatch_id)).fetchone()
            if row is None:
                raise ValueError(f"dispatch record not found: {dispatch_id}")
            if row["status"] == "cancelled":
                raise ValueError(f"dispatch record cancelled: {dispatch_id}")
            target = "confirmed" if action == "confirm" else "pending"
            now = utc_now()
            db.execute("UPDATE dispatch_records SET status=?, updated_at=? WHERE plan_version=? AND dispatch_id=?", (target, now, plan_version, dispatch_id))
            return {"plan_version": plan_version, "dispatch_id": dispatch_id, "from_status": row["status"], "to_status": target, "actor": actor}

    def record_event(self, *, plan_version: str, event_type: str, worker_id: str, order_id: str, idempotency_key: str, task_id: str, operation_key: str = "", qty_good: float | None = None, qty_scrap: float | None = None, downtime_minutes: float | None = None, note: str = "") -> dict[str, Any]:
        """幂等受理执行事件（开工/完工/报工/报废/停机/偏差）。"""
        if event_type not in EXECUTION_EVENT_TYPES:
            raise ValueError(f"unsupported execution event: {event_type}")
        if not worker_id or not order_id:
            raise ValueError("execution event requires worker_id and order_id")
        if not idempotency_key:
            raise ValueError("execution event requires idempotency_key")
        with self._connect() as db:
            row = db.execute("SELECT event_id FROM execution_events WHERE plan_version=? AND idempotency_key=?", (plan_version, idempotency_key)).fetchone()
            if row:
                return {"status": "replayed", "event_id": row["event_id"], "plan_version": plan_version, "idempotency_key": idempotency_key}
            event_id = f"evt-{plan_version}-{abs(hash(idempotency_key)) % 1000000}"
            now = utc_now()
            db.execute(
                """INSERT INTO execution_events(event_id, plan_version, operation_key, order_id, worker_id, event_type, qty_good, qty_scrap, downtime_minutes, note, idempotency_key, task_id, reported_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (event_id, plan_version, operation_key, order_id, worker_id, event_type, qty_good, qty_scrap, downtime_minutes, note, idempotency_key, task_id, now),
            )
            return {"status": "recorded", "event_id": event_id, "plan_version": plan_version, "event_type": event_type, "task_id": task_id, "sent_to_mes": False}

    def execution_summary(self, plan_version: str) -> dict[str, Any]:
        """只汇总本地已持久化事件；不证明车间完整执行。"""
        with self._connect() as db:
            count = db.execute("SELECT count(*) AS c FROM execution_events WHERE plan_version=?", (plan_version,)).fetchone()["c"]
            latest = db.execute("SELECT reported_at FROM execution_events WHERE plan_version=? ORDER BY reported_at DESC LIMIT 1", (plan_version,)).fetchone()
            by_type = db.execute("SELECT event_type, count(*) AS c FROM execution_events WHERE plan_version=? GROUP BY event_type", (plan_version,)).fetchall()
            scrap = db.execute("SELECT COALESCE(SUM(qty_scrap), 0) AS s FROM execution_events WHERE plan_version=? AND qty_scrap IS NOT NULL", (plan_version,)).fetchone()["s"]
        return {
            "plan_version": plan_version,
            "event_count": count,
            "latest_event_at": latest["reported_at"] if latest else None,
            "by_type": {item["event_type"]: item["c"] for item in by_type},
            "total_scrap_qty": scrap or 0,
            "scope_note": "仅汇总本地持久化事件，不采集现场数据；HTTP transport 下由真实 M5 execution-summary 提供",
        }

    def propose_material_impact(self, *, plan_version: str, scenario_id: str, impacts: list[dict[str, Any]], target_module: str, idempotency_key: str, task_id: str) -> dict[str, Any]:
        """M5→M3/M4 物料影响只写 proposal（suggested），绝不直接写库存/采购事实。"""
        if target_module not in {"m3", "m4"}:
            raise ValueError("material impact proposal target_module must be m3 or m4")
        if not impacts:
            raise ValueError("material impact requires impacts")
        created = []
        with self._connect() as db:
            now = utc_now()
            for index, impact in enumerate(impacts, start=1):
                material_code = str(impact.get("material_code") or "")
                if not material_code:
                    raise ValueError(f"impact[{index}] missing material_code")
                proposal_id = f"prop-{plan_version}-{material_code}-{abs(hash(idempotency_key)) % 1000000}"
                db.execute(
                    """INSERT OR REPLACE INTO material_impact_proposals(proposal_id, plan_version, scenario_id, material_code, required_qty, required_date, proposal_status, target_module, idempotency_key, task_id, created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (proposal_id, plan_version, scenario_id, material_code, float(impact.get("required_qty") or 0), impact.get("required_date"), "suggested", target_module, idempotency_key, task_id, now),
                )
                created.append({"proposal_id": proposal_id, "material_code": material_code, "required_qty": impact.get("required_qty"), "proposal_status": "suggested"})
        return {"proposal_status": "suggested", "target_module": target_module, "proposals": created, "detail": "proposal 未生效；是否写入库存/采购由 M3/M4 授权 Gate 决定"}
