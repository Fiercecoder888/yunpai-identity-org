"""Goal-mode contract tests.

These tests intentionally exercise Tool/Skill boundaries only.  They do not
change or extend Agent routing rules.
"""

import pytest

from yunpai_langgraph.contracts import ToolSpec
from yunpai_langgraph.registry import ToolRegistry
from yunpai_langgraph.skills import build_default_skill_registry


@pytest.mark.asyncio
async def test_tool_result_has_goal_mode_contract_envelope():
    async def handler(payload, context):
        return {"value": payload["value"]}

    registry = ToolRegistry()
    registry.register(ToolSpec(
        "demo_tool", "m0", "demo", {"type": "object", "required": ["value"]},
        {"type": "object"},
        capability="canonical_write",
        side_effect="candidate_write",
        review_gate="candidate",
        failure_codes=("STORE_UNAVAILABLE",),
        recovery_actions=("retry",),
        downstream_fields=("value",),
    ), handler)
    result = await registry.call("demo_tool", {"value": 1}, {})
    assert result["status"] == "success"
    assert result["data"]["value"] == 1
    assert result["execution_mode"] == "goal"
    assert result["decision_source"] == "skill_tool_contract"
    assert result["agent_route_mutation"] is False
    assert result["invoked_tools"] == ["demo_tool"]


@pytest.mark.asyncio
async def test_skill_result_exposes_next_actions_and_tool_provenance(tmp_path):
    root = tmp_path / "business"
    root.mkdir()
    (root / "sample.json").write_text('{"records":[{"kind":"order"}]}', encoding="utf-8")
    skills = build_default_skill_registry()
    result = await skills.call(
        "business-data-identification",
        {"root_path": str(root), "db_path": str(tmp_path / "catalog.sqlite")},
        {"task_id": "goal-test", "principal_id": "tester"},
    )
    assert result["execution_mode"] == "goal"
    assert result["decision_source"] == "skill_tool_contract"
    assert result["next_actions"]
    assert "review_candidates" in result["next_actions"]
    assert result["available_next_actions"] == result["next_actions"]


def test_tool_metadata_is_exposed_in_mcp_contract():
    spec = ToolSpec(
        "contract_tool", "m2", "contract", {"type": "object"}, {"type": "object"},
        capability="bom_sop_validate",
        side_effect="none",
        review_gate="engineering",
        failure_codes=("M2_STORE_UNAVAILABLE",),
        recovery_actions=("retry", "request_human_review"),
        downstream_fields=("route",),
    )
    annotations = spec.as_mcp_tool()["annotations"]
    assert annotations["capability"] == "bom_sop_validate"
    assert annotations["side_effect"] == "none"
    assert annotations["review_gate"] == "engineering"
    assert annotations["failure_codes"] == ["M2_STORE_UNAVAILABLE"]
    assert annotations["recovery_actions"] == ["retry", "request_human_review"]
    assert annotations["downstream_fields"] == ["route"]
