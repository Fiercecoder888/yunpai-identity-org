"""正式前端每条消息都带 ``tools: []``；空列表不得被当成显式路由。

回归缺陷：``agents.PlannerAgent.aplan`` 旧逻辑
``explicit = bool(... or isinstance(request.get("tools"), list))``
把任意 list（含空列表）判为显式路由 → chat 请求永远走确定性兜底，
模型 ``decision["answer"]`` 被丢弃（用户看到固定文案）。
"""
import pytest

from yunpai_langgraph.agents import PlannerAgent
from yunpai_langgraph.registry import build_default_registry


class _ChatRouter:
    """模型判定为解释性对话并给出 answer。"""

    async def classify(self, request, registry):
        return {
            "ok": True,
            "status": "ok",
            "decision": {
                "intent": "解释性对话",
                "route": "chat",
                "tools": [],
                "answer": "我可以协助处理订单、解析业务资料、生成 BOM/SOP 草稿、计算物料需求、形成采购建议和安排生产排程。",
                "confidence": 0.9,
                "reason": "解释性对话",
            },
            "model": {"provider": "qwen", "model": "test-model", "status": "ok"},
        }


@pytest.mark.asyncio
async def test_empty_tools_uses_model_answer_not_fallback():
    planner = PlannerAgent(_ChatRouter())
    decision = await planner.aplan(
        {"message": "你能做什么", "tools": []}, build_default_registry()
    )
    assert decision["route"] == "chat"
    assert decision["route_decision"]["source"] == "qwen"
    assert decision["response"].startswith("我可以协助处理订单")
    assert "请补充具体的订单" not in decision["response"]


@pytest.mark.asyncio
async def test_non_empty_tools_still_explicit_route():
    """显式传工具名时仍以请求为准（不得被模型提案覆盖）。"""
    planner = PlannerAgent(_ChatRouter())
    decision = await planner.aplan(
        {"message": "帮我注册几个工人账号", "tools": ["ingest_document"]}, build_default_registry()
    )
    assert decision["route_decision"]["source"] == "explicit"
    assert decision["route"] == "free"
    assert [step["tool"] for step in decision["steps"]] == ["ingest_document"]
