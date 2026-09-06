"""Architecture guardrails for the Goal-mode implementation."""

from pathlib import Path

from yunpai_langgraph.registry import build_runtime_registry
from yunpai_langgraph.skills import build_default_skill_registry


def test_all_registered_skills_use_registered_tools():
    registry = build_runtime_registry()
    skills = build_default_skill_registry()
    skills.validate_tools(registry.specs)
    assert registry.specs
    assert all(spec.capability for spec in registry.specs.values())
    assert all(spec.side_effect in {"none", "local_write", "candidate_write", "canonical_write", "external_write"} for spec in registry.specs.values())
    assert all(spec.review_gate in {"none", "data", "candidate", "engineering", "procurement", "schedule"} for spec in registry.specs.values())


def test_production_registry_cannot_use_local_fixture(monkeypatch):
    monkeypatch.setenv("YUNPAI_ENV", "production")
    monkeypatch.setenv("YUNPAI_TOOL_TRANSPORT", "local")
    try:
        build_runtime_registry()
    except RuntimeError as exc:
        assert "YUNPAI_ENV=production" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("production registry accepted local fixture transport")


def test_goal_mode_contract_does_not_add_agent_route_rules():
    """The guard is intentionally read-only: routing source remains frozen."""
    agent_source = Path("src/yunpai_langgraph/agents.py").read_text(encoding="utf-8")
    assert "YUNPAI_HTTP_MODULES" not in agent_source
    assert "LEGACY_PATH_DETECTED" not in agent_source
