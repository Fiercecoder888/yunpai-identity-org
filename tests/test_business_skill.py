from __future__ import annotations

import json

import pytest

from yunpai_langgraph.agents import PlannerAgent
from yunpai_langgraph.graph import YunpaiGraph
from yunpai_langgraph.llm import QwenConfig, QwenRouter
from yunpai_langgraph.models import new_state
from yunpai_langgraph.registry import build_default_registry
from yunpai_langgraph.skills import build_default_skill_registry


def test_planner_selects_business_data_skill_for_upload_intent():
    planner = PlannerAgent(QwenRouter(QwenConfig(enabled=False)), build_default_skill_registry())
    decision = planner.plan({"message": "识别并落库业务资料", "documents": []}, build_default_registry())
    assert decision["route"] == "free"
    assert decision["steps"][0]["tool"] == "business-data-identification"
    assert decision["steps"][0]["kind"] == "skill"


@pytest.mark.asyncio
async def test_business_data_skill_runs_after_planner_and_opens_review_gate(tmp_path):
    root = tmp_path / "business"
    root.mkdir()
    (root / "sample.json").write_text(json.dumps({"records": [{"kind": "order"}]}), encoding="utf-8")
    graph = YunpaiGraph()
    graph.planner = PlannerAgent(QwenRouter(QwenConfig(enabled=False)), graph.skills)
    state = await graph.run(new_state({"message": "识别并落库业务资料", "business_data_root": str(root), "business_catalog_db": str(tmp_path / "catalog.sqlite")}))
    assert state["status"] == "waiting_human"
    assert state["plan"][0]["tool"] == "business-data-identification"
    assert state["outputs"]["business-data-identification"]["status"] == "candidate_created"
    assert state["pending_gate"]["type"] == "candidate"
    assert any(event.get("event") == "agent.intent" for event in state["trace"])
    assert any(event.get("event") == "agent.route" and "business-data-identification" in event.get("selected_tools", []) for event in state["trace"])
