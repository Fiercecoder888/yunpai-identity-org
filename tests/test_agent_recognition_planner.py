"""01 planner 识别分支：sample → map_to_canonical → ingest_canonical（全程 agent 理解）。"""

from __future__ import annotations

import base64
import hashlib

import pytest

from yunpai_langgraph.agents import PlannerAgent
from yunpai_langgraph.graph import YunpaiGraph
from yunpai_langgraph.models import new_state
from yunpai_langgraph.registry import build_default_registry


def _material_csv() -> bytes:
    return "物料编码,材料名称,单位\nYA.001,铜箔,m\nYA.002,线材,m\n".encode("utf-8")


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _ok_mapping():
    return {
        "ok": True, "status": "ok",
        "decision": {
            "entity_type": "material",
            "records": [
                {"material_code": "YA.001", "material_name": "铜箔", "unit": "m"},
                {"material_code": "YA.002", "material_name": "线材", "unit": "m"},
            ],
            "confidence": 0.93, "needs_review": False, "reason": "物料表",
        },
        "model": {"provider": "qwen", "model": "test", "status": "ok"},
    }


class FakeRouter:
    def __init__(self, mapping=None, classify=None):
        self._mapping = mapping or _ok_mapping()
        self._classify = classify or {"ok": False, "status": "not_configured", "model": {"provider": "qwen", "status": "not_configured"}}
        self.map_calls = []
        self.classify_calls = []

    async def map_to_canonical(self, sample):
        self.map_calls.append(sample)
        return self._mapping

    async def classify(self, request, registry):
        self.classify_calls.append(request)
        return self._classify


def test_has_unrouted_file():
    assert PlannerAgent._has_unrouted_file({"attachments": [{"kind": "order", "content_b64": "AA=="}]}) is False
    assert PlannerAgent._has_unrouted_file({"attachments": [{"kind": "master_data", "content_b64": "AA=="}]}) is True
    assert PlannerAgent._has_unrouted_file({"documents": [{"filename": "a.xlsx"}]}) is False


@pytest.mark.asyncio
async def test_aplan_routes_file_to_ingest_canonical():
    router = FakeRouter()
    planner = PlannerAgent(router)
    sha = hashlib.sha256(_material_csv()).hexdigest()
    request = {
        "message": "识别这些文件",
        "attachments": [{"kind": "master_data", "filename": "物料.csv", "content_b64": _b64(_material_csv())}],
    }
    decision = await planner.aplan(request, build_default_registry())
    assert decision["route"] == "free"
    assert [step["tool"] for step in decision["steps"]] == ["ingest_canonical"]
    assert decision["route_decision"]["source"] == "agent_recognition"
    payload = request["payloads"]["ingest_canonical"]
    assert payload["entity_type"] == "material"
    assert payload["sha256"] == sha
    assert len(payload["records"]) == 2
    assert router.classify_calls == []  # 识别分支不触发 classify
    assert len(router.map_calls) == 1


@pytest.mark.asyncio
async def test_aplan_falls_back_on_low_confidence():
    low = _ok_mapping()
    low["decision"]["confidence"] = 0.4
    low["decision"]["needs_review"] = True
    router = FakeRouter(mapping=low)
    planner = PlannerAgent(router)
    request = {
        "message": "识别并落库业务资料",
        "attachments": [{"kind": "master_data", "filename": "物料.csv", "content_b64": _b64(_material_csv())}],
    }
    decision = await planner.aplan(request, build_default_registry())
    assert decision["route_decision"]["source"] != "agent_recognition"
    assert router.classify_calls  # 回落到 classify + 确定性兜底


@pytest.mark.asyncio
async def test_graph_runs_agent_recognition_and_lands(tmp_path, monkeypatch):
    monkeypatch.setenv("YUNPAI_CANONICAL_DB", str(tmp_path / "canonical.sqlite"))
    graph = YunpaiGraph()
    graph.planner.router = FakeRouter()
    request = {
        "message": "识别这些文件",
        "attachments": [{"kind": "master_data", "filename": "物料.csv", "content_b64": _b64(_material_csv())}],
    }
    state = await graph.run(new_state(request, tenant_id="default"))
    assert state["status"] == "completed"
    result = state["outputs"]["ingest_canonical"]
    assert result["success"] is True
    assert result["data"]["inserted_rows"] == 2

    from yunpai_langgraph.canonical_ingest import CanonicalLandingStore

    rows = CanonicalLandingStore(str(tmp_path / "canonical.sqlite")).query(entity_type="material")
    assert len(rows) == 2
    assert rows[0]["material_code"] == "YA.001"
