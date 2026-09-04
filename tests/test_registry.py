from hashlib import sha256
import json
from pathlib import Path

import pytest

from yunpai_langgraph.contracts import ToolSpec
from yunpai_langgraph.m3_m4_tooling import M3_ADAPTER_TOOL_NAMES, M4_ADAPTER_TOOL_NAMES
from yunpai_langgraph.registry import ToolRegistry, build_default_registry, build_runtime_registry


EXPECTED = {"m0": 27, "m1": 17, "m2": 7, "m3": 17, "m4": 26, "m5": 20}


def test_registry_loads_all_original_m0_m5_contracts():
    registry = build_default_registry()
    assert len(registry.specs) == 114
    assert {module: len(registry.tools_for(module)) for module in EXPECTED} == EXPECTED
    # 合并 main(M3/M4 adapter) + pmctooldev(M5 PMC v2) 后真实绑定：
    # m0 5 + m1 1 + m2 1 + m3 16 + m4 24 + m5 18 = 65；m3/m4 两个 receive_* 排除。
    assert len(registry.handlers) == 65
    assert {"data_import_run", "data_import_status", "data_import_preview", "data_import_resolve", "data_import_commit"} <= set(registry.handlers)
    assert all(name in registry.handlers for name in M3_ADAPTER_TOOL_NAMES)
    assert all(name in registry.handlers for name in M4_ADAPTER_TOOL_NAMES)
    assert "receive_m3_material_demand" not in registry.handlers
    assert "receive_m4_schedule_impact_proposal" not in registry.handlers
    assert "import_m4_purchase_suggestions" not in registry.handlers


def test_packaged_and_documented_manifests_are_identical():
    for module in EXPECTED:
        packaged = Path(f"src/yunpai_langgraph/manifests/{module}.json").read_bytes()
        documented = Path(f"registry/tool-manifests/{module}.json").read_bytes()
        assert sha256(packaged).digest() == sha256(documented).digest()


def test_extracted_manifests_match_recorded_source_hashes():
    provenance = json.loads(Path("registry/SOURCE_PROVENANCE.json").read_text())
    for module, expected in provenance["manifests"].items():
        content = Path(f"registry/tool-manifests/{module}.json").read_bytes().replace(b"\r\n", b"\n")
        assert sha256(content).hexdigest() == expected


def test_duplicate_tool_fails_fast():
    registry = ToolRegistry()
    spec = ToolSpec("x", "m0", "x", {"type": "object"}, {"type": "object"})
    registry.register(spec)
    with pytest.raises(ValueError, match="duplicate"):
        registry.register(spec)


def test_manifest_contract_has_complete_http_metadata():
    registry = ToolRegistry()
    registry.load_manifests("registry/tool-manifests")
    spec = registry.specs["solve_scheduling"]
    assert spec.path == "/api/v1/schedule-candidates"
    assert spec.method == "POST"
    assert spec.timeout_s == 120
    assert spec.input_schema["required"][:3] == ["idempotency_key", "scenario_id", "planning_start"]


def test_catalog_reports_bound_state():
    registry = build_default_registry()
    catalog = {item["name"]: item for item in registry.catalog()}
    assert catalog["solve_scheduling"]["bound"] is True
    assert catalog["list_m4_tracking"]["bound"] is True
    assert catalog["receive_m4_schedule_impact_proposal"]["bound"] is False
    assert catalog["query_m4_material_supply_snapshot"]["http"]["required_headers"] == [
        "Authorization",
        "X-Yunpai-Task-ID",
        "Idempotency-Key",
    ]


def test_full_http_runtime_keeps_missing_receivers_unbound(monkeypatch):
    monkeypatch.setenv("YUNPAI_TOOL_TRANSPORT", "http")
    registry = build_runtime_registry()
    assert len(registry.handlers) == 112
    assert "receive_m3_material_demand" not in registry.handlers
    assert "receive_m4_schedule_impact_proposal" not in registry.handlers
