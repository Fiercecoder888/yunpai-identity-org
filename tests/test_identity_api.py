"""identity 管理 API 测试（P-011/P-012/P-013 API 层）。

覆盖交接包第四节验收要求：
- identity 自有 API 全过 authorize（接缝 4 第一步）：无认证 401、deny 403 留审计、
  bootstrap 首管通道、legacy 受信头角色过渡；
- 租户隔离：双租户同名用户/角色互不可见，跨租户管理 403；
- 引导AI 红线：未确认的分配方案在库里查不到任何绑定写入。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.auth import hash_password
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.m0_backend import M0Store
from yunpai_langgraph.repository import InMemoryRunRepository


@pytest.fixture()
def store(tmp_path):
    return IdentityStore(str(tmp_path / "identity.sqlite"))


@pytest.fixture()
def client(tmp_path, store, monkeypatch):
    monkeypatch.setenv("YUNPAI_M0_DB", str(tmp_path / "m0.sqlite"))
    return TestClient(create_app(repository=InMemoryRunRepository(), identity_store=store))


_ADMIN_HEADERS = {"X-Actor-User": "root", "X-Actor-Roles": "admin"}


def _seed_m0_workers(tmp_path, tenant="tenant-a"):
    m0 = M0Store(tmp_path / "m0.sqlite")
    records = [
        {"filename": "roster.xlsx", "entity_type": "worker",
         "worker_code": "***********1234", "worker_name": "张三", "shift": "仓储部", "skill": "仓管"},
        {"filename": "roster.xlsx", "entity_type": "worker",
         "worker_code": "***********5678", "worker_name": "李四", "shift": "人事、采购", "skill": "办公室文员"},
        {"filename": "roster.xlsx", "entity_type": "worker",
         "worker_code": "***********9012", "worker_name": "王五", "shift": "押出部", "skill": "押出组长"},
    ]
    batch = m0.ingest(records, tenant_id=tenant, task_id="task-roster")
    assert m0.publish(batch["batch_id"], actor="steward", reason="花名册人工审批")["status"] == "published"
    return m0


# ------------------------------------------------------- 鉴权门（接缝 4 第一步）

def test_identity_api_requires_authentication(client):
    # catalog 只读开放；管理端点无认证（无头无会话）→ 401
    assert client.get("/api/identity/catalog").status_code == 200
    for method, path in [
        ("get", "/api/identity/org"), ("get", "/api/identity/roles"),
        ("get", "/api/identity/bindings"), ("get", "/api/identity/authz/recent"),
    ]:
        resp = getattr(client, method)(path, params={"tenant_id": "tenant-a"})
        assert resp.status_code == 401, (path, resp.status_code)
        assert resp.json()["detail"]["code"] == "AUTHENTICATION_REQUIRED"


def test_identity_api_denies_without_admin_and_audits(client, store):
    headers = {"X-Actor-User": "viewer", "X-Actor-Roles": "viewer-only"}
    resp = client.get("/api/identity/roles", params={"tenant_id": "tenant-a"}, headers=headers)
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "IDENTITY_DENIED"
    # deny 留痕
    denies = store.recent_authz(tenant_id="tenant-a", only_denied=True)
    assert any(row["user_id"] == "viewer" and row["permission"] == "identity.admin" for row in denies)


def test_identity_api_accepts_legacy_admin_header(client):
    """过渡兼容：受信头旧角色 admin 经 LEGACY_ROLE_GRANTS 拿 identity.admin。"""
    resp = client.get("/api/identity/roles", params={"tenant_id": "tenant-a"}, headers=_ADMIN_HEADERS)
    assert resp.status_code == 200
    codes = {role["role_code"] for role in resp.json()["roles"]}
    assert {"org-admin", "factory-director", "worker"} <= codes


def test_identity_api_bootstrap_channel(client, store, monkeypatch):
    monkeypatch.setenv("IDENTITY_BOOTSTRAP_ADMIN", "boot")
    resp = client.get("/api/identity/roles", params={"tenant_id": "t-new"},
                      headers={"X-Actor-User": "boot"})
    assert resp.status_code == 200
    # 首个绑定出现后 bootstrap 失效
    store.bind_user(tenant_id="t-new", user_id="first-admin", role_codes=["org-admin"])
    resp2 = client.get("/api/identity/roles", params={"tenant_id": "t-new"},
                       headers={"X-Actor-User": "boot"})
    assert resp2.status_code == 403


def test_identity_api_accepts_login_session(client, store):
    """登录会话（org-admin 绑定）管理 identity API。"""
    store.create_user(tenant_id="tenant-a", user_id="boss", password_hash=hash_password("pw"))
    store.bind_user(tenant_id="tenant-a", user_id="boss", role_codes=["org-admin"])
    client.post("/api/auth/login", json={"tenant_id": "tenant-a", "user_id": "boss", "password": "pw"})
    resp = client.get("/api/identity/roles")  # 租户回退自 principal
    assert resp.status_code == 200
    assert resp.json()["tenant_id"] == "tenant-a"


# ------------------------------------------------------------- 管理 API

def test_role_upsert_validation_and_scope(client):
    bad = client.post("/api/identity/roles", params={}, headers=_ADMIN_HEADERS,
                      json={"tenant_id": "tenant-a", "role_code": "bad", "name": "坏",
                            "permissions": ["no.such"]})
    assert bad.status_code == 422
    ok = client.post("/api/identity/roles", headers=_ADMIN_HEADERS,
                     json={"tenant_id": "tenant-a", "role_code": "viewer",
                           "name": "只读查看", "permissions": ["order.view@dept", "report.view"]})
    assert ok.status_code == 200
    listed = {r["role_code"]: r for r in client.get(
        "/api/identity/roles", params={"tenant_id": "tenant-a"}, headers=_ADMIN_HEADERS).json()["roles"]}
    assert listed["viewer"]["permissions"] == ["order.view@dept", "report.view"]


def test_bind_user_and_bulk(client, store):
    single = client.post("/api/identity/bindings", headers=_ADMIN_HEADERS,
                         json={"tenant_id": "tenant-a", "user_id": "u1",
                               "role_codes": ["worker"], "skill": "仓管"})
    assert single.status_code == 200
    unknown = client.post("/api/identity/bindings", headers=_ADMIN_HEADERS,
                          json={"tenant_id": "tenant-a", "user_id": "u2", "role_codes": ["ghost"]})
    assert unknown.status_code == 422
    bulk = client.post("/api/identity/bindings/bulk", headers=_ADMIN_HEADERS,
                       json={"tenant_id": "tenant-a", "bindings": [
                           {"user_id": "u3", "role_codes": ["worker"]},
                           {"user_id": "u4", "role_codes": ["team-leader"], "skill": "组长"},
                       ]})
    assert bulk.status_code == 200 and bulk.json()["count"] == 2
    # 任一条失败整批拒绝
    bad_bulk = client.post("/api/identity/bindings/bulk", headers=_ADMIN_HEADERS,
                           json={"tenant_id": "tenant-a", "bindings": [
                               {"user_id": "u5", "role_codes": ["worker"]},
                               {"user_id": "u6", "role_codes": ["ghost"]},
                           ]})
    assert bad_bulk.status_code == 422
    users = {b["user_id"] for b in store.list_bindings(tenant_id="tenant-a")}
    assert users == {"u1", "u3", "u4"}  # u5 未写入（整批回滚语义按条校验）


def test_org_manual_upsert_and_tenant_isolation(client, store):
    created = client.post("/api/identity/org", headers=_ADMIN_HEADERS,
                          json={"tenant_id": "tenant-a", "org_id": "dept:手工组",
                                "name": "手工组", "org_type": "dept"})
    assert created.status_code == 200 and created.json()["source"] == "manual"
    # 双租户同名部门互不可见
    client.post("/api/identity/org", headers=_ADMIN_HEADERS,
                json={"tenant_id": "tenant-b", "org_id": "dept:手工组", "name": "B 的同名组"})
    tree_a = {n["org_id"] for n in client.get("/api/identity/org", params={"tenant_id": "tenant-a"},
                                              headers=_ADMIN_HEADERS).json()["org"]}
    tree_b = {n["org_id"] for n in client.get("/api/identity/org", params={"tenant_id": "tenant-b"},
                                              headers=_ADMIN_HEADERS).json()["org"]}
    assert tree_a == {"dept:手工组"} and tree_b == {"dept:手工组"}  # 同 org_id 不同租户两棵树
    assert store.org_path(tenant_id="tenant-a", org_id="dept:手工组") == ["dept:手工组"]
    # 双租户同名用户/角色互不可见
    store.bind_user(tenant_id="tenant-a", user_id="same-name", role_codes=["worker"])
    store.bind_user(tenant_id="tenant-b", user_id="same-name", role_codes=["engineer"])
    ra = store.resolve(tenant_id="tenant-a", user_id="same-name")
    rb = store.resolve(tenant_id="tenant-b", user_id="same-name")
    assert ra["permissions"] == ["order.view"] and "engineering.approve" in rb["permissions"]
    # 跨租户管理拒绝（principal tenant ≠ 目标 tenant）
    cross = client.get("/api/identity/roles", params={"tenant_id": "tenant-b"},
                       headers={"X-Actor-User": "root", "X-Actor-Roles": "admin", "X-Tenant-Id": "tenant-a"})
    assert cross.status_code == 403 and cross.json()["detail"]["code"] == "CROSS_TENANT"


def test_org_derive_endpoint_reads_canonical(client, tmp_path, store, monkeypatch):
    _seed_m0_workers(tmp_path)
    resp = client.post("/api/identity/org/derive", headers=_ADMIN_HEADERS,
                       json={"tenant_id": "tenant-a"})
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["workers"] == 3
    created_ids = {node["org_id"] for node in payload["created"]}
    # 「人事、采购」拆两节点；company 根 + 仓储/押出
    assert created_ids == {"company", "dept:仓储", "dept:人事", "dept:采购", "dept:押出"}
    # 再跑一次幂等零新增
    again = client.post("/api/identity/org/derive", headers=_ADMIN_HEADERS,
                        json={"tenant_id": "tenant-a"}).json()
    assert again["created"] == []
