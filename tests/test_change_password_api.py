"""改密接口行为回归（2026-09-09，用户反馈）：

「员工第一次修改密码的时候还需要填写当前密码，但当前密码只能复制一次 —— 其实
不用这个当前密码了。」

契约（以库中 ``users.must_change_password`` 为准，不信任请求体）：

- ``must_change_password == 1``（首登强制改密）：``old_password`` 可省略、也不校验；
- ``must_change_password == 0``（主动改密）：必须校验当前密码，
  缺 → 422 ``OLD_PASSWORD_REQUIRED``；错 → 403 ``INVALID_CREDENTIALS``；
- 其它行为不变：新密码 < 8 位 → 422 ``WEAK_PASSWORD``；成功 → ``{"ok": True, "user_id": actor}``
  且 ``must_change_password`` 清零；未登录 → 401 ``AUTHENTICATION_REQUIRED``。

本文件用独立 tmp 库（``YUNPAI_IDENTITY_DB`` / ``YUNPAI_RUN_DB``），不依赖既有账号。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.repository import InMemoryRunRepository

ADMIN = {"company_name": "云湃改密验收厂", "user_id": "boss",
         "password": "boss-pass-123", "display_name": "陈厂长"}


@pytest.fixture()
def app(tmp_path, monkeypatch):
    """独立 tmp 身份库 + tmp 运行库，避免与真实 runtime / 其它测试互相污染。"""
    identity_db = tmp_path / "identity.sqlite"
    monkeypatch.setenv("YUNPAI_IDENTITY_DB", str(identity_db))
    monkeypatch.setenv("YUNPAI_RUN_DB", str(tmp_path / "runs.sqlite"))
    monkeypatch.setenv("YUNPAI_M0_DB", str(tmp_path / "m0.sqlite"))
    monkeypatch.setenv("YUNPAI_DEFAULT_TENANT", "default")
    store = IdentityStore(str(identity_db))
    return create_app(repository=InMemoryRunRepository(), identity_store=store)


def _register_admin(client: TestClient):
    resp = client.post("/api/auth/register-admin", json=ADMIN)
    assert resp.status_code == 200, resp.text
    assert resp.json()["must_change_password"] is False
    return resp


def _create_worker(admin: TestClient, user_id: str = "worker01") -> str:
    """厂长建工人账号（该接口默认 must_change_password=1），返回一次性初始密码。"""
    resp = admin.post("/api/identity/users", json={
        "user_id": user_id, "display_name": "张三", "role_codes": ["worker"],
        "org_id": "company"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["must_change_password"] is True
    return resp.json()["initial_password"]


# ------------------------------------------------- 主动改密：仍必须当前密码

def test_active_change_password_requires_old_password(app):
    """厂长（must_change_password=0）：缺当前密码 → 422；错 → 403；对 → 200。"""
    client = TestClient(app)
    _register_admin(client)

    missing = client.post("/api/auth/change-password", json={"new_password": "new-pass-456"})
    assert missing.status_code == 422, missing.text
    assert missing.json()["detail"]["code"] == "OLD_PASSWORD_REQUIRED"
    assert missing.json()["detail"]["message"] == "请提供当前密码"
    # 422 不得改掉密码
    assert client.post("/api/auth/login", json={
        "user_id": "boss", "password": ADMIN["password"]}).status_code == 200

    wrong = client.post("/api/auth/change-password", json={
        "old_password": "not-the-password", "new_password": "new-pass-456"})
    assert wrong.status_code == 403, wrong.text
    assert wrong.json()["detail"]["code"] == "INVALID_CREDENTIALS"
    assert client.post("/api/auth/login", json={
        "user_id": "boss", "password": ADMIN["password"]}).status_code == 200

    ok = client.post("/api/auth/change-password", json={
        "old_password": ADMIN["password"], "new_password": "new-pass-456"})
    assert ok.status_code == 200, ok.text
    assert ok.json() == {"ok": True, "user_id": "boss"}
    assert client.get("/api/auth/me").json()["must_change_password"] is False
    # 旧密码失效、新密码可登录
    assert client.post("/api/auth/login", json={
        "user_id": "boss", "password": ADMIN["password"]}).status_code == 401
    assert client.post("/api/auth/login", json={
        "user_id": "boss", "password": "new-pass-456"}).status_code == 200


def test_request_body_cannot_bypass_old_password_check(app):
    """must_change_password=0 的账号即使请求体自称首登，也必须给当前密码。"""
    client = TestClient(app)
    _register_admin(client)
    resp = client.post("/api/auth/change-password", json={
        "new_password": "new-pass-456", "must_change_password": True})
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "OLD_PASSWORD_REQUIRED"


# ------------------------------------------------- 首登强制改密：不要当前密码

def test_worker_first_login_change_password_without_old_password(app):
    """工人（must_change_password=1）：不带 old_password 直接改密成功并解除强制。"""
    admin = TestClient(app)
    _register_admin(admin)
    initial = _create_worker(admin)

    worker = TestClient(app)
    login = worker.post("/api/auth/login", json={"user_id": "worker01", "password": initial})
    assert login.status_code == 200, login.text
    assert login.json()["must_change_password"] is True
    assert worker.get("/api/auth/me").json()["must_change_password"] is True

    changed = worker.post("/api/auth/change-password", json={"new_password": "worker-new-456"})
    assert changed.status_code == 200, changed.text
    assert changed.json() == {"ok": True, "user_id": "worker01"}
    assert worker.get("/api/auth/me").json()["must_change_password"] is False

    fresh = TestClient(app)
    assert fresh.post("/api/auth/login", json={
        "user_id": "worker01", "password": "worker-new-456"}).status_code == 200
    assert fresh.post("/api/auth/login", json={
        "user_id": "worker01", "password": initial}).status_code == 401


def test_first_login_ignores_supplied_old_password(app):
    """首登场景即使带了错的 old_password 也不拦截（用户手上的一次性密码可能已失效）。"""
    admin = TestClient(app)
    _register_admin(admin)
    initial = _create_worker(admin, user_id="worker02")
    worker = TestClient(app)
    assert worker.post("/api/auth/login", json={
        "user_id": "worker02", "password": initial}).status_code == 200

    changed = worker.post("/api/auth/change-password", json={
        "old_password": "totally-wrong", "new_password": "worker-new-456"})
    assert changed.status_code == 200, changed.text
    assert worker.get("/api/auth/me").json()["must_change_password"] is False


def test_reset_password_reenables_passwordless_change(app):
    """重置密码后 must_change_password 重新置 1 → 新的一次性密码可免当前密码改密。"""
    admin = TestClient(app)
    _register_admin(admin)
    _create_worker(admin, user_id="worker03")

    reset = admin.post("/api/identity/users/worker03/reset-password", json={})
    assert reset.status_code == 200, reset.text
    assert reset.json()["must_change_password"] is True
    fresh = reset.json()["initial_password"]

    worker = TestClient(app)
    assert worker.post("/api/auth/login", json={
        "user_id": "worker03", "password": fresh}).status_code == 200
    changed = worker.post("/api/auth/change-password", json={"new_password": "worker-new-456"})
    assert changed.status_code == 200, changed.text
    assert worker.get("/api/auth/me").json()["must_change_password"] is False


# ------------------------------------------------- 不变的既有行为

def test_weak_new_password_is_rejected_in_both_modes(app):
    admin = TestClient(app)
    _register_admin(admin)
    weak_active = admin.post("/api/auth/change-password", json={
        "old_password": ADMIN["password"], "new_password": "short"})
    assert weak_active.status_code == 422, weak_active.text
    assert weak_active.json()["detail"]["code"] == "WEAK_PASSWORD"

    initial = _create_worker(admin, user_id="worker04")
    worker = TestClient(app)
    assert worker.post("/api/auth/login", json={
        "user_id": "worker04", "password": initial}).status_code == 200
    weak_first = worker.post("/api/auth/change-password", json={"new_password": "short"})
    assert weak_first.status_code == 422, weak_first.text
    assert weak_first.json()["detail"]["code"] == "WEAK_PASSWORD"
    # 失败不得解除首登强制
    assert worker.get("/api/auth/me").json()["must_change_password"] is True
    assert TestClient(app).post("/api/auth/login", json={
        "user_id": "worker04", "password": initial}).status_code == 200


def test_unauthenticated_change_password_is_401(app):
    client = TestClient(app)
    _register_admin(client)
    anonymous = TestClient(app)
    resp = anonymous.post("/api/auth/change-password", json={"new_password": "new-pass-456"})
    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"]["code"] == "AUTHENTICATION_REQUIRED"
