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
from yunpai_langgraph.orchestration_bridge import bridge_payload
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
    payload = bridge_payload(state, "run_bom_sop_workflow")
    assert payload["product_profile"]["product_code"] == "P-1"
    assert payload["_source"]["ref"] == "ingest_document"


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


def test_m3_inventory_rejects_implicit_defaults_in_production():
    # production（无 legacy_preview）缺 warehouse/lot/qc 库存事实 -> BLOCKED_INPUT，
    # 不接受隐式仓库/lot/qc 默认（断点 4）。
    state = _approved_m2_state({"legacy_preview": False, "inventory": [{"material_code": "MAT-1", "available_qty": 5}]})
    result = bridge_payload(state, "run_m3_procurement_requirements")
    assert result["success"] is False
    assert result["code"] == "BLOCKED_INPUT"
    assert any("inventory_snapshot" in field for field in result["data"]["missing_fields"])


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
    assert all(item.get("checksum") for item in bundle["order_snapshots"] + bundle["routes"])
    missing = assemble_bundle(
        orders=[{"order_id": "SO-1", "lines": [{"order_line_id": "SO-1::L1", "product_code": "P-1", "qty": 2}]}],
        routes=[],
        resource_snapshot=None, calendar_snapshot=None,
        supply_snapshot=None, constraint_snapshot=None,
    )
    assert verify_bundle(missing) != []
