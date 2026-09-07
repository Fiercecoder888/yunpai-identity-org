"""引导AI 对话版（LLM 驱动）测试。

用 fake router（测试替身）驱动，验证确定性层的机械职责：规模三选一契约、
状态维护、动作校验、确认 Gate 落库、模型不可用 fail-loud；不验证真实模型。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.guided_chat import SCALE_OPTIONS, handle_message
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.llm import QwenRouter
from yunpai_langgraph.repository import InMemoryRunRepository


class FakeRouter:
    """按用户消息返回预设决策的测试替身（script: 关键词 → 决策字段）。

    匹配按「最长关键词优先」——「张三不当了」优先命中「不当了」而非「张三」。
    """

    def __init__(self, script=None):
        self.script = script or {}
        self.calls = []

    async def guide_chat(self, **kwargs):
        self.calls.append(kwargs)
        msg = str(kwargs.get("message") or "")
        for key in sorted(self.script, key=len, reverse=True):
            if key in msg:
                decision = self.script[key]
                return {"ok": True, "scale": None, "needs_scale": False,
                        "actions": [], "confirm": False, "reply": "", **decision}
        return {"ok": True, "reply": "（默认无动作）", "scale": None,
                "needs_scale": False, "actions": [], "confirm": False}


@pytest.fixture()
def store(tmp_path):
    return IdentityStore(str(tmp_path / "identity.sqlite"))


async def test_first_message_offers_three_scale_options(store):
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="")
    assert resp["state"]["started"] is True
    assert [o["value"] for o in resp["options"]] == ["small", "medium", "large"]
    assert len(SCALE_OPTIONS) == 3
    assert resp["done"] is False and resp["applied"] is None


async def test_scale_selection_delegates_to_llm(store):
    router = FakeRouter({"小": {"scale": "small", "actions": [
        {"op": "add_dept", "name": "生产部"},
        {"op": "add_dept", "name": "管理部"}],
        "reply": "好的，先按小规模搭两部门。"}})
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="小",
                                router=router)
    assert resp["state"]["scale"] == "small"
    assert resp["state"]["departments"] == ["生产部", "管理部"]
    # 确认前红线：库里无写入
    assert store.org_tree(tenant_id="t1") == []
    assert store.list_bindings(tenant_id="t1") == []
    # 模型收到的上下文包含花名册与角色目录（证明判断交给了模型）
    call = router.calls[0]
    assert "roles" in call and "roster" in call


async def test_llm_assign_add_delete_remove(store):
    router = FakeRouter({
        "张三": {"actions": [{"op": "assign", "user": "张三", "roles": ["factory-director"]}],
                 "reply": "已把张三设为厂长。"},
        "李四": {"actions": [{"op": "assign", "user": "李四", "roles": ["team-leader"]}],
                 "reply": "已把李四设为组长。"},
        "品质部": {"actions": [{"op": "add_dept", "name": "品质部"}], "reply": "已新增品质部。"},
        "管理部": {"actions": [{"op": "del_dept", "name": "管理部"}], "reply": "已删除管理部。"},
        "不当了": {"actions": [{"op": "unassign", "user": "张三"}], "reply": "已移除张三的分配。"},
    })
    state = {"scale": "small", "departments": ["生产部", "管理部"], "assignments": []}
    r = await handle_message(store, tenant_id="t1", user_id="boss", message="张三", state=state, router=router)
    assert r["state"]["assignments"] == [{"name": "张三", "roles": ["factory-director"]}]
    r = await handle_message(store, tenant_id="t1", user_id="boss", message="李四", state=r["state"], router=router)
    assert [a["roles"] for a in r["state"]["assignments"] if a["name"] == "李四"] == [["team-leader"]]
    r = await handle_message(store, tenant_id="t1", user_id="boss", message="品质部", state=r["state"], router=router)
    assert "品质部" in r["state"]["departments"]
    r = await handle_message(store, tenant_id="t1", user_id="boss", message="管理部", state=r["state"], router=router)
    assert "管理部" not in r["state"]["departments"]
    r = await handle_message(store, tenant_id="t1", user_id="boss", message="张三不当了", state=r["state"], router=router)
    assert all(a["name"] != "张三" for a in r["state"]["assignments"])
    assert store.org_tree(tenant_id="t1") == []
    assert store.list_bindings(tenant_id="t1") == []


async def test_confirm_applies_org_and_bindings(store):
    router = FakeRouter({"就这样": {"confirm": True, "reply": "好的，正在落地。"}})
    state = {"scale": "small", "departments": ["生产部", "管理部"],
             "assignments": [{"name": "张三", "roles": ["factory-director"]},
                             {"name": "李四", "roles": ["team-leader"]}]}
    done = await handle_message(store, tenant_id="t1", user_id="boss", message="就这样",
                                state=state, router=router)
    assert done["done"] is True and done["state"] is None
    assert done["applied"]["departments"] == 2 and done["applied"]["bindings"] == 2
    tree = {n["org_id"]: n for n in store.org_tree(tenant_id="t1")}
    assert {"company", "dept:生产", "dept:管理"} <= set(tree)
    assert tree["dept:生产"]["source"] == "manual"
    binds = {b["user_id"]: b["role_codes"] for b in store.list_bindings(tenant_id="t1")}
    assert binds == {"张三": ["factory-director"], "李四": ["team-leader"]}


async def test_roster_name_resolves_to_worker_code(store):
    roster = [{"worker_code": "***1234", "worker_name": "张三", "skill": "厂长"}]
    router = FakeRouter({
        "张三": {"actions": [{"op": "assign", "user": "张三", "roles": ["factory-director"]}]},
        "就这样": {"confirm": True},
    })
    state = {"scale": "small", "departments": ["生产部"], "assignments": []}
    r = await handle_message(store, tenant_id="t1", user_id="boss", message="张三",
                             state=state, roster=roster, router=router)
    done = await handle_message(store, tenant_id="t1", user_id="boss", message="就这样",
                                state=r["state"], roster=roster, router=router)
    assert done["done"]
    binds = {b["user_id"]: b["role_codes"] for b in store.list_bindings(tenant_id="t1")}
    assert binds == {"***1234": ["factory-director"]}


async def test_validation_rejects_invalid_role_code(store):
    router = FakeRouter({"张三": {"actions": [
        {"op": "assign", "user": "张三", "roles": ["superman"]}]}})
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="张三", router=router)
    assert "已忽略" in resp["reply"]
    assert resp["state"]["assignments"] == []


async def test_model_unavailable_fails_loud(store):
    class DownRouter:
        async def guide_chat(self, **kwargs):
            return {"ok": False, "status": "error", "error": "connection refused"}

    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="小",
                                state={"scale": None}, router=DownRouter())
    assert "模型不可用" in resp["reply"]
    assert resp["done"] is False and resp["applied"] is None


async def test_missing_router_fails_loud(store):
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="小",
                                state={"scale": None})
    assert "模型不可用" in resp["reply"]


async def test_needs_scale_returns_options_again(store):
    router = FakeRouter({"随便": {"needs_scale": True, "reply": "咱们先定规模。"}})
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="随便",
                                state={"scale": None}, router=router)
    assert [o["value"] for o in resp["options"]] == ["small", "medium", "large"]


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


def test_chat_endpoint_full_flow(client, store, monkeypatch):
    """API 层全流程：通过 monkeypatch 把真实 QwenRouter.guide_chat 换成假决策。"""
    async def fake_guide_chat(self, **kwargs):
        msg = str(kwargs.get("message") or "")
        if "小" in msg:
            return {"ok": True, "reply": "按小规模搭两部门", "scale": "small",
                    "needs_scale": False,
                    "actions": [{"op": "add_dept", "name": "生产部"},
                                {"op": "add_dept", "name": "管理部"}], "confirm": False}
        if "张三" in msg:
            return {"ok": True, "reply": "张三设为厂长", "scale": None, "needs_scale": False,
                    "actions": [{"op": "assign", "user": "张三", "roles": ["factory-director"]}],
                    "confirm": False}
        if "就这样" in msg:
            return {"ok": True, "reply": "落地完成", "scale": None, "needs_scale": False,
                    "actions": [], "confirm": True}
        return {"ok": True, "reply": "…", "scale": None, "needs_scale": False,
                "actions": [], "confirm": False}

    monkeypatch.setattr(QwenRouter, "guide_chat", fake_guide_chat)
    headers = {"X-Actor-User": "boss", "X-Actor-Roles": "admin", "X-Tenant-Id": "t1"}
    first = client.post("/api/guidance/chat", json={"tenant_id": "t1", "message": ""}, headers=headers)
    assert first.status_code == 200 and len(first.json()["options"]) == 3
    pick = client.post("/api/guidance/chat",
                       json={"tenant_id": "t1", "message": "小", "state": first.json()["state"]},
                       headers=headers)
    assert pick.json()["state"]["departments"] == ["生产部", "管理部"]
    assign = client.post("/api/guidance/chat",
                         json={"tenant_id": "t1", "message": "张三设为厂长", "state": pick.json()["state"]},
                         headers=headers)
    done = client.post("/api/guidance/chat",
                       json={"tenant_id": "t1", "message": "就这样", "state": assign.json()["state"]},
                       headers=headers)
    assert done.json()["done"] is True
    assert done.json()["applied"]["bindings"] == 1
    assert store.list_bindings(tenant_id="t1")[0]["user_id"] == "张三"
