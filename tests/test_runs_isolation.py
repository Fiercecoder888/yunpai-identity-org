"""聊天框多用户隔离回归（2026-09-09，用户反馈）：

「这个聊天框也是要做多用户隔离的 因为现在不能每个人都看别人聊啥了啊」

``/runs*`` 端点契约（run 状态里已存 ``principal``，形如
``{"actor": "worker001", "tenant_id": "default", "roles": [...], "permissions": [...]}``）：

- 有身份（登录会话 Cookie 或受信头）：
  - ``GET /runs`` 只返回 ``principal.actor == 调用者 actor`` 的 run；具备租户级管理
    权限 ``identity.admin``（厂长注册绑定的 ``org-admin`` 角色，或 legacy 受信头
    ``admin``）时可见本租户全部 run；显式查别的租户 → 空；
  - ``GET /runs/{id}`` / ``DELETE /runs/{id}``：非本人且非管理员 → **404**（不用 403，
    避免泄露该 run 是否存在）；
  - ``POST /runs/batch-delete``：非本人且非管理员 → 跳过并计数。
- 无身份 = legacy/本地行为，仍返回全部（生产需 ``YUNPAI_REQUIRE_TRUSTED_PRINCIPAL=1``）。

本文件用独立 tmp 身份库 + tmp 运行库，不依赖 runtime 里的真实账号。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.repository import InMemoryRunRepository

from test_graph import workflow_request

ADMIN = {"company_name": "云湃隔离验收厂", "user_id": "boss",
         "password": "boss-pass-123", "display_name": "陈厂长"}


@pytest.fixture()
def app(tmp_path, monkeypatch):
    identity_db = tmp_path / "identity.sqlite"
    monkeypatch.setenv("YUNPAI_IDENTITY_DB", str(identity_db))
    monkeypatch.setenv("YUNPAI_RUN_DB", str(tmp_path / "runs.sqlite"))
    monkeypatch.setenv("YUNPAI_M0_DB", str(tmp_path / "m0.sqlite"))
    monkeypatch.setenv("YUNPAI_DEFAULT_TENANT", "default")
    monkeypatch.delenv("IDENTITY_BOOTSTRAP_ADMIN", raising=False)
    store = IdentityStore(str(identity_db))
    return create_app(repository=InMemoryRunRepository(), identity_store=store)


def _register_admin(app, tenant_id: str = "", **overrides) -> TestClient:
    """厂长自助注册（自动登录，返回带会话 Cookie 的 client）。"""
    client = TestClient(app)
    payload = {**ADMIN, **overrides}
    if tenant_id:
        payload["tenant_id"] = tenant_id
    resp = client.post("/api/auth/register-admin", json=payload)
    assert resp.status_code == 200, resp.text
    return client


def _worker_client(app, admin: TestClient, user_id: str, display_name: str) -> TestClient:
    """厂长建工人账号 → 用一次性初始密码登录（独立 client = 独立 Cookie 罐）。"""
    created = admin.post("/api/identity/users", json={
        "user_id": user_id, "display_name": display_name,
        "role_codes": ["worker"], "org_id": "company",
    })
    assert created.status_code == 200, created.text
    client = TestClient(app)
    login = client.post("/api/auth/login", json={
        "user_id": user_id, "password": created.json()["initial_password"]})
    assert login.status_code == 200, login.text
    return client


def _start_run(client: TestClient, tenant_id: str = "default") -> dict:
    """建一条 run（run.principal 记为调用者身份），返回公开状态。"""
    resp = client.post("/runs", json={**workflow_request(), "tenant_id": tenant_id})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["principal"]["actor"], body
    assert body["principal"]["tenant_id"] == tenant_id
    return body


def _run_ids(client: TestClient, **params) -> set[str]:
    resp = client.get("/runs", params=params or None)
    assert resp.status_code == 200, resp.text
    return {run["run_id"] for run in resp.json()["runs"]}


# --------------------------------------------------- 列表：只看得到自己的

def test_list_runs_only_returns_caller_own_runs(app):
    admin = _register_admin(app)
    alice = _worker_client(app, admin, "worker001", "张伟")
    bob = _worker_client(app, admin, "worker002", "李娜")
    alice_run = _start_run(alice)
    bob_run = _start_run(bob)

    assert _run_ids(alice) == {alice_run["run_id"]}
    assert _run_ids(bob) == {bob_run["run_id"]}
    # 同一租户、同一 identity 库，两人互不可见（隔离而非租户过滤）
    assert _run_ids(alice) != _run_ids(bob)
    # 管理员（identity.admin）可见本租户全部
    assert _run_ids(admin) >= {alice_run["run_id"], bob_run["run_id"]}


def test_trusted_header_identity_is_isolated_too(app):
    """内部/代理调用走受信头（无 Cookie）时同样隔离；legacy 头 admin 仍可见全部。"""
    alice = TestClient(app)
    bob = TestClient(app)
    alice_headers = {"X-Actor-User": "hdr-alice", "X-Actor-Roles": "worker",
                     "X-Tenant-Id": "default"}
    bob_headers = {"X-Actor-User": "hdr-bob", "X-Actor-Roles": "worker",
                   "X-Tenant-Id": "default"}
    alice_run = alice.post("/runs", json={**workflow_request(), "tenant_id": "default"},
                           headers=alice_headers).json()
    bob_run = bob.post("/runs", json={**workflow_request(), "tenant_id": "default"},
                       headers=bob_headers).json()
    assert alice_run["principal"]["actor"] == "hdr-alice"

    listed = alice.get("/runs", headers=alice_headers).json()["runs"]
    assert {run["run_id"] for run in listed} == {alice_run["run_id"]}

    admin_headers = {"X-Actor-User": "hdr-admin", "X-Actor-Roles": "admin",
                     "X-Tenant-Id": "default"}
    admin_ids = {run["run_id"] for run in alice.get("/runs", headers=admin_headers).json()["runs"]}
    assert {alice_run["run_id"], bob_run["run_id"]} <= admin_ids


# --------------------------------------------------- 详情：非本人 404

def test_get_run_returns_404_for_other_actor(app):
    admin = _register_admin(app)
    alice = _worker_client(app, admin, "worker001", "张伟")
    bob = _worker_client(app, admin, "worker002", "李娜")
    alice_run = _start_run(alice)
    bob_run = _start_run(bob)

    own = alice.get(f"/runs/{alice_run['run_id']}")
    assert own.status_code == 200
    assert own.json()["run_id"] == alice_run["run_id"]

    other = alice.get(f"/runs/{bob_run['run_id']}")
    assert other.status_code == 404, other.text
    # 与「不存在」同一措辞：不泄露该 run 是否存在
    assert other.json()["detail"] == "run not found"
    assert bob.get(f"/runs/{alice_run['run_id']}").status_code == 404
    # 管理员可读别人的
    assert admin.get(f"/runs/{bob_run['run_id']}").status_code == 200


# --------------------------------------------------- 删除：归属校验

def test_delete_run_404_for_other_actor(app):
    admin = _register_admin(app)
    alice = _worker_client(app, admin, "worker001", "张伟")
    bob = _worker_client(app, admin, "worker002", "李娜")
    alice_run = _start_run(alice)
    bob_run = _start_run(bob)

    denied = alice.delete(f"/runs/{bob_run['run_id']}")
    assert denied.status_code == 404, denied.text
    # 别人的 run 必须还在
    assert bob.get(f"/runs/{bob_run['run_id']}").status_code == 200

    assert alice.delete(f"/runs/{alice_run['run_id']}").json()["deleted"] is True
    assert alice.get(f"/runs/{alice_run['run_id']}").status_code == 404
    # 管理员可删别人的
    assert admin.delete(f"/runs/{bob_run['run_id']}").json()["deleted"] is True


def test_batch_delete_skips_other_peoples_runs(app):
    admin = _register_admin(app)
    alice = _worker_client(app, admin, "worker001", "张伟")
    bob = _worker_client(app, admin, "worker002", "李娜")
    alice_run = _start_run(alice)
    bob_run = _start_run(bob)

    result = alice.post("/runs/batch-delete",
                        json={"run_ids": [alice_run["run_id"], bob_run["run_id"]]}).json()
    assert result["deleted"] == [alice_run["run_id"]]
    assert result["count"] == 1
    assert bob.get(f"/runs/{bob_run['run_id']}").status_code == 200
    # 管理员批量删：两人剩下的都能删
    result = admin.post("/runs/batch-delete", json={"run_ids": [bob_run["run_id"]]}).json()
    assert result["deleted"] == [bob_run["run_id"]]


# --------------------------------------------------- 跨租户 + legacy 不回归

def test_cross_tenant_runs_are_not_visible(app):
    admin_a = _register_admin(app)
    worker_a = _worker_client(app, admin_a, "worker001", "张伟")
    run_a = _start_run(worker_a)
    # 同库第二个租户（独立 identity 库内互不连通）
    admin_b = _register_admin(app, tenant_id="tenant-b", user_id="bossb",
                              company_name="云湃隔离验收二厂")
    run_b = _start_run(admin_b, tenant_id="tenant-b")

    assert _run_ids(admin_b) == {run_b["run_id"]}
    assert admin_b.get(f"/runs/{run_a['run_id']}").status_code == 404
    assert admin_b.delete(f"/runs/{run_a['run_id']}").status_code == 404
    # 客户端传的 tenant_id 不能放大范围：有身份时一律以调用者租户为准
    assert _run_ids(admin_a, tenant_id="tenant-b") == {run_a["run_id"]}
    assert _run_ids(admin_a) == {run_a["run_id"]}


def test_anonymous_caller_still_sees_all_runs_legacy(app):
    """legacy/本地行为：无 Cookie、无受信头 → 返回全部（生产需开启强制受信开关）。"""
    admin = _register_admin(app)
    alice = _worker_client(app, admin, "worker001", "张伟")
    bob = _worker_client(app, admin, "worker002", "李娜")
    alice_run = _start_run(alice)
    bob_run = _start_run(bob)

    anonymous = TestClient(app)  # 全新 client：无会话 Cookie
    ids = _run_ids(anonymous, tenant_id="default")
    assert {alice_run["run_id"], bob_run["run_id"]} <= ids
    assert anonymous.get(f"/runs/{bob_run['run_id']}").status_code == 200
    assert anonymous.delete(f"/runs/{bob_run['run_id']}").json()["deleted"] is True
