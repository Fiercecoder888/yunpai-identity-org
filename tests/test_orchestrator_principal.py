"""M1-M5 Orchestrator 任务定向测试：可信审批身份与角色 Gate（T5）。

覆盖：
- /runs/{run_id}/resume 不再信任 body.actor；actor/roles/tenant 来自受信头
  （X-Yunpai-Principal 或 X-Actor-User/Roles/Tenant）
- 请求体 actor 与受信 principal 不一致（冒充）被拒绝/忽略并记录审计
- 跨租户审批被拒绝
- 无角色 / 角色不足审批被拒绝（403）
- YUNPAI_REQUIRE_TRUSTED_PRINCIPAL=1 时缺头直接 403
"""
import json

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.repository import SQLiteRunRepository


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(repository=SQLiteRunRepository(tmp_path / "auth.sqlite")))


def _open_authorization_gate(client):
    """data_import_commit 自由工具触发 authorization Gate（副作用前授权）。"""
    created = client.post("/runs", json={
        "tenant_id": "tenant-a",
        "request": {
            "tool": "data_import_commit",
            "payloads": {"data_import_commit": {"batch_id": "batch-1"}},
        },
    }).json()
    assert created["pending_gate"]["type"] == "authorization"
    return created["run_id"]


def test_body_actor_impersonation_is_rejected(client):
    run_id = _open_authorization_gate(client)
    # 提供受信头后，body 中冒充的 actor 被拒绝（T5.4 impersonation）。
    denied = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve", "actor": "imposter"},
        headers={"X-Actor-User": "op-1", "X-Actor-Roles": "operator"},
    )
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "ACTOR_IMPERSONATION"
    # 一致的受信 actor 放行，审批主体来自 principal 头而非 body。
    ok = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve", "actor": "op-1"},
        headers={"X-Actor-User": "op-1", "X-Actor-Roles": "operator"},
    )
    assert ok.status_code == 200
    approval = ok.json()["approvals"][-1]
    assert approval["principal"]["actor"] == "op-1"
    assert approval["principal"]["trusted"] is True
    assert approval["actor"] == "op-1"


def test_json_principal_header_supported(client):
    run_id = _open_authorization_gate(client)
    resp = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve", "actor": "zhb"},
        headers={"X-Yunpai-Principal": json.dumps({"actor": "zhb", "roles": ["admin"], "tenant_id": "tenant-a"})},
    )
    assert resp.status_code == 200
    assert resp.json()["approvals"][-1]["principal"]["actor"] == "zhb"


def test_cross_tenant_approval_rejected(client):
    run_id = _open_authorization_gate(client)  # run tenant=tenant-a
    resp = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve"},
        headers={"X-Actor-User": "op-1", "X-Actor-Roles": "operator", "X-Tenant-Id": "tenant-other"},
    )
    assert resp.status_code == 403
    assert "cross-tenant" in resp.text


def test_missing_role_is_rejected(client):
    run_id = _open_authorization_gate(client)
    resp = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve"},
        headers={"X-Actor-User": "viewer", "X-Actor-Roles": "viewer-only"},
    )
    assert resp.status_code == 403
    assert "需要角色" in resp.text


def test_trusted_principal_required_env_blocks_anonymous(client, monkeypatch):
    monkeypatch.setenv("YUNPAI_REQUIRE_TRUSTED_PRINCIPAL", "1")
    run_id = _open_authorization_gate(client)
    resp = client.post(f"/runs/{run_id}/resume", json={"decision": "approve", "actor": "anyone"})
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "TRUSTED_PRINCIPAL_REQUIRED"
    # 有受信头则放行
    ok = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve"},
        headers={"X-Actor-User": "op-1", "X-Actor-Roles": "operator"},
    )
    assert ok.status_code == 200


def test_engineering_gate_needs_engineering_role(client):
    from test_graph import workflow_request

    created = client.post("/runs", json=workflow_request()).json()
    run_id = created["run_id"]
    # candidate gate -> 用 data-steward 批准
    step1 = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve"},
        headers={"X-Actor-User": "steward", "X-Actor-Roles": "data-steward"},
    )
    assert step1.status_code == 200
    assert step1.json()["pending_gate"]["type"] == "engineering"
    # data-steward 无 engineering 角色 -> 403
    denied = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve"},
        headers={"X-Actor-User": "steward", "X-Actor-Roles": "data-steward"},
    )
    assert denied.status_code == 403
    # engineering-manager 可以批准
    ok = client.post(
        f"/runs/{run_id}/resume",
        json={"decision": "approve"},
        headers={"X-Actor-User": "eng-1", "X-Actor-Roles": "engineering-manager"},
    )
    assert ok.status_code == 200
