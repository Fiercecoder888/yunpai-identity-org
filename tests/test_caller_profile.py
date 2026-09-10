"""对话自述身份（caller 画像注入 run）回归（2026-09-09，用户反馈）：

「你好我的角色是什么」——AI 却回答「无法直接查询，请提供账号」。

根因与修复（产品代码已改，本文件只做验收）：

- ``api._caller_profile`` / ``api._with_caller``：``/runs`` 与 ``/runs/stream``
  在**有有效会话**时把当前登录人画像注入 run 的 ``request.caller``
  （``user_id/display_name/roles/role_names/org_path/permissions``）；
  无身份时不注入（匿名 legacy 行为完全不变）；
- ``llm.QwenRouter``：``_prompt()`` 把 ``caller`` 放进给模型的 JSON，
  ``_system_prompt()`` 规定「我是谁 / 我的角色 / 我的权限 / 我在哪个部门」
  → ``route=chat`` 直接用 caller 回答，不要用户报账号、不要调工具。

本文件用独立 tmp 库（``YUNPAI_IDENTITY_DB`` / ``YUNPAI_RUN_DB`` / ``YUNPAI_M0_DB``），
不依赖真实 runtime、不依赖任何既有账号，也不打真实 LLM（模型未配置时走
确定性兜底，route=chat 同样会落 caller）。
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.repository import InMemoryRunRepository

ADMIN = {"company_name": "云湃身份自述验收厂", "user_id": "boss",
         "password": "boss-pass-123", "display_name": "赵厂长"}
QUESTION = "你好我的角色是什么"


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


def _register_admin(client: TestClient) -> dict:
    """空库厂长自助注册（顺带自动登录，client 持有会话 Cookie）。"""
    resp = client.post("/api/auth/register-admin", json=ADMIN)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_worker(admin: TestClient, user_id: str = "worker01") -> str:
    """厂长建工人账号，返回一次性初始密码。"""
    resp = admin.post("/api/identity/users", json={
        "user_id": user_id, "display_name": "张三", "role_codes": ["worker"],
        "org_id": "company"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["initial_password"]
    return resp.json()["initial_password"]


def _ask(client: TestClient, message: str = QUESTION) -> dict:
    """发一句「我的角色是什么」并断言 run 本身成功（放行、不报错）。"""
    resp = client.post("/runs", json={"message": message, "tenant_id": "default"})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    assert state["run_id"]
    assert state["request"]["message"] == message
    return state


def _caller(state: dict):
    return state["request"].get("caller")


# ---------------------------------------------------------------- 厂长

def test_factory_director_run_injects_caller_profile(app):
    """厂长（有会话）：run 的 request.caller 是本人画像，角色含「厂长」。"""
    client = TestClient(app)
    _register_admin(client)

    state = _ask(client)
    caller = _caller(state)
    assert isinstance(caller, dict), state["request"]
    assert caller["user_id"] == "boss"
    assert caller["display_name"] == "赵厂长"
    # 注册厂长绑 factory-director + org-admin 双角色
    assert "factory-director" in caller["roles"]
    assert "厂长" in caller["role_names"]
    # 权限与组织路径必须非空，模型才能答出「我有什么权限 / 我在哪个部门」
    assert caller["permissions"], caller
    assert caller["org_path"], caller
    # 组织路径要**人可读**：历史缺口是只给 org_id（["company"]），问「我在哪个部门」
    # 只能答出 company；现在给组织名，org_path_ids 保留 id 供程序判断。
    assert caller["org_path"] == [ADMIN["company_name"]]
    if "org_path_ids" in caller:
        assert caller["org_path_ids"] == ["company"]
    # 文档约定的字段必须齐全（允许后续新增字段，但不允许缺）
    assert {"user_id", "display_name", "roles", "role_names",
            "org_path", "permissions"} <= set(caller)


# ---------------------------------------------------------------- 工人

def test_worker_run_injects_own_caller_profile(app):
    """工人（独立 client 独立 cookie）：caller.roles == ['worker']，角色名「工人」。"""
    admin = TestClient(app)
    _register_admin(admin)
    initial = _create_worker(admin)

    worker = TestClient(app)
    login = worker.post("/api/auth/login", json={"user_id": "worker01", "password": initial})
    assert login.status_code == 200, login.text

    state = _ask(worker)
    caller = _caller(state)
    assert isinstance(caller, dict), state["request"]
    assert caller["user_id"] == "worker01"
    assert caller["display_name"] == "张三"
    assert caller["roles"] == ["worker"]
    assert "工人" in caller["role_names"]
    # 工人的权限与厂长不同，但同样非空（order.view @self）
    assert caller["permissions"]
    assert caller["org_path"]


def test_caller_is_the_session_user_not_the_admin(app):
    """同一 app 下两个 client 各自持 cookie，caller 不得串人。"""
    admin = TestClient(app)
    _register_admin(admin)
    initial = _create_worker(admin)

    worker = TestClient(app)
    assert worker.post("/api/auth/login", json={
        "user_id": "worker01", "password": initial}).status_code == 200

    assert _caller(_ask(worker))["user_id"] == "worker01"
    assert _caller(_ask(admin))["user_id"] == "boss"


# ---------------------------------------------------------------- 无身份

def test_anonymous_run_still_allowed_without_caller(app):
    """无任何 cookie 的 client：匿名 legacy 仍放行，且不注入 caller（不报错）。"""
    client = TestClient(app)
    _register_admin(client)  # 库里有账号，但匿名 client 不带会话

    anonymous = TestClient(app)
    state = _ask(anonymous)
    # 不注入时字段可以整体缺省（_with_caller 原样返回 payload）
    assert _caller(state) is None
    assert state["run_id"]


# ---------------------------------------------------------------- 持久化

def test_caller_profile_persisted_and_readable(app):
    """厂长 POST /runs 后 GET /runs/{id}：落库的 request.caller 仍在（同一 client）。"""
    client = TestClient(app)
    _register_admin(client)

    created = _ask(client)
    fetched = client.get(f"/runs/{created['run_id']}")
    assert fetched.status_code == 200, fetched.text
    caller = _caller(fetched.json())
    assert isinstance(caller, dict), fetched.json()["request"]
    assert caller["user_id"] == "boss"
    assert caller["display_name"] == "赵厂长"
    assert "厂长" in caller["role_names"]
    assert caller["permissions"]
    # 运行列表里同样带着 caller（刷新会话历史也不丢）
    listed = client.get("/runs", params={"tenant_id": "default"}).json()["runs"]
    assert [run["run_id"] for run in listed] == [created["run_id"]]
    assert _caller(listed[0])["user_id"] == "boss"


# ---------------------------------------------------------------- 流式入口

def test_stream_run_start_and_snapshot_carry_caller(app):
    """POST /runs/stream：run_start / state_snapshot 事件里的 request.caller 也在。"""
    client = TestClient(app)
    _register_admin(client)

    resp = client.post("/runs/stream", json={"message": QUESTION, "tenant_id": "default"})
    assert resp.status_code == 200, resp.text
    events = [json.loads(line) for line in resp.text.splitlines() if line.strip()]
    assert events and events[0]["type"] == "run_start"

    start = events[0]
    caller = start["state"]["request"].get("caller")
    assert isinstance(caller, dict), start["state"]["request"]
    assert caller["user_id"] == "boss"
    assert "厂长" in caller["role_names"]

    snapshots = [event for event in events if event["type"] == "state_snapshot"]
    assert snapshots, [event["type"] for event in events]
    for event in snapshots:
        assert event["state"]["request"]["caller"]["user_id"] == "boss"


def test_stream_anonymous_has_no_caller(app):
    """流式入口同样遵守：无会话不注入 caller。"""
    client = TestClient(app)
    _register_admin(client)

    anonymous = TestClient(app)
    resp = anonymous.post("/runs/stream", json={"message": QUESTION, "tenant_id": "default"})
    assert resp.status_code == 200, resp.text
    events = [json.loads(line) for line in resp.text.splitlines() if line.strip()]
    assert events and events[0]["type"] == "run_start"
    assert events[0]["state"]["request"].get("caller") is None
