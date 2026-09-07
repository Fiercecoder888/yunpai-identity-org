"""identity 占位模块（F-013/F-014/F-015 骨架）回归测试。"""
from __future__ import annotations

import pytest

from yunpai_langgraph.identity import (
    LEGACY_ROLE_GRANTS,
    PERMISSION_CATALOG,
    IdentityStore,
    authorize,
)


@pytest.fixture()
def store(tmp_path):
    return IdentityStore(str(tmp_path / "identity.sqlite"))


def test_permission_catalog_matches_gate_semantics():
    gates = {p["gate"] for p in PERMISSION_CATALOG}
    # 现有 Gate 类型都有对应业务语言权限（candidate/review/engineering/apply/
    # sensitive_data/procurement）
    assert {"candidate", "review", "engineering", "apply", "sensitive_data", "procurement"} <= gates
    assert all(p["label"] for p in PERMISSION_CATALOG)


def test_org_tree_upsert_and_path(store):
    store.upsert_org(org_id="company", name="公司", org_type="company")
    store.upsert_org(org_id="dept:押出", name="押出部", parent_id="company")
    store.upsert_org(org_id="line:押出:1L", name="一楼产线", parent_id="dept:押出", org_type="line")
    assert store.org_path("line:押出:1L") == ["company", "dept:押出", "line:押出:1L"]
    assert store.org_path("company") == ["company"]
    assert store.org_path("不存在") == []


def test_derive_org_from_workers_placeholder_rule(store):
    created = store.derive_org_from_workers([
        {"worker_code": "W-1", "worker_name": "张三", "dept": "押出部", "line": "一楼"},
        {"worker_code": "W-2", "worker_name": "李四", "dept": "押出部"},
        {"worker_code": "W-3", "worker_name": "王五", "dept": "组装部"},
        "garbage",
    ])
    ids = {node["org_id"] for node in created}
    assert {"dept:押出部", "line:押出部:一楼", "dept:组装部"} <= ids
    # 幂等：重跑不重复
    again = store.derive_org_from_workers([{"dept": "押出部", "line": "一楼"}])
    assert not again
    assert store.org_path("line:押出部:一楼") == ["company", "dept:押出部", "line:押出部:一楼"]


def test_role_and_binding_resolve_roundtrip(store):
    store.bind_user(tenant_id="default", user_id="u-planner",
                    role_codes=["planner"], org_id=None)
    resolved = store.resolve(tenant_id="default", user_id="u-planner")
    assert resolved["roles"] == ["planner"]
    assert "schedule.solve" in resolved["permissions"]
    assert "schedule.release" not in resolved["permissions"]  # 越权不可见

    store.bind_user(tenant_id="default", user_id="u-eng", role_codes=["engineer"])
    eng = store.resolve(tenant_id="default", user_id="u-eng")
    assert "engineering.approve" in eng["permissions"]


def test_authorize_placeholder_semantics(store, monkeypatch):
    store.bind_user(tenant_id="default", user_id="u-planner", role_codes=["planner"])
    ok = authorize(store, tenant_id="default", user_id="u-planner", permission="schedule.solve")
    assert ok["allowed"] and ok["reason"] == "binding"
    # 无绑定用户 + 无旧角色 → fail-closed
    denied = authorize(store, tenant_id="default", user_id="stranger", permission="schedule.release")
    assert not denied["allowed"] and denied["reason"] == "fail_closed"
    # 绑定用户越权 → fail-closed
    overreach = authorize(store, tenant_id="default", user_id="u-planner", permission="schedule.release")
    assert not overreach["allowed"]
    # 过渡兼容：受信头旧角色授予（与现状等价）
    legacy = authorize(store, tenant_id="default", user_id="stranger",
                       permission="candidate.approve", legacy_roles=["m0-reviewer"])
    assert legacy["allowed"] and legacy["reason"] == "legacy_role:m0-reviewer"
    # 引导管理员通道
    monkeypatch.setenv("IDENTITY_BOOTSTRAP_ADMIN", "boot-admin")
    boot = authorize(store, tenant_id="default", user_id="boot-admin", permission="identity.admin")
    assert boot["allowed"] and boot["reason"] == "bootstrap_admin"
    boot_other = authorize(store, tenant_id="default", user_id="other", permission="identity.admin")
    assert not boot_other["allowed"]


def test_role_validation_and_tenant_isolation(store):
    with pytest.raises(ValueError, match="未知权限"):
        store.upsert_role(tenant_id="default", role_code="bad", name="坏", permissions=["no.such"])
    with pytest.raises(ValueError, match="未注册角色"):
        store.bind_user(tenant_id="default", user_id="u", role_codes=["ghost"])
    # 租户隔离：租户 A 的角色对租户 B 不可用
    store.upsert_role(tenant_id="A", role_code="custom", name="A 专属", permissions=["order.view"])
    with pytest.raises(ValueError, match="未注册角色"):
        store.bind_user(tenant_id="B", user_id="u", role_codes=["custom"])


def test_legacy_grants_subset_of_catalog():
    catalog = {p["code"] for p in PERMISSION_CATALOG}
    for grants in LEGACY_ROLE_GRANTS.values():
        assert grants <= catalog
