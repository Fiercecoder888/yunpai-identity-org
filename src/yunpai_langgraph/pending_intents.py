"""会话内「待补全意图」持久化：反问一轮、下一轮接着执行。

场景：厂长在会话里说「帮我给几个人建个账号」但没给名字——AI 不能瞎猜，要**反问**；
用户下一条消息回答后，AI 必须带着「上一轮已经确定的工具与参数」继续执行。反问与
回答之间隔着两个 HTTP 请求，进程内内存不可靠（多 worker / 重启 / 多端），所以把
「工具 + 已抽到的参数 + 还缺哪些槽位 + 反问话术」按 ``(tenant_id, conversation_id)``
落 sqlite。

设计取舍：
- **每次操作新建连接、用后即关**（``db_utils.transactional``）：避免长连接持锁，
  多 worker 并发下也不会把库锁死；
- **TTL 默认 30 分钟**：过期视为不存在，读取时顺手删除（用户隔夜再回一句「张伟」，
  不应突然触发昨天的建账号）；
- **读写一律容错**：``payload_json`` 解析失败、时间戳脏、库打不开 → 当作「没有待补全
  意图」（读返回 None / 0，写静默放弃），绝不因为一条脏行打断整轮对话；
- 表结构只在构造时 ``CREATE TABLE IF NOT EXISTS``，不做迁移（新表，无历史数据）。
"""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

from .db_utils import connect_sqlite, enable_wal, transactional

#: 待补全意图的存活时长（秒）；超过即视为「用户已经换了话题」。
DEFAULT_TTL_SECONDS = 1800

_DEFAULT_DB_ENV = "YUNPAI_RUN_DB"
_DEFAULT_DB_PATH = "runtime/yunpai-runs.sqlite"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS pending_intents (
    tenant_id       TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, conversation_id)
)
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_timestamp(raw: Any) -> datetime | None:
    """解析 UTC ISO 字符串；无法解析返回 None（调用方按「过期」处理）。"""
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        # 老数据可能没带时区；按 UTC 解释，避免 naive/aware 相减抛 TypeError。
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _coerce_ttl(ttl_seconds: Any) -> float:
    try:
        return float(ttl_seconds)
    except (TypeError, ValueError):
        return float(DEFAULT_TTL_SECONDS)


def _is_expired(updated_at: Any, ttl_seconds: float) -> bool:
    """脏时间戳一律按过期处理：宁可重新反问，也不要拿一条来路不明的时间戳执行。

    用 ``>=`` 比较，保证 ``ttl_seconds=0`` 时刚写入的行也立即算过期（测试与
    「只允许同一轮内续接」的调用方都依赖这个边界）。
    """
    parsed = _parse_timestamp(updated_at)
    if parsed is None:
        return True
    return (datetime.now(timezone.utc) - parsed).total_seconds() >= ttl_seconds


class PendingIntentStore:
    """会话内「待补全意图」：sqlite 表 ``pending_intents(tenant_id, conversation_id,
    payload_json, updated_at)``，主键 ``(tenant_id, conversation_id)``。

    TTL 默认 30 分钟，过期视为不存在。
    """

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = str(db_path or os.getenv(_DEFAULT_DB_ENV, _DEFAULT_DB_PATH))
        parent = os.path.dirname(os.path.abspath(self.db_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._init()

    # -- 内部 ---------------------------------------------------------------

    def _init(self) -> None:
        with transactional(connect_sqlite(self.db_path)) as db:
            enable_wal(db)
            db.execute(_SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        return connect_sqlite(self.db_path)

    # -- 对外 ---------------------------------------------------------------

    def save(self, *, tenant_id: str, conversation_id: str, tool: str,
             args: dict, missing: list[str], question: str) -> None:
        """写入（同键覆盖）一条待补全意图；``updated_at`` 为 UTC ISO 字符串。"""
        payload = {
            "tool": tool,
            "args": args,
            "missing": missing,
            "question": question,
        }
        try:
            # ensure_ascii=False：库里存可读中文，便于人工排查；default=str 兜底
            # 非 JSON 类型（如 datetime/Path），不让一个怪参数把整轮对话打崩。
            payload_json = json.dumps(payload, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            payload_json = json.dumps(
                {"tool": str(tool), "args": {}, "missing": [], "question": str(question)},
                ensure_ascii=False,
            )
        try:
            with transactional(self._connect()) as db:
                db.execute(
                    "INSERT OR REPLACE INTO pending_intents"
                    "(tenant_id, conversation_id, payload_json, updated_at) VALUES (?,?,?,?)",
                    (str(tenant_id), str(conversation_id), payload_json, _now_iso()),
                )
        except sqlite3.Error:
            # 落库失败不打断本轮对话：调用方下一轮只是拿不到待补全意图。
            return None
        return None

    def load(self, *, tenant_id: str, conversation_id: str,
             ttl_seconds: int = DEFAULT_TTL_SECONDS) -> dict | None:
        """读回 ``{"tool","args","missing","question","updated_at"}``；过期/不存在 → None。

        过期时顺手删除；``payload_json`` 脏（非法 JSON / 非对象）同样视为不存在。
        """
        tenant = str(tenant_id)
        conversation = str(conversation_id)
        ttl = _coerce_ttl(ttl_seconds)
        try:
            with transactional(self._connect()) as db:
                row = db.execute(
                    "SELECT payload_json, updated_at FROM pending_intents "
                    "WHERE tenant_id=? AND conversation_id=?",
                    (tenant, conversation),
                ).fetchone()
                if row is None:
                    return None
                payload_json, updated_at = row[0], row[1]
                if _is_expired(updated_at, ttl):
                    db.execute(
                        "DELETE FROM pending_intents WHERE tenant_id=? AND conversation_id=?",
                        (tenant, conversation),
                    )
                    return None
        except sqlite3.Error:
            return None
        try:
            payload = json.loads(payload_json)
        except (TypeError, ValueError):
            return None
        if not isinstance(payload, dict):
            return None
        args = payload.get("args")
        missing = payload.get("missing")
        return {
            "tool": payload.get("tool") if isinstance(payload.get("tool"), str) else "",
            "args": args if isinstance(args, dict) else {},
            "missing": [str(item) for item in missing] if isinstance(missing, list) else [],
            "question": payload.get("question") if isinstance(payload.get("question"), str) else "",
            "updated_at": updated_at if isinstance(updated_at, str) else "",
        }

    def clear(self, *, tenant_id: str, conversation_id: str) -> None:
        """删除该会话的待补全意图（用户换话题 / 意图已执行完时调用）。"""
        try:
            with transactional(self._connect()) as db:
                db.execute(
                    "DELETE FROM pending_intents WHERE tenant_id=? AND conversation_id=?",
                    (str(tenant_id), str(conversation_id)),
                )
        except sqlite3.Error:
            return None
        return None

    def purge_expired(self, *, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> int:
        """清理所有过期行（含时间戳脏的行），返回删除行数。"""
        ttl = _coerce_ttl(ttl_seconds)
        try:
            with transactional(self._connect()) as db:
                rows = db.execute(
                    "SELECT tenant_id, conversation_id, updated_at FROM pending_intents"
                ).fetchall()
                doomed = [(row[0], row[1]) for row in rows if _is_expired(row[2], ttl)]
                if doomed:
                    db.executemany(
                        "DELETE FROM pending_intents WHERE tenant_id=? AND conversation_id=?",
                        doomed,
                    )
                return len(doomed)
        except sqlite3.Error:
            return 0
