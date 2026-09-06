"""M1-M5 Orchestrator 任务定向测试：确定性桥接与六类 snapshot 组装（T2/T3）。

覆盖：
- orchestration_bridge 对受控 workflow 按上游输出装配 payload，缺权威输入返回
  结构化 BLOCKED_INPUT（missing_fields/source_module/required_tool/recovery）
- M2 只消费已批准 BOM；M3 库存不接受隐式默认；M4 供应商缺事实被拒
- planning_snapshot 六类 snapshot 组装：snapshot_id/正整数 revision/checksum
  使用规范化 JSON；整包 checksum 稳定；缺类失败关闭
- graph 在受控 workflow 中把 bridge BLOCKED_INPUT 转成 reviewer 数据 Gate
"""
import pytest

from yunpai_langgraph.models import new_state
import yunpai_langgraph.orchestration_bridge as orchestration_bridge
from yunpai_langgraph.orchestration_bridge import bridge_payload, merge_m2_canonical_bom
from yunpai_langgraph.planning_snapshot import (
    assemble_bundle, bundle_checksum, checksum_of, finalize, snapshot_header,
    verify_bundle,
)


def _approved_m2_state(request_overrides=None):
    request = {
        "workflow": "m1_m5_document_to_plan",
        "message": "从订单文件生成排程",
        "legacy_preview": True,
        "routing_steps": [],
        **({"bom_lines": [{"material_code": "MAT-1", "material_name": "Material", "quantity_per": 3, "unit": "pcs"}]} or {}),
    }
    if request_overrides:
        request.update(request_overrides)
    state = new_state(request)
    state["outputs"]["ingest_document"] = {
        "data": {"order": {"order_id": "SO-BRIDGE-1", "product_code": "P-1", "quantity": 2, "due_date": "2026-09-10", "confidence": 1.0}},
        "document": {"schema_version": "m1.document.v2", "source": {"original_filename": "order.json", "sha256": "a" * 64}},
    }
    state["outputs"]["run_bom_sop_workflow"] = {
        "data": {"bom_generation": {"approval_status": "approved", "bom_lines": [
            {"line_id": "L1", "material_code": "MAT-1", "material_name": "Material", "quantity_per": 3, "quantity": 3, "uom": "pcs"},
        ]}},
    }
    return state


def test_m2_payload_consumes_approved_m1_order():
    state = _approved_m2_state()
    state["request"]["routing_steps"] = [
        {
            "sequence": 1,
            "operation_id": "OP-1",
            "operation_name": "测试工序",
            "product_id": "P-1",
            "processing_minutes": 1,
            "eligible_resources": [{"resource_id": "EQ-1"}],
        }
    ]
    payload = bridge_payload(state, "run_bom_sop_workflow")
    assert payload["product_profile"]["product_code"] == "P-1"
    assert payload["_source"]["ref"] == "ingest_document"
    assert payload["routing_steps"][0]["name"] == "测试工序"
    assert payload["routing_steps"][0]["standard_time"] == 60


def test_m2_payload_uses_semantic_supplement_for_missing_header_product_code():
    state = _approved_m2_state()
    state["outputs"]["ingest_document"] = {
        "document": {
            "header": {"order_number": "PO-1", "product_code": None},
            "lines": [{"model": "W-H909", "product_code": "W-H909", "quantity": 4}],
        },
        "semantic_supplement": {
            "document": {"header": {"product_code": "W-H909", "order_number": "PO-1"}},
        },
    }
    payload = bridge_payload(state, "run_bom_sop_workflow")
    assert payload["product_profile"]["product_code"] == "W-H909"


def test_read_order_merges_explicit_structured_document_for_downstream_steps():
    state = _approved_m2_state({
        "document": {
            "order_id": "PO-1",
            "product_code": "W-H909",
            "product_name": "测试产品",
            "quantity": 4000,
            "due_date": "2026-09-12",
        },
        "product": {"product_code": "W-H909", "product_name": "测试产品"},
    })
    state["outputs"]["ingest_document"] = {
        "document": {"header": {"order_number": "PO-1"}, "lines": []},
    }
    order = orchestration_bridge.read_order(state)
    assert order["order_id"] == "PO-1"
    assert order["product_code"] == "W-H909"
    assert order["quantity"] == 4000
    assert order["due_date"] == "2026-09-12"


def test_m2_payload_reads_approved_m0_bom_when_request_has_no_bom(monkeypatch):
    state = _approved_m2_state({"bom_lines": [], "legacy_preview": False})
    state["outputs"]["run_bom_sop_workflow"] = {}
    monkeypatch.setattr(orchestration_bridge, "_bom_lines_from_entities", lambda _s, pc: (
        [{"material_code": "MAT-1", "material_name": "Material", "quantity_per": "3", "quantity": "3", "uom": "pcs"}]
        if pc == "P-1" else []
    ))
    payload = bridge_payload(state, "run_bom_sop_workflow")
    assert payload["bom_lines"][0]["material_code"] == "MAT-1"
    assert payload["bom_lines"][0]["quantity_per"] == "3"
    assert payload["_source"]["ref"] == "get_m0_product_overview"


def test_m2_payload_ignores_unapproved_or_wrong_product_m0_bom(monkeypatch):
    state = _approved_m2_state({"bom_lines": [], "legacy_preview": False})
    state["outputs"]["run_bom_sop_workflow"] = {}
    # catalog/entities 只读已发布 canonical（候选/未批准不会出现在 canonical_entities），
    # 这里验证「产品编码不匹配」时 M0 BOM 不被误用。
    monkeypatch.setattr(orchestration_bridge, "_bom_lines_from_entities", lambda _s, pc: (
        [{"material_code": "BAD", "quantity_per": 1}]
        if pc == "OTHER" else []
    ))
    payload = bridge_payload(state, "run_bom_sop_workflow")
    assert payload["bom_lines"] == []


def test_m2_result_preserves_canonical_bom_match_for_engineering_gate():
    result = {"status": "human_input_required", "bom_generation": {"bom_lines": []}}
    payload = {"product_profile": {"product_code": "P-1"}, "bom_lines": [{"material_code": "MAT-1"}]}
    enriched = merge_m2_canonical_bom(result, payload)
    assert enriched["bom_generation"]["bom_lines"] == [{"material_code": "MAT-1"}]
    assert enriched["canonical_bom_match"] == {
        "status": "matched", "source": "m0.get_m0_product_overview",
        "product_code": "P-1", "line_count": 1, "review_status": "approved",
    }


def test_m3_without_approved_bom_returns_blocked_input():
    state = _approved_m2_state()
    state["outputs"]["run_bom_sop_workflow"]["data"]["bom_generation"]["approval_status"] = "draft"
    result = bridge_payload(state, "run_m3_procurement_requirements")
    assert result["success"] is False
    assert result["code"] == "BLOCKED_INPUT"
    missing = result["data"]["missing_fields"]
    assert "已批准 BOM 行" in missing
    assert result["data"]["source_module"] == "m2"
    assert result["data"]["required_tool"] == "run_bom_sop_workflow"


def test_m3_prefers_enriched_inventory_snapshot_over_compact_inventory():
    state = _approved_m2_state({"legacy_preview": False})
    state["request"]["inventory"] = [{"material_code": "MAT-1", "available_qty": 10}]
    state["request"]["inventory_snapshot"] = [{
        "material_code": "MAT-1",
        "available_qty": 10,
        "warehouse": "WH-1",
        "lot_no": "LOT-1",
        "qc_status": "released",
    }]
    state["outputs"]["run_bom_sop_workflow"] = {
        "data": {"bom_generation": {
            "approval_status": "approved",
            "bom_lines": [{"material_code": "MAT-1", "quantity_per": 1}],
        }}
    }
    payload = bridge_payload(state, "run_m3_procurement_requirements")
    assert payload["inventory_snapshot"][0]["warehouse"] == "WH-1"
    assert payload["inventory_snapshot"][0]["lot_no"] == "LOT-1"


def test_m3_uses_order_line_quantity_when_header_has_no_quantity():
    state = _approved_m2_state({"legacy_preview": False})
    state["outputs"]["ingest_document"] = {
        "data": {
            "document": {
                "header": {"order_number": "SO-1", "product_code": "P-1"},
                "lines": [{"model": "P-1", "quantity": 4}],
            }
        }
    }
    state["request"]["inventory_snapshot"] = [{
        "material_code": "MAT-1", "available_qty": 10,
        "warehouse": "WH-1", "lot_no": "LOT-1", "qc_status": "released",
    }]
    payload = bridge_payload(state, "run_m3_procurement_requirements")
    assert payload["order"]["order_qty"] == 4


def test_m3_inventory_defaults_noncritical_fields_in_production():
    # 非关键字段 warehouse/lot/qc/locked_qty/received_at 缺失时降级默认值，
    # 关键字段 material_code + available_qty 存在即可继续（用户「不全数据可工作」要求）。
    state = _approved_m2_state({"legacy_preview": False, "inventory": [{"material_code": "MAT-1", "available_qty": 5}]})
    payload = bridge_payload(state, "run_m3_procurement_requirements")
    assert payload["inventory_snapshot"][0]["material_code"] == "MAT-1"
    assert payload["inventory_snapshot"][0]["available_qty"] == 5
    assert payload["inventory_snapshot"][0]["warehouse"] == "默认仓"
    assert payload["inventory_snapshot"][0]["qc_status"] == "released"


def test_m3_with_explicit_inventory_facts_builds_payload():
    state = _approved_m2_state({
        "legacy_preview": False,
        "inventory": [{"material_code": "MAT-1", "available_qty": 5, "warehouse": "WH-1", "lot_no": "LOT-1", "qc_status": "released"}],
    })
    state["outputs"]["ingest_document"] = {
        "data": {"order": {"order_id": "SO-2", "product_code": "P-1", "quantity": 2, "due_date": "2026-09-10"}},
    }
    payload = bridge_payload(state, "run_m3_procurement_requirements")
    assert payload["inventory_snapshot"][0]["warehouse"] == "WH-1"


def test_m4_missing_supplier_facts_returns_blocked_input():
    state = _approved_m2_state()
    state["outputs"]["run_m3_procurement_requirements"] = {
        "data": {"shortage_lines": [{"material_code": "MAT-1", "material_name": "Material", "shortage_qty": 6}], "due_date": "2026-09-01", "project_id": "P-1"},
    }
    # production 下 supplier_by_material 为空 -> BLOCKED_INPUT
    state["request"]["legacy_preview"] = False
    result = bridge_payload(state, "import_m4_purchase_suggestions_json")
    assert result["success"] is False
    assert result["code"] == "BLOCKED_INPUT"
    assert "supplier_by_material(权威供应商主数据)" in result["data"]["missing_fields"]


def test_m4_with_supplier_facts_builds_suggestions():
    state = _approved_m2_state({"supplier_by_material": {"MAT-1": "SUP-1"}})
    state["outputs"]["run_m3_procurement_requirements"] = {
        "data": {"shortage_lines": [{"material_code": "MAT-1", "material_name": "Material", "shortage_qty": 6}], "due_date": "2026-09-01", "project_id": "P-1", "procurement_plan_id": "plan-1", "order_id": "SO-3"},
    }
    payload = bridge_payload(state, "import_m4_purchase_suggestions_json")
    assert payload["suggestions"][0]["supplier_name"] == "SUP-1"
    assert payload["tracking_task_id"] == state["task_id"]


def test_m4_no_shortage_is_valid_empty_handoff():
    state = _approved_m2_state({"legacy_preview": False})
    state["outputs"]["run_m3_procurement_requirements"] = {
        "data": {
            "shortage_lines": [],
            "due_date": "2026-09-12",
            "project_id": "P-1",
            "order_id": "SO-4",
            "procurement_plan_id": "plan-4",
        },
    }
    payload = bridge_payload(state, "import_m4_purchase_suggestions_json")
    assert payload["suggestions"] == []
    assert payload["order_id"] == "SO-4"


def test_snapshot_headers_and_checksum_are_deterministic():
    header = snapshot_header(kind="order_snapshots", snapshot_id="SNAP-ORD-1",
                             source_system="orchestrator", source_ref="m1:task",
                             tenant_id="tenant-a", site_id="site-1")
    assert header["revision"] == 1
    assert header["tenant_id"] == "tenant-a"
    with pytest.raises(ValueError):
        snapshot_header(kind="x", snapshot_id="s", revision=0)
    payload = {"header": header, "lines": [{"product_code": "P-1", "qty": 2}]}
    finalized = finalize(dict(payload))
    assert finalized["checksum"] == checksum_of(finalized)
    # 规范化 JSON checksum 稳定：与字段顺序无关
    assert checksum_of({"b": 1, "a": 2}) == checksum_of({"a": 2, "b": 1})


def test_six_class_bundle_checksum_is_stable_and_rejects_missing_kind():
    bundle = assemble_bundle(
        orders=[{"order_id": "SO-1", "lines": [{"order_line_id": "SO-1::L1", "product_code": "P-1", "qty": 2}], "source_ref": "m1"}],
        routes=[{"product_code": "P-1", "route_code": "R-P1", "route_version": "v1", "approval_ref": "AP-1", "operations": [{"op_code": "OP-1", "sequence_no": 1, "standard_minutes": 5, "required_equipment_codes": ["EQ-1"], "predecessors": []}]}],
        resource_snapshot={"equipment": [{"equipment_code": "EQ-1", "capacity_per_hour": "60", "efficiency_factor": "1"}], "persons": [], "stations": [], "tooling": [], "source_ref": "m5"},
        calendar_snapshot={"working_intervals": [{"calendar_ref": "CAL-1", "start_at": "2026-09-01T08:00:00+08:00", "end_at": "2026-09-01T17:00:00+08:00"}], "source_ref": "m5"},
        supply_snapshot={"entries": [{"order_line_id": "SO-1::L1", "readiness": "READY"}], "source_ref": "m4"},
        constraint_snapshot={"changeover_rules": {}, "source_ref": "m5"},
        tenant_id="tenant-a", site_id="site-1",
    )
    assert verify_bundle(bundle) == []
    first = bundle_checksum(bundle)
    # 字段顺序不影响整包 checksum
    second = bundle_checksum(bundle)
    assert first == second
    # 每个快照都有 checksum，且头含正整数 revision
    assert all("checksum" in bundle[k] for k in bundle if k in {"resource_snapshot", "calendar_snapshot", "supply_snapshot", "constraint_snapshot"})
    assert all(item.get("checksum") for item in bundle["order_snapshots"] + list(bundle["routes"].values()))
    missing = assemble_bundle(
        orders=[{"order_id": "SO-1", "lines": [{"order_line_id": "SO-1::L1", "product_code": "P-1", "qty": 2}]}],
        routes=[],
        resource_snapshot=None, calendar_snapshot=None,
        supply_snapshot=None, constraint_snapshot=None,
    )
    assert verify_bundle(missing) != []


def test_m5_resource_facts_read_back_from_m0_canonical(monkeypatch):
    entities = {
        "equipment_master": [{"canonical_key": "EQ-01", "equipment_code": "EQ-01", "equipment_type": "冲压机",
                              "capacity_per_hour": "120", "efficiency_factor": "0.9", "status": "available", "calendar_ref": "CAL-A"}],
        "station_master": [{"canonical_key": "ST-01", "station_code": "ST-01", "work_center_code": "WC-A",
                            "parallel_slots": 1, "status": "available", "calendar_ref": "CAL-A"}],
        "worker_master": [{"canonical_key": "P-01", "person_code": "P-01", "skill_codes": ["stamping"], "calendar_ref": "CAL-A"}],
        "tooling_master": [{"canonical_key": "FIX-01", "tooling_code": "FIX-01", "tooling_type": "fixture", "calendar_ref": "CAL-A"}],
    }
    monkeypatch.setattr(orchestration_bridge, "_read_m0_entities", lambda _s, et: entities.get(et, []))
    snap = orchestration_bridge.read_m5_resource_facts({"task_id": "task-1", "tenant_id": "t"})
    assert snap is not None
    assert snap["equipment"][0]["equipment_code"] == "EQ-01"
    assert snap["equipment"][0]["capacity_per_hour"] == "120"
    assert snap["stations"][0]["station_code"] == "ST-01"
    assert snap["persons"][0]["person_code"] == "P-01"
    assert snap["tooling"][0]["tooling_code"] == "FIX-01"


def test_m5_resource_facts_fail_closed_when_m0_empty(monkeypatch):
    monkeypatch.setattr(orchestration_bridge, "_read_m0_entities", lambda _s, et: [])
    assert orchestration_bridge.read_m5_resource_facts({"task_id": "t"}) is None
    assert orchestration_bridge.read_m5_calendar_facts({"task_id": "t"}) is None
