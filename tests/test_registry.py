from hashlib import sha256
import json
from pathlib import Path

import pytest

from yunpai_langgraph.contracts import ToolSpec
from yunpai_langgraph.registry import ToolRegistry, build_default_registry


EXPECTED = {"m0": 27, "m1": 17, "m2": 7, "m3": 17, "m4": 26, "m5": 20}


def test_registry_loads_all_original_m0_m5_contracts():
    registry = build_default_registry()
    assert len(registry.specs) == 114
    assert {module: len(registry.tools_for(module)) for module in EXPECTED} == EXPECTED
    assert len(registry.handlers) == 7


def test_packaged_and_documented_manifests_are_identical():
    for module in EXPECTED:
        packaged = Path(f"src/yunpai_langgraph/manifests/{module}.json").read_bytes()
        documented = Path(f"registry/tool-manifests/{module}.json").read_bytes()
        assert sha256(packaged).digest() == sha256(documented).digest()


def test_extracted_manifests_match_recorded_source_hashes():
    provenance = json.loads(Path("registry/SOURCE_PROVENANCE.json").read_text())
    for module, expected in provenance["manifests"].items():
        content = Path(f"registry/tool-manifests/{module}.json").read_bytes()
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
    assert catalog["list_m4_tracking"]["bound"] is False
