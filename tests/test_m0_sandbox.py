from __future__ import annotations

import base64
import json
import os
import tempfile

import pytest

from yunpai_langgraph.workers import m0_commit, m0_import, m0_preview, m0_resolve, m0_status


@pytest.fixture
def sandbox_env():
    prior = os.environ.get("YUNPAI_M0_SANDBOX_DB")
    os.environ["YUNPAI_M0_SANDBOX_DB"] = os.path.join(tempfile.mkdtemp(), "m0-sandbox.sqlite")
    yield
    if prior is None:
        os.environ.pop("YUNPAI_M0_SANDBOX_DB", None)
    else:
        os.environ["YUNPAI_M0_SANDBOX_DB"] = prior


def _files(*payloads):
    return [{"filename": f"doc-{index}.json", "content_b64": base64.b64encode(json.dumps(item).encode()).decode()} for index, item in enumerate(payloads, start=1)]


@pytest.mark.asyncio
async def test_m0_run_status_preview_resolve_commit_chain(sandbox_env):
    ctx = {"task_id": "TASK-M0-CHAIN", "tenant_id": "default"}
    imported = await m0_import({"files": _files({"records": [{"kind": "order"}]})}, ctx)
    batch_id = imported["batch_id"]
    assert imported["status"] == "awaiting_review"
    assert imported["canonical"] is False
    assert imported["environment"] == "sandbox"

    status = await m0_status({"batch_id": batch_id}, ctx)
    assert status["candidates"].get("candidate", 0) >= 1 or status["candidates"].get("needs_review", 0) >= 1

    preview = await m0_preview({"batch_id": batch_id}, ctx)
    assert preview["documents"]
    resolve_id = preview["documents"][0]["id"]

    decided = await m0_resolve({"batch_id": batch_id, "kind": "entity", "id": resolve_id, "action": "approve"}, ctx)
    assert decided["status"] == "approved"

    # 全部批准后 commit（显式 require_resolved）仍只做 fixture 记录，绝不宣称 canonical。
    committed = await m0_commit({"batch_id": batch_id, "require_resolved": True}, ctx)
    assert committed["status"] == "fixture_recorded"
    assert committed["canonical"] is False
    assert committed["readback"]["available"] is False


@pytest.mark.asyncio
async def test_m0_commit_blocks_unresolved_when_required(sandbox_env):
    ctx = {"task_id": "TASK-M0-BLOCK", "tenant_id": "default"}
    imported = await m0_import({"files": _files({"records": [{"kind": "order"}]}, {"records": [{"kind": "bom"}]})}, ctx)
    blocked = await m0_commit({"batch_id": imported["batch_id"], "require_resolved": True}, ctx)
    assert blocked["status"] == "blocked"
    assert blocked["code"] == "BLOCKED_INPUT"
    assert blocked["errors"][0]["code"] == "PENDING_REVIEW"


@pytest.mark.asyncio
async def test_m0_import_idempotent_replay(sandbox_env):
    ctx = {"task_id": "TASK-M0-IDEM", "tenant_id": "default"}
    files = _files({"records": [{"kind": "order"}]})
    first = await m0_import({"files": files}, ctx)
    second = await m0_import({"files": files}, ctx)
    assert first["batch_id"] == second["batch_id"]
    assert first["status"] == second["status"] == "awaiting_review"


@pytest.mark.asyncio
async def test_m0_commit_rejects_unknown_batch(sandbox_env):
    with pytest.raises(ValueError, match="batch not found"):
        await m0_commit({"batch_id": "batch-missing"}, {"task_id": "TASK-M0-MISSING"})


@pytest.mark.asyncio
async def test_m0_resolve_rejects_bad_action_and_missing_id(sandbox_env):
    ctx = {"task_id": "TASK-M0-RESOLVE", "tenant_id": "default"}
    imported = await m0_import({"files": _files({"records": [{"kind": "order"}]})}, ctx)
    with pytest.raises(ValueError, match="action"):
        await m0_resolve({"batch_id": imported["batch_id"], "kind": "entity", "id": 1, "action": "maybe"}, ctx)
    with pytest.raises(ValueError, match="需要显式 id"):
        await m0_resolve({"batch_id": imported["batch_id"], "kind": "entity", "action": "approve"}, ctx)
