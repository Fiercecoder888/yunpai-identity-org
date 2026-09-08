"""工具级权限闸测试（F-013 补充：禁止不同角色调用无权工具）。

覆盖：
- 映射全覆盖（119 个工具，漏配即启动失败）；
- 规则正确性：读/写/求解/发布落到预期权限 code；
- `ToolRegistry.call` 硬闸：无权限 → ToolForbiddenError，有权限 → 放行；
- 无 principal 的 legacy 路径不拦截（内部调用/单测）；
- `YUNPAI_TOOL_AUTHZ=warn` 只告警不拦截；
- `/tools` 按 principal 过滤；
- 端到端：工人会话调 M3 采购工具 → run 失败且 errors[0].code == TOOL_FORBIDDEN。
"""
from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.auth import hash_password
from yunpai_langgraph.contracts import ToolSpec
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.registry import ToolForbiddenError, ToolRegistry, build_default_registry
from yunpai_langgraph.repository import InMemoryRunRepository
from yunpai_langgraph.tool_permissions import (
    assert_full_coverage,
    permission_for_tool,
    tool_allowed,
    unmapped_tools,
)


@pytest.fixture()
def store(tmp_path):
    return IdentityStore(str(tmp_path / "identity.sqlite"))


@pytest.fixture()
def client(tmp_path, store, monkeypatch):
    monkeypatch.setenv("YUNPAI_M0_DB", str(tmp_path / "m0.sqlite"))
    monkeypatch.setenv("YUNPAI_DEFAULT_TENANT", "default")
    monkeypatch.setenv("YUNPAI_TOOL_AUTHZ", "enforce")
    return TestClient(create_app(repository=InMemoryRunRepository(), identity_store=store))


# ------------------------------------------------------------ 映射

def test_every_registered_tool_has_a_permission_mapping():
    registry = build_default_registry()
    assert len(registry.specs) > 100
    assert unmapped_tools(registry.specs) == []
    assert_full_coverage(registry.specs)


@pytest.mark.parametrize(
    ("tool", "module", "expected"),
    [
        ("ingest_document", "m1", "order.ingest"),
        ("submit_m1_review", "m1", "order.review"),
        ("list_m1_tasks", "m1", "order.view"),
        ("get_m0_product_overview", "m0", "data.steward"),
        ("ingest_canonical", "m0", "candidate.approve"),
        ("data_import_run", "m0", "order.ingest"),
        ("run_bom_sop_workflow", "m2", "engineering.approve"),
        ("run_m3_procurement_requirements", "m3", "procurement.supplement"),
        ("list_m3_orders", "m3", "order.view"),
        ("import_m4_purchase_suggestions_json", "m4", "procurement.supplement"),
        ("list_m4_suppliers", "m4", "order.view"),
        ("solve_scheduling", "m5", "schedule.solve"),
        ("dispatch_m5_schedule", "m5", "schedule.release"),
        ("get_m5_schedule", "m5", "report.view"),
        ("report_workload", "m5", "report.view"),
    ],
)
def test_permission_mapping_rules(tool, module, expected):
    assert permission_for_tool(tool, module) == expected


def test_unknown_tool_has_no_mapping():
    assert permission_for_tool("not_a_real_tool", "m9") is None
    assert tool_allowed("not_a_real_tool", "m9", ["order.view"]) is False


def test_narrow_scope_does_not_authorize_tenant_scoped_tools():
    """order.view@self 的工人不满足租户级工具要求（范围过滤本身仍列 v2）。"""
    assert tool_allowed("list_m1_tasks", "m1", ["order.view"], {"order.view": "self"}) is False
    assert tool_allowed("list_m1_tasks", "m1", ["order.view"], {"order.view": "dept"}) is False
    assert tool_allowed("list_m1_tasks", "m1", ["order.view"], {"order.view": "tenant"}) is True
    assert tool_allowed("list_m1_tasks", "m1", ["order.view"], {}) is True


# ------------------------------------------------------------ 硬闸

def _registry_with(name: str, module: str = "m5") -> ToolRegistry:
    registry = ToolRegistry()

    async def handler(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    registry.register(
        ToolSpec(name=name, module=module, description="test", input_schema={"type": "object"},
                 output_schema={"type": "object"}, method="POST", path="/x"),
        handler,
    )
    return registry


@pytest.mark.asyncio
async def test_call_denies_without_required_permission():
    registry = _registry_with("solve_scheduling")
    with pytest.raises(ToolForbiddenError) as excinfo:
        await registry.call("solve_scheduling", {}, {
            "principal": {"actor": "worker01"}, "principal_permissions": ["order.view"],
        })
    assert excinfo.value.code == "TOOL_FORBIDDEN"
    assert excinfo.value.required == "schedule.solve"
    assert excinfo.value.status_code == 403


@pytest.mark.asyncio
async def test_call_allows_with_required_permission():
    registry = _registry_with("solve_scheduling")
    result = await registry.call("solve_scheduling", {}, {
        "principal": {"actor": "boss"}, "principal_permissions": ["schedule.solve"],
    })
    assert result["data"]["ok"] is True


@pytest.mark.asyncio
async def test_call_without_principal_keeps_legacy_behaviour():
    registry = _registry_with("solve_scheduling")
    result = await registry.call("solve_scheduling", {}, {})
    assert result["data"]["ok"] is True


@pytest.mark.asyncio
async def test_warn_mode_logs_but_does_not_block(monkeypatch):
    monkeypatch.setenv("YUNPAI_TOOL_AUTHZ", "warn")
    registry = _registry_with("solve_scheduling")
    result = await registry.call("solve_scheduling", {}, {
        "principal": {"actor": "worker01"}, "principal_permissions": ["order.view"],
    })
    assert result["data"]["ok"] is True


@pytest.mark.asyncio
async def test_off_mode_disables_the_gate(monkeypatch):
    monkeypatch.setenv("YUNPAI_TOOL_AUTHZ", "off")
    registry = _registry_with("solve_scheduling")
    result = await registry.call("solve_scheduling", {}, {
        "principal": {"actor": "worker01"}, "principal_permissions": [],
    })
    assert result["data"]["ok"] is True


# ------------------------------------------------------------ HTTP 层

def _seed_admin_and_worker(store: IdentityStore) -> None:
    store.upsert_org(tenant_id="default", org_id="company", name="测试厂", org_type="company")
    store.create_user(tenant_id="default", user_id="boss",
                      password_hash=hash_password("boss-pass-123"), display_name="陈厂长",
                      org_id="company")
    store.bind_user(tenant_id="default", user_id="boss",
                    role_codes=["factory-director", "org-admin"], org_id="company")
    store.create_user(tenant_id="default", user_id="worker01",
                      password_hash=hash_password("worker-pass-123"), display_name="张三",
                      org_id="company")
    store.bind_user(tenant_id="default", user_id="worker01", role_codes=["worker"],
                    org_id="company")


def test_tools_endpoint_filters_by_principal(client, store):
    _seed_admin_and_worker(store)
    worker = TestClient(client.app)
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": "worker-pass-123"}).status_code == 200
    worker_tools = {item["name"] for item in worker.get("/tools").json()["tools"]}
    # 工人只有 order.view@self（窄范围）→ 不满足任何租户级工具，清单为空
    assert worker_tools == set()

    boss = TestClient(client.app)
    assert boss.post("/api/auth/login", json={
        "user_id": "boss", "password": "boss-pass-123"}).status_code == 200
    boss_tools = {item["name"] for item in boss.get("/tools").json()["tools"]}
    assert "solve_scheduling" in boss_tools
    assert "run_m3_procurement_requirements" in boss_tools
    assert len(boss_tools) == len({item["name"] for item in client.get("/tools").json()["tools"]})


def test_worker_read_tool_is_blocked_by_tool_gate(client, store):
    """GET 读工具没有 preflight 授权 Gate，直接落到工具硬闸。"""
    _seed_admin_and_worker(store)
    worker = TestClient(client.app)
    worker.post("/api/auth/login", json={"user_id": "worker01", "password": "worker-pass-123"})
    resp = worker.post("/runs", json={
        "tenant_id": "default",
        "request": {"tools": ["list_m1_tasks"], "message": "看看订单"},
    })
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["status"] == "failed"
    assert payload["errors"][0]["code"] == "TOOL_FORBIDDEN"
    assert payload["errors"][0]["tool"] == "list_m1_tasks"
    assert payload["errors"][0]["required"] == "order.view"
    assert any(item.get("event") == "tool.forbidden" for item in payload["trace"])


def test_worker_write_tool_stops_at_authorization_gate_first(client, store):
    """写工具（free 模式 POST）先撞 preflight 授权 Gate，不会被执行。"""
    _seed_admin_and_worker(store)
    worker = TestClient(client.app)
    worker.post("/api/auth/login", json={"user_id": "worker01", "password": "worker-pass-123"})
    resp = worker.post("/runs", json={
        "tenant_id": "default",
        "request": {"tools": ["run_m3_procurement_requirements"], "message": "帮我算采购"},
    })
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["status"] == "waiting_human"
    assert payload["pending_gate"]["type"] == "authorization"
    assert payload["pending_gate"]["tool"] == "run_m3_procurement_requirements"
    # 没有任何执行记录（Gate 在调用前）
    assert payload["steps"] == []


def test_boss_read_tool_is_not_blocked(client, store):
    """厂长有租户级 order.view：同样调用不会因权限被拒。"""
    _seed_admin_and_worker(store)
    boss = TestClient(client.app)
    boss.post("/api/auth/login", json={"user_id": "boss", "password": "boss-pass-123"})
    resp = boss.post("/runs", json={
        "tenant_id": "default",
        "request": {"tools": ["list_m1_tasks"], "message": "看看订单"},
    })
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    codes = [item.get("code") for item in payload.get("errors", [])]
    assert "TOOL_FORBIDDEN" not in codes
