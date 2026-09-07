"""引导AI 轻量对话（F-015 重设计）测试。

覆盖：规模三选一 → 预设架构 → 自然语言增删改 → 确认落地；红线：确认前
库里查不到任何部门/绑定写入。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.guided_chat import SCALE_PRESETS, handle_message
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.repository import InMemoryRunRepository


@pytest.fixture()
def store(tmp_path):
    return IdentityStore(str(tmp_path / "identity.sqlite"))


def _start(store):
    return handle_message(store, tenant_id="t1", user_id="boss", message="")


def test_first_message_offers_three_scale_options(store):
    resp = _start(store)
    assert resp["state"]["stage"] == "ask_scale"
    assert [o["value"] for o in resp["options"]] == ["small", "medium", "large"]
    assert "小规模" in resp["reply"] and "大规模" in resp["reply"]
    assert resp["done"] is False and resp["applied"] is None


def test_presets_differ_in_complexity():
    assert len(SCALE_PRESETS["small"]["departments"]) == 2
    assert len(SCALE_PRESETS["small"]["roles"]) == 3
    assert len(SCALE_PRESETS["medium"]["departments"]) == 5
    assert len(SCALE_PRESETS["medium"]["roles"]) == 6
    assert len(SCALE_PRESETS["large"]["departments"]) == 8
    assert len(SCALE_PRESETS["large"]["roles"]) == 9


def test_select_scale_proposes_preset(store):
    resp = handle_message(store, tenant_id="t1", user_id="boss", message="中",
                          state={"stage": "ask_scale"})
    assert resp["state"]["stage"] == "propose"
    assert resp["state"]["departments"] == ["生产部", "工程部", "品质部", "计划部", "仓储部"]
    assert "就这样" in resp["reply"]
    # 口语等价：中规模 / 2 都识别
    for word in ("中规模", "2", "medium"):
        r = handle_message(store, tenant_id="t1", user_id="boss", message=word,
                           state={"stage": "ask_scale"})
        assert r["state"]["scale"] == "medium", word


def test_edit_intents_assign_add_delete_remove(store):
    state = handle_message(store, tenant_id="t1", user_id="boss", message="小",
                           state={"stage": "ask_scale"})["state"]
    # 设角色（多人）
    r = handle_message(store, tenant_id="t1", user_id="boss", message="张三设为厂长", state=state)
    assert r["state"]["assignments"] == [{"name": "张三", "roles": ["factory-director"]}]
    r = handle_message(store, tenant_id="t1", user_id="boss", message="李四、王五当组长", state=r["state"])
    names = {a["name"]: a["roles"] for a in r["state"]["assignments"]}
    assert names == {"张三": ["factory-director"], "李四": ["team-leader"], "王五": ["team-leader"]}
    # 加部门 / 删部门
    r = handle_message(store, tenant_id="t1", user_id="boss", message="新增部门 品质部", state=r["state"])
    assert "品质部" in r["state"]["departments"]
    r = handle_message(store, tenant_id="t1", user_id="boss", message="删除 管理部", state=r["state"])
    assert "管理部" not in r["state"]["departments"]
    # 移除账号角色
    r = handle_message(store, tenant_id="t1", user_id="boss", message="张三不当了", state=r["state"])
    assert all(a["name"] != "张三" for a in r["state"]["assignments"])
    # 确认前红线：库里无任何写入
    assert store.org_tree(tenant_id="t1") == []
    assert store.list_bindings(tenant_id="t1") == []


def test_confirm_applies_org_and_bindings(store):
    state = handle_message(store, tenant_id="t1", user_id="boss", message="小",
                           state={"stage": "ask_scale"})["state"]
    state = handle_message(store, tenant_id="t1", user_id="boss", message="张三设为厂长", state=state)["state"]
    state = handle_message(store, tenant_id="t1", user_id="boss", message="李四当组长", state=state)["state"]
    done = handle_message(store, tenant_id="t1", user_id="boss", message="就这样", state=state)
    assert done["done"] is True and done["state"] is None
    assert done["applied"]["departments"] == 2
    assert done["applied"]["bindings"] == 2
    tree = {n["org_id"]: n for n in store.org_tree(tenant_id="t1")}
    assert {"company", "dept:生产", "dept:管理"} <= set(tree)
    assert tree["dept:生产"]["source"] == "manual"  # 引导建的结构标 manual，派生不覆盖
    binds = {b["user_id"]: b["role_codes"] for b in store.list_bindings(tenant_id="t1")}
    assert binds == {"张三": ["factory-director"], "李四": ["team-leader"]}


def test_roster_name_resolves_to_worker_code(store):
    roster = [{"worker_code": "***1234", "worker_name": "张三", "skill": "厂长"},
              {"worker_code": "***5678", "worker_name": "李四", "skill": "组长"}]
    state = handle_message(store, tenant_id="t1", user_id="boss", message="大",
                           state={"stage": "ask_scale"})["state"]
    state = handle_message(store, tenant_id="t1", user_id="boss", message="张三设为厂长", state=state)["state"]
    done = handle_message(store, tenant_id="t1", user_id="boss", message="就这样",
                          state=state, roster=roster)
    assert done["done"]
    binds = {b["user_id"]: b["role_codes"] for b in store.list_bindings(tenant_id="t1")}
    assert "***1234" in binds and binds["***1234"] == ["factory-director"]
    assert "张三" not in binds  # 用花名册 code 而非名字当账号


def test_unknown_message_reprompts_without_change(store):
    state = handle_message(store, tenant_id="t1", user_id="boss", message="中",
                           state={"stage": "ask_scale"})["state"]
    r = handle_message(store, tenant_id="t1", user_id="boss", message="帮我随便搞搞", state=state)
    assert "没识别出" in r["reply"]
    assert r["state"]["departments"] == state["departments"]


# ------------------------------------------------------------ API 层

@pytest.fixture()
def client(tmp_path, store, monkeypatch):
    monkeypatch.setenv("YUNPAI_M0_DB", str(tmp_path / "m0.sqlite"))
    return TestClient(create_app(repository=InMemoryRunRepository(), identity_store=store))


def test_presets_endpoint_readonly(client):
    resp = client.get("/api/guidance/presets")
    assert resp.status_code == 200
    assert [p["value"] for p in resp.json()["presets"]] == ["small", "medium", "large"]


def test_chat_endpoint_requires_admin(client):
    resp = client.post("/api/guidance/chat", json={"tenant_id": "t1", "message": ""})
    assert resp.status_code == 401


def test_chat_endpoint_full_flow(client, store):
    headers = {"X-Actor-User": "boss", "X-Actor-Roles": "admin", "X-Tenant-Id": "t1"}
    first = client.post("/api/guidance/chat", json={"tenant_id": "t1", "message": ""}, headers=headers)
    assert first.status_code == 200
    assert len(first.json()["options"]) == 3
    # 选规模
    pick = client.post("/api/guidance/chat",
                       json={"tenant_id": "t1", "message": "小", "state": first.json()["state"]},
                       headers=headers)
    assert pick.json()["state"]["departments"] == ["生产部", "管理部"]
    # 分配 + 确认
    assign = client.post("/api/guidance/chat",
                         json={"tenant_id": "t1", "message": "张三设为厂长", "state": pick.json()["state"]},
                         headers=headers)
    done = client.post("/api/guidance/chat",
                       json={"tenant_id": "t1", "message": "就这样", "state": assign.json()["state"]},
                       headers=headers)
    assert done.json()["done"] is True
    assert done.json()["applied"]["bindings"] == 1
    assert store.list_bindings(tenant_id="t1")[0]["user_id"] == "张三"
