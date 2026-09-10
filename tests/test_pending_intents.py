"""``pending_intents`` 的持久化契约：反问一轮 → 下一轮带着参数续执行。

覆盖：往返完整性与中文编码、同键覆盖、会话/租户隔离、clear、TTL 过期即删、
脏数据不抛异常、purge_expired 计数、默认 db 路径来自环境变量。
"""

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from yunpai_langgraph.pending_intents import DEFAULT_TTL_SECONDS, PendingIntentStore

TENANT = "tenant-a"
CONVERSATION = "conv-1"


def _intent(**overrides):
    payload = {
        "tenant_id": TENANT,
        "conversation_id": CONVERSATION,
        "tool": "create_identity_user",
        "args": {"people": ["张伟", "李娜"], "role": "worker", "org_name": "装配班组"},
        "missing": ["user_id"],
        "question": "要给哪几位工人建账号？请给出姓名或工号。",
    }
    payload.update(overrides)
    return payload


def _store(tmp_path):
    return PendingIntentStore(str(tmp_path / "runs.sqlite"))


def _raw_rows(store):
    db = sqlite3.connect(store.db_path)
    try:
        return db.execute(
            "SELECT tenant_id, conversation_id, payload_json, updated_at FROM pending_intents"
        ).fetchall()
    finally:
        db.close()


def _raw_insert(store, *, tenant_id, conversation_id, payload_json, updated_at):
    """绕过 save 直接写行，用于构造脏数据 / 过期数据。"""
    db = sqlite3.connect(store.db_path)
    try:
        with db:
            db.execute(
                "INSERT OR REPLACE INTO pending_intents"
                "(tenant_id, conversation_id, payload_json, updated_at) VALUES (?,?,?,?)",
                (tenant_id, conversation_id, payload_json, updated_at),
            )
    finally:
        db.close()


def _ago(seconds):
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


def test_save_then_load_roundtrip_keeps_fields_and_chinese(tmp_path):
    store = _store(tmp_path)
    store.save(**_intent())

    loaded = store.load(tenant_id=TENANT, conversation_id=CONVERSATION)

    assert loaded is not None
    assert set(loaded) == {"tool", "args", "missing", "question", "updated_at"}
    assert loaded["tool"] == "create_identity_user"
    assert loaded["args"] == {"people": ["张伟", "李娜"], "role": "worker", "org_name": "装配班组"}
    assert loaded["missing"] == ["user_id"]
    assert loaded["question"] == "要给哪几位工人建账号？请给出姓名或工号。"
    # updated_at 是 UTC ISO 字符串且能被解析
    assert isinstance(loaded["updated_at"], str) and loaded["updated_at"]
    parsed = datetime.fromisoformat(loaded["updated_at"])
    assert parsed.tzinfo is not None
    # 中文按 UTF-8 存原文，不是 \uXXXX 转义
    raw_payload = _raw_rows(store)[0][2]
    assert "张伟" in raw_payload and "\\u5f20" not in raw_payload
    assert json.loads(raw_payload)["args"]["people"] == ["张伟", "李娜"]


def test_same_conversation_overwrites_single_row(tmp_path):
    store = _store(tmp_path)
    store.save(**_intent())
    store.save(**_intent(
        tool="assign_identity_account",
        args={"user_id": "worker001"},
        missing=["org_name"],
        question="要把 worker001 调到哪个部门？",
    ))

    loaded = store.load(tenant_id=TENANT, conversation_id=CONVERSATION)

    assert loaded["tool"] == "assign_identity_account"
    assert loaded["missing"] == ["org_name"]
    assert len(_raw_rows(store)) == 1


def test_conversations_are_isolated(tmp_path):
    store = _store(tmp_path)
    store.save(**_intent(conversation_id="conv-1", question="会话一的反问"))
    store.save(**_intent(conversation_id="conv-2", question="会话二的反问"))

    assert store.load(tenant_id=TENANT, conversation_id="conv-1")["question"] == "会话一的反问"
    assert store.load(tenant_id=TENANT, conversation_id="conv-2")["question"] == "会话二的反问"
    assert store.load(tenant_id=TENANT, conversation_id="conv-3") is None
    assert len(_raw_rows(store)) == 2


def test_tenants_are_isolated(tmp_path):
    store = _store(tmp_path)
    store.save(**_intent(tenant_id="tenant-a", question="A 厂的反问"))
    store.save(**_intent(tenant_id="tenant-b", question="B 厂的反问"))

    assert store.load(tenant_id="tenant-a", conversation_id=CONVERSATION)["question"] == "A 厂的反问"
    assert store.load(tenant_id="tenant-b", conversation_id=CONVERSATION)["question"] == "B 厂的反问"
    assert store.load(tenant_id="tenant-c", conversation_id=CONVERSATION) is None
    assert len(_raw_rows(store)) == 2


def test_clear_removes_intent_and_is_idempotent(tmp_path):
    store = _store(tmp_path)
    store.save(**_intent())

    store.clear(tenant_id=TENANT, conversation_id=CONVERSATION)

    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION) is None
    assert _raw_rows(store) == []
    # 再清一次不抛异常
    store.clear(tenant_id=TENANT, conversation_id=CONVERSATION)
    store.clear(tenant_id="nobody", conversation_id="nothing")


def test_load_with_ttl_zero_returns_none_and_deletes_row(tmp_path):
    store = _store(tmp_path)
    store.save(**_intent())

    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION, ttl_seconds=0) is None
    assert _raw_rows(store) == []


def test_load_expires_stale_row_and_deletes_it(tmp_path):
    store = _store(tmp_path)
    _raw_insert(
        store,
        tenant_id=TENANT,
        conversation_id=CONVERSATION,
        payload_json=json.dumps({"tool": "create_identity_user", "args": {}, "missing": [], "question": "旧反问"}),
        updated_at=_ago(DEFAULT_TTL_SECONDS + 60),
    )

    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION) is None
    assert _raw_rows(store) == []


def test_load_tolerates_dirty_payload_json(tmp_path):
    store = _store(tmp_path)
    _raw_insert(
        store,
        tenant_id=TENANT,
        conversation_id=CONVERSATION,
        payload_json="{这不是合法 JSON",
        updated_at=datetime.now(timezone.utc).isoformat(),
    )

    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION) is None


@pytest.mark.parametrize("payload_json", ["", "null", "[1,2,3]", '"text"', "123"])
def test_load_treats_non_object_payload_as_missing(tmp_path, payload_json):
    store = _store(tmp_path)
    _raw_insert(
        store,
        tenant_id=TENANT,
        conversation_id=CONVERSATION,
        payload_json=payload_json,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )

    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION) is None


def test_load_tolerates_dirty_timestamp(tmp_path):
    store = _store(tmp_path)
    _raw_insert(
        store,
        tenant_id=TENANT,
        conversation_id=CONVERSATION,
        payload_json=json.dumps({"tool": "create_identity_user", "args": {}, "missing": [], "question": "脏时间"}),
        updated_at="not-a-timestamp",
    )

    # 时间戳无法解析 → 按过期处理，但不抛异常
    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION) is None


def test_load_normalizes_partial_payload(tmp_path):
    store = _store(tmp_path)
    _raw_insert(
        store,
        tenant_id=TENANT,
        conversation_id=CONVERSATION,
        payload_json=json.dumps({"tool": "create_identity_user"}, ensure_ascii=False),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )

    loaded = store.load(tenant_id=TENANT, conversation_id=CONVERSATION)

    assert loaded["tool"] == "create_identity_user"
    assert loaded["args"] == {}
    assert loaded["missing"] == []
    assert loaded["question"] == ""


def test_purge_expired_returns_deleted_row_count(tmp_path):
    store = _store(tmp_path)
    fresh = {"tool": "create_identity_user", "args": {}, "missing": [], "question": "新的反问"}
    stale = {"tool": "assign_identity_account", "args": {}, "missing": [], "question": "旧的反问"}
    rows = [
        (TENANT, "conv-0", fresh, datetime.now(timezone.utc).isoformat()),
        (TENANT, "conv-1", stale, _ago(DEFAULT_TTL_SECONDS + 1)),
        (TENANT, "conv-2", stale, _ago(DEFAULT_TTL_SECONDS + 1)),
        # 另一租户的过期行也一并清掉
        ("tenant-b", CONVERSATION, stale, _ago(DEFAULT_TTL_SECONDS * 10)),
    ]
    for tenant, conversation, payload, updated_at in rows:
        _raw_insert(
            store,
            tenant_id=tenant,
            conversation_id=conversation,
            payload_json=json.dumps(payload, ensure_ascii=False),
            updated_at=updated_at,
        )

    assert store.purge_expired() == 3
    assert store.purge_expired() == 0
    remaining = _raw_rows(store)
    assert len(remaining) == 1
    assert store.load(tenant_id=TENANT, conversation_id="conv-0")["question"] == "新的反问"
    assert store.load(tenant_id=TENANT, conversation_id="conv-1") is None
    assert store.load(tenant_id="tenant-b", conversation_id=CONVERSATION) is None


def test_purge_expired_with_ttl_zero_removes_everything(tmp_path):
    store = _store(tmp_path)
    store.save(**_intent(conversation_id="conv-1"))
    store.save(**_intent(conversation_id="conv-2"))

    assert store.purge_expired(ttl_seconds=0) == 2
    assert _raw_rows(store) == []


def test_default_db_path_comes_from_env_and_creates_parent(tmp_path, monkeypatch):
    target = tmp_path / "nested" / "dir" / "yunpai-runs.sqlite"
    monkeypatch.setenv("YUNPAI_RUN_DB", str(target))

    store = PendingIntentStore()

    assert store.db_path == str(target)
    assert target.parent.is_dir()
    store.save(**_intent())
    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION)["tool"] == "create_identity_user"


def test_operations_use_fresh_connections(tmp_path):
    """每次操作新建连接、用后即关：库文件不被常驻句柄占着，可被改名后继续使用。"""
    store = _store(tmp_path)
    store.save(**_intent())

    renamed = tmp_path / "runs-renamed.sqlite"
    os.rename(store.db_path, renamed)

    store.db_path = str(renamed)
    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION)["tool"] == "create_identity_user"
    store.clear(tenant_id=TENANT, conversation_id=CONVERSATION)
    assert store.load(tenant_id=TENANT, conversation_id=CONVERSATION) is None
