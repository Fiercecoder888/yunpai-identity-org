"""引导AI 组织架构图对话（扁平内容 + 模板渲染）测试。

用 fake router 驱动，验证确定性层的机械职责：规模三档建议部门名单、部门/人员
校验（非法角色/空名/去重）、确认 Gate 落库（人员挂部门 org_id）、花名册
名→code、模型不可用 fail-loud。组织内容由模型产出，不在此断言具体结构规则。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.guided_chat import handle_message, sanitize_assignments, sanitize_departments
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.llm import QwenRouter
from yunpai_langgraph.repository import InMemoryRunRepository

SCALE_DEPARTMENTS = {
    "small": ["生产部", "管理部"],
    "medium": ["生产部", "工程部", "品质部", "计划部", "仓储部"],
    "large": ["生产部", "工程部", "品质部", "计划部", "仓储部", "采购部", "人事行政部", "财务部"],
}

DEPARTMENTS = ["生产部", "管理部"]
ASSIGNMENTS = [
    {"name": "张三", "roles": ["factory-director"], "dept": "生产部"},
    {"name": "李四", "roles": ["team-leader"], "dept": "生产部"},
]


class FakeRouter:
    """按用户消息返回预设决策（script: 关键词 → 决策字段；最长关键词优先）。"""

    def __init__(self, script=None):
        self.script = script or {}
        self.calls = []

    async def guide_chat(self, **kwargs):
        self.calls.append(kwargs)
        msg = str(kwargs.get("message") or "")
        for key in sorted(self.script, key=len, reverse=True):
            if key in msg:
                d = self.script[key]
                return {"ok": True, "reply": "", "scale": None, "needs_scale": False,
                        "confirm": False, "departments": [], "assignments": [],
                        "scale_departments": {}, **d}
        return {"ok": True, "reply": "（默认）", "scale": None, "needs_scale": False,
                "confirm": False, "departments": kwargs.get("departments") or [],
                "assignments": kwargs.get("assignments") or [], "scale_departments": {}}


@pytest.fixture()
def store(tmp_path):
    return IdentityStore(str(tmp_path / "identity.sqlite"))


# ------------------------------------------------------------ 单元

def test_sanitize_filters_invalid():
    assert sanitize_departments(["生产部", "", "生产部", "管理部"]) == ["生产部", "管理部"]
    assigns = sanitize_assignments([
        {"name": "张三", "roles": ["factory-director", "superman"], "dept": "生产部"},
        {"name": "", "roles": ["worker"], "dept": "生产部"},  # 空名剔除
        "garbage",  # 非 dict 剔除
        {"name": "李四", "roles": ["superman"], "dept": "生产部"},  # 全部角色非法 → 剔除
    ])
    assert assigns == [{"name": "张三", "roles": ["factory-director"], "dept": "生产部"}]


async def test_first_turn_returns_three_scale_departments(store):
    router = FakeRouter({"": {"needs_scale": True, "scale_departments": SCALE_DEPARTMENTS,
                              "reply": "请选规模"}})
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="", router=router)
    assert [o["value"] for o in resp["options"]] == ["small", "medium", "large"]
    assert set(resp["scale_departments"]) == {"small", "medium", "large"}
    assert len(resp["scale_departments"]["small"]) == 2
    assert len(resp["scale_departments"]["large"]) == 8
    assert resp["role_names"]["factory-director"] == "厂长"
    assert resp["done"] is False and resp["applied"] is None


async def test_scale_selection_produces_plan(store):
    router = FakeRouter({"小": {"scale": "small", "departments": DEPARTMENTS,
                                "assignments": ASSIGNMENTS, "reply": "已生成"}})
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="小", router=router)
    assert resp["state"]["scale"] == "small"
    assert resp["plan"]["departments"] == DEPARTMENTS
    assert {a["name"] for a in resp["plan"]["assignments"]} == {"张三", "李四"}
    # 确认前红线：库里无写入
    assert store.org_tree(tenant_id="t1") == []
    assert store.list_bindings(tenant_id="t1") == []


async def test_confirm_applies_flat_plan(store):
    router = FakeRouter({"就这样": {"confirm": True, "departments": DEPARTMENTS,
                                    "assignments": ASSIGNMENTS, "reply": "落地"}})
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="就这样",
                                state={"scale": "small", "departments": DEPARTMENTS,
                                       "assignments": ASSIGNMENTS}, router=router)
    assert resp["done"] is True and resp["state"] is None
    assert resp["applied"]["departments"] == 2 and resp["applied"]["bindings"] == 2
    tree = {n["org_id"]: n for n in store.org_tree(tenant_id="t1")}
    assert {"company", "dept:生产", "dept:管理"} <= set(tree)
    assert tree["dept:生产"]["source"] == "manual"
    binds = {b["user_id"]: (b["role_codes"], b["org_id"]) for b in store.list_bindings(tenant_id="t1")}
    assert binds["张三"] == (["factory-director"], "dept:生产")
    assert binds["李四"] == (["team-leader"], "dept:生产")


async def test_roster_name_resolves_to_worker_code(store):
    roster = [{"worker_code": "***1234", "worker_name": "张三", "skill": "厂长"}]
    router = FakeRouter({"就这样": {"confirm": True, "departments": DEPARTMENTS,
                                    "assignments": ASSIGNMENTS}})
    await handle_message(store, tenant_id="t1", user_id="boss", message="就这样",
                         state={"scale": "small", "departments": DEPARTMENTS,
                                "assignments": ASSIGNMENTS}, roster=roster, router=router)
    binds = {b["user_id"]: b for b in store.list_bindings(tenant_id="t1")}
    assert "***1234" in binds and "张三" not in binds


async def test_model_unavailable_fails_loud(store):
    class DownRouter:
        async def guide_chat(self, **kwargs):
            return {"ok": False, "status": "error", "error": "connection refused"}

    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="小", router=DownRouter())
    assert "模型不可用" in resp["reply"]
    assert resp["done"] is False and resp["applied"] is None


async def test_missing_router_fails_loud(store):
    resp = await handle_message(store, tenant_id="t1", user_id="boss", message="小")
    assert "模型不可用" in resp["reply"]


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
    async def fake_guide_chat(self, **kwargs):
        msg = str(kwargs.get("message") or "")
        if not msg:
            return {"ok": True, "reply": "请选规模", "scale": None, "needs_scale": True,
                    "confirm": False, "departments": [], "assignments": [],
                    "scale_departments": SCALE_DEPARTMENTS}
        if "小" in msg:
            return {"ok": True, "reply": "已生成小规模", "scale": "small", "needs_scale": False,
                    "confirm": False, "departments": DEPARTMENTS, "assignments": ASSIGNMENTS,
                    "scale_departments": {}}
        if "就这样" in msg:
            return {"ok": True, "reply": "落地完成", "scale": None, "needs_scale": False,
                    "confirm": True, "departments": DEPARTMENTS, "assignments": ASSIGNMENTS,
                    "scale_departments": {}}
        return {"ok": True, "reply": "…", "scale": None, "needs_scale": False,
                "confirm": False, "departments": kwargs.get("departments") or [],
                "assignments": kwargs.get("assignments") or [], "scale_departments": {}}

    monkeypatch.setattr(QwenRouter, "guide_chat", fake_guide_chat)
    headers = {"X-Actor-User": "boss", "X-Actor-Roles": "admin", "X-Tenant-Id": "t1"}
    first = client.post("/api/guidance/chat", json={"tenant_id": "t1", "message": ""}, headers=headers)
    assert first.status_code == 200
    assert set(first.json()["scale_departments"]) == {"small", "medium", "large"}
    pick = client.post("/api/guidance/chat",
                       json={"tenant_id": "t1", "message": "小", "state": first.json()["state"]},
                       headers=headers)
    assert pick.json()["plan"]["departments"] == DEPARTMENTS
    done = client.post("/api/guidance/chat",
                       json={"tenant_id": "t1", "message": "就这样", "state": pick.json()["state"]},
                       headers=headers)
    assert done.json()["done"] is True
    assert done.json()["applied"]["bindings"] == 2
    assert {b["user_id"] for b in store.list_bindings(tenant_id="t1")} == {"张三", "李四"}
