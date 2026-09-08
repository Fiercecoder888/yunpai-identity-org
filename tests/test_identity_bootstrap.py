"""厂长自助注册 / 账号分配 / 改密停用（F-013 补充，2026-09-08）。

覆盖用户交付流程的闭环：
- 空库 → 只有注册页可用；注册厂长 → 建公司 + 绑 factory-director + org-admin（不动种子）；
- 一次性闸：已有账号后注册通道 409；
- 厂长分配账号 → 初始密码只回显一次 + 强制首登改密；
- 改密后旧密码失效；停用账号 → 其会话下一请求即 401（无黑名单表）；
- 组织节点删除守卫：挂人/有子节点拒绝。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.auth import SESSION_COOKIE
from yunpai_langgraph.identity import BOOTSTRAP_ADMIN_ROLES, IdentityStore
from yunpai_langgraph.repository import InMemoryRunRepository


@pytest.fixture()
def store(tmp_path):
    return IdentityStore(str(tmp_path / "identity.sqlite"))


@pytest.fixture()
def app(tmp_path, store, monkeypatch):
    monkeypatch.setenv("YUNPAI_M0_DB", str(tmp_path / "m0.sqlite"))
    monkeypatch.setenv("YUNPAI_DEFAULT_TENANT", "default")
    return create_app(repository=InMemoryRunRepository(), identity_store=store)


def _register_admin(client, **overrides):
    body = {"company_name": "云湃测试厂", "user_id": "boss",
            "password": "boss-pass-123", "display_name": "陈厂长"}
    body.update(overrides)
    return client.post("/api/auth/register-admin", json=body)


def test_unprefixed_identity_paths_are_accepted(app):
    """vite dev proxy / static_proxy 会剥掉 /api 前缀：无前缀路径必须同样可用。"""
    client = TestClient(app)
    assert client.get("/auth/bootstrap-status").json()["needs_bootstrap"] is True
    assert client.get("/api/auth/bootstrap-status").json()["needs_bootstrap"] is True
    registered = client.post("/auth/register-admin", json={
        "company_name": "云湃测试厂", "user_id": "boss", "password": "boss-pass-123"})
    assert registered.status_code == 200, registered.text
    assert client.get("/auth/me").status_code == 200
    assert client.get("/identity/catalog").status_code == 200
    assert client.get("/api/identity/catalog").status_code == 200
    assert client.get("/guidance/presets").status_code == 200


# ------------------------------------------------------------ 初始化状态

def test_bootstrap_status_reports_empty_system(app):
    client = TestClient(app)
    resp = client.get("/api/auth/bootstrap-status")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["needs_bootstrap"] is True
    assert payload["user_count"] == 0
    assert payload["company_name"] is None


# ------------------------------------------------------------ 厂长自助注册

def test_register_admin_binds_both_roles_and_auto_logs_in(app):
    client = TestClient(app)
    resp = _register_admin(client)
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["user_id"] == "boss"
    assert payload["display_name"] == "陈厂长"
    assert payload["roles"] == list(BOOTSTRAP_ADMIN_ROLES) == ["factory-director", "org-admin"]
    assert "identity.admin" in payload["permissions"]
    assert "order.view" in payload["permissions"]
    assert payload["must_change_password"] is False
    assert resp.cookies.get(SESSION_COOKIE)
    # 自动登录：同一 client 直接拿到 me
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user_id"] == "boss"
    assert "identity.admin" in me.json()["permissions"]
    # 公司根节点已建
    org = client.get("/api/identity/org").json()["org"]
    assert [node["org_type"] for node in org] == ["company"]
    assert org[0]["name"] == "云湃测试厂"
    # 一次性闸
    assert client.get("/api/auth/bootstrap-status").json()["needs_bootstrap"] is False
    again = _register_admin(client, user_id="boss2")
    assert again.status_code == 409
    assert again.json()["detail"]["code"] == "ALREADY_BOOTSTRAPPED"


def test_register_admin_validates_input(app):
    client = TestClient(app)
    assert _register_admin(client, company_name="").status_code == 422
    assert _register_admin(client, user_id="ab").json()["detail"]["code"] == "INVALID_USER_ID"
    assert _register_admin(client, user_id="bad id").status_code == 422
    weak = _register_admin(client, password="short")
    assert weak.status_code == 422
    assert weak.json()["detail"]["code"] == "WEAK_PASSWORD"


# ------------------------------------------------------------ 厂长分配账号

def test_admin_creates_account_with_one_time_password(app):
    admin = TestClient(app)
    _register_admin(admin)
    resp = admin.post("/api/identity/users", json={
        "user_id": "worker01", "display_name": "张三",
        "role_codes": ["worker"], "org_id": "company",
    })
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["password_returned_once"] is True
    assert len(payload["initial_password"]) >= 8
    assert payload["must_change_password"] is True
    # 列表里能查到，且不返回明文密码
    users = admin.get("/api/identity/users").json()["users"]
    created = next(user for user in users if user["user_id"] == "worker01")
    assert created["role_codes"] == ["worker"]
    assert created["must_change_password"] is True
    assert "initial_password" not in created and "password_hash" not in created
    # 重复建同名账号 → 409
    assert admin.post("/api/identity/users", json={"user_id": "worker01"}).status_code == 409


def test_new_account_must_change_password_then_old_password_dies(app):
    admin = TestClient(app)
    _register_admin(admin)
    created = admin.post("/api/identity/users", json={
        "user_id": "worker01", "display_name": "张三", "role_codes": ["worker"]}).json()
    initial = created["initial_password"]

    worker = TestClient(app)
    login = worker.post("/api/auth/login", json={"user_id": "worker01", "password": initial})
    assert login.status_code == 200, login.text
    assert login.json()["must_change_password"] is True
    me = worker.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["must_change_password"] is True
    assert me.json()["permissions"] == ["order.view"]
    assert me.json()["permission_scopes"] == {"order.view": "self"}

    # 首登改密
    changed = worker.post("/api/auth/change-password", json={
        "old_password": initial, "new_password": "worker-new-456"})
    assert changed.status_code == 200, changed.text
    assert worker.get("/api/auth/me").json()["must_change_password"] is False
    # 旧密码失效、新密码可登录
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": initial}).status_code == 401
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": "worker-new-456"}).status_code == 200


def test_wrong_old_password_is_rejected(app):
    admin = TestClient(app)
    _register_admin(admin)
    resp = admin.post("/api/auth/change-password", json={
        "old_password": "not-the-password", "new_password": "whatever-123"})
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "INVALID_CREDENTIALS"


# ------------------------------------------------------------ 停用与删除

def test_disabled_account_session_is_rejected_on_next_request(app):
    admin = TestClient(app)
    _register_admin(admin)
    created = admin.post("/api/identity/users", json={
        "user_id": "worker01", "role_codes": ["worker"]}).json()
    worker = TestClient(app)
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": created["initial_password"]}).status_code == 200
    assert worker.get("/api/auth/me").status_code == 200

    disabled = admin.patch("/api/identity/users/worker01", json={"status": "disabled"})
    assert disabled.status_code == 200, disabled.text
    assert worker.get("/api/auth/me").status_code == 401
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": created["initial_password"]}).status_code == 401
    # 重新启用后原密码仍有效（未重置）
    assert admin.patch("/api/identity/users/worker01", json={"status": "active"}).status_code == 200
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": created["initial_password"]}).status_code == 200


def test_reset_password_returns_new_one_time_password(app):
    admin = TestClient(app)
    _register_admin(admin)
    admin.post("/api/identity/users", json={"user_id": "worker01", "role_codes": ["worker"]})
    reset = admin.post("/api/identity/users/worker01/reset-password", json={})
    assert reset.status_code == 200
    new_password = reset.json()["initial_password"]
    assert reset.json()["must_change_password"] is True
    worker = TestClient(app)
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": new_password}).status_code == 200
    assert admin.post("/api/identity/users/nobody/reset-password", json={}).status_code == 404


def test_cannot_delete_self_or_last_account(app):
    admin = TestClient(app)
    _register_admin(admin)
    assert admin.delete("/api/identity/users/boss").status_code == 409
    assert admin.delete("/api/identity/users/boss").json()["detail"]["code"] == "CANNOT_DELETE_SELF"
    admin.post("/api/identity/users", json={"user_id": "worker01", "role_codes": ["worker"]})
    deleted = admin.delete("/api/identity/users/worker01")
    assert deleted.status_code == 200 and deleted.json()["deleted"] is True
    assert admin.delete("/api/identity/users/worker01").status_code == 404


# ------------------------------------------------------------ 组织节点守卫

def test_org_node_delete_guard(app):
    admin = TestClient(app)
    _register_admin(admin)
    team = admin.post("/api/identity/org", json={
        "org_id": "team:assemble", "name": "组装组",
        "parent_id": "company", "org_type": "team"})
    assert team.status_code == 200, team.text
    assert team.json()["org_type"] == "team"
    # 空节点可删
    assert admin.delete("/api/identity/org/team:assemble").status_code == 200
    assert admin.delete("/api/identity/org/team:assemble").status_code == 404
    # 挂账号后拒绝
    admin.post("/api/identity/org", json={
        "org_id": "team:assemble", "name": "组装组",
        "parent_id": "company", "org_type": "team"})
    admin.post("/api/identity/users", json={
        "user_id": "worker01", "role_codes": ["worker"], "org_id": "team:assemble"})
    blocked = admin.delete("/api/identity/org/team:assemble")
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "ORG_IN_USE"
    # 有子节点也拒绝
    admin.post("/api/identity/org", json={
        "org_id": "dept:prod", "name": "生产部", "parent_id": "company", "org_type": "dept"})
    admin.post("/api/identity/org", json={
        "org_id": "team:prod-a", "name": "生产A班", "parent_id": "dept:prod", "org_type": "team"})
    assert admin.delete("/api/identity/org/dept:prod").status_code == 409


def test_three_level_tree_is_returned(app):
    """公司 → 部门 → 班组 三层可由厂长自行搭建并读回。"""
    admin = TestClient(app)
    _register_admin(admin)
    for org_id, name, parent, org_type in [
        ("dept:prod", "生产部", "company", "dept"),
        ("dept:qc", "品质部", "company", "dept"),
        ("team:prod-a", "生产A班", "dept:prod", "team"),
        ("team:prod-b", "生产B班", "dept:prod", "team"),
    ]:
        resp = admin.post("/api/identity/org", json={
            "org_id": org_id, "name": name, "parent_id": parent, "org_type": org_type})
        assert resp.status_code == 200, resp.text
    tree = {node["org_id"]: node for node in admin.get("/api/identity/org").json()["org"]}
    assert tree["company"]["parent_id"] is None
    assert tree["dept:prod"]["parent_id"] == "company"
    assert tree["team:prod-a"]["parent_id"] == "dept:prod"
    assert tree["team:prod-a"]["org_type"] == "team"
    assert len(tree) == 5
