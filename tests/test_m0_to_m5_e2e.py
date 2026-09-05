"""M0→M5 桥接集成测试：M5 六类 snapshot 从 M0 canonical 读回资源/日历事实。

验证 ③④ 的核心：bridge_payload("ingest_m5_planning_snapshot") 通过
read_m5_resource_facts / read_m5_calendar_facts 从 M0 canonical 读回
equipment/station/worker/tooling/calendar，组装成完整的六类 snapshot bundle。
"""
import base64
import json

import pytest

from yunpai_langgraph.m0_backend import M0Store
import yunpai_langgraph.orchestration_bridge as orchestration_bridge
from yunpai_langgraph.orchestration_bridge import bridge_payload


RESOURCE_RECORDS = [
    {"entity_type": "equipment_master", "equipment_code": "EQ-1", "equipment_type": "冲压机",
     "capability_codes": ["stamping"], "capacity_per_hour": "120", "efficiency_factor": "0.9",
     "status": "available", "calendar_ref": "CAL-1"},
    {"entity_type": "station_master", "station_code": "ST-1", "work_center_code": "WC-1",
     "parallel_slots": 1, "status": "available", "calendar_ref": "CAL-1"},
    {"entity_type": "worker_master", "person_code": "P-1", "skill_codes": ["stamping"],
     "qualified_operation_codes": ["OP-1"], "max_parallel_tasks": 1,
     "status": "available", "calendar_ref": "CAL-1"},
    {"entity_type": "tooling_master", "tooling_code": "FIX-1", "tooling_type": "fixture",
     "capability_codes": ["stamping"], "quantity_available": 1, "status": "available", "calendar_ref": "CAL-1"},
    {"entity_type": "production_calendar", "calendar_ref": "CAL-1",
     "working_intervals": [{"calendar_ref": "CAL-1", "shift_code": "DAY",
                            "start_at": "2026-09-05T08:00:00+08:00", "end_at": "2026-09-05T17:00:00+08:00"}],
     "unavailability": []},
]


def _state():
    doc = {"order_id": "SO-1", "product_code": "P-1", "quantity": 2, "due_date": "2026-09-10"}
    encoded = base64.b64encode(json.dumps(doc).encode()).decode()
    return {
        "task_id": "task-1", "tenant_id": "tenant-39092", "site_id": "default",
        "request": {
            "workflow": "m1_m5_document_to_plan", "scenario_purpose": "production",
            "document": {"_encoded": encoded, **doc},
            "bom_lines": [{"material_code": "MAT-1", "quantity_per": 3}],
            "inventory": [{"material_code": "MAT-1", "warehouse": "WH-1", "lot_no": "LOT-1",
                           "available_qty": 6, "locked_qty": 0, "qc_status": "released",
                           "received_at": "2026-09-01"}],
            "routing_steps": [{"operation_id": "OP-1", "sequence": 1, "standard_minutes": 5,
                               "required_equipment_codes": ["EQ-1"], "required_person_codes": ["P-1"],
                               "required_station_codes": ["ST-1"]}],
            "route_approval_ref": "APPROVED-SIM-001",
            "supply_entries": [{"order_line_id": "SO-1::L1", "readiness": "READY",
                                "requirement_ref": "MAT-1", "inventory_snapshot_ref": "INV-1"}],
            "setup_matrix": {"OP-1": {"OP-1": 0}},
        },
        "outputs": {
            "ingest_document": {"data": {"order": {"order_id": "SO-1", "product_code": "P-1",
                                                   "quantity": 2, "due_date": "2026-09-10"}}},
            "run_bom_sop_workflow": {"data": {
                "bom_generation": {"bom_lines": [{"material_code": "MAT-1", "quantity_per": 3}],
                                   "approval_status": "approved"},
                "sop_generation": {"route_steps": [{"operation_id": "OP-1", "sequence": 1,
                                                    "standard_minutes": 5,
                                                    "required_equipment_codes": ["EQ-1"],
                                                    "required_person_codes": ["P-1"],
                                                    "required_station_codes": ["ST-1"]}],
                                   "approval_status": "approved"},
            }},
            "run_m3_procurement_requirements": {"data": {"procurement_plan_id": "plan-1",
                                                         "order_id": "SO-1", "shortage_lines": []}},
        },
    }


def test_bridge_assembles_six_class_bundle_with_m0_resource_facts(tmp_path, monkeypatch):
    store = M0Store(tmp_path / "m0.sqlite")
    batch = store.ingest(RESOURCE_RECORDS, tenant_id="tenant-39092", task_id="t")
    store.publish(batch["batch_id"], actor="reviewer", reason="审批资源")

    def _read(state, entity_type):
        out = []
        for entity in store.list_entities(entity_type, tenant_id=state.get("tenant_id", "default"))["entities"]:
            out.append({"canonical_key": entity.get("canonical_key"), **(entity.get("payload_json") or {})})
        return out

    monkeypatch.setattr(orchestration_bridge, "_read_m0_entities", _read)

    payload = bridge_payload(_state(), "ingest_m5_planning_snapshot")
    bundle = payload["pmc_v2_bundle"]

    # 六类 snapshot 全部由 bridge 组装（verify_bundle 不再报缺失）
    for kind in ("order_snapshots", "routes", "resource_snapshot", "calendar_snapshot",
                 "supply_snapshot", "constraint_snapshot"):
        assert kind in bundle, f"{kind} 缺失"

    # 资源/日历事实来自 M0 canonical 读回，而非 request 直传
    equipment = bundle["resource_snapshot"]["equipment"]
    assert equipment[0]["equipment_code"] == "EQ-1"
    assert equipment[0]["capacity_per_hour"] == "120"
    assert equipment[0]["calendar_ref"] == "CAL-1"
    assert bundle["resource_snapshot"]["stations"][0]["station_code"] == "ST-1"
    assert bundle["resource_snapshot"]["persons"][0]["person_code"] == "P-1"
    assert bundle["resource_snapshot"]["tooling"][0]["tooling_code"] == "FIX-1"
    assert bundle["calendar_snapshot"]["working_intervals"][0]["calendar_ref"] == "CAL-1"


def test_bridge_fails_closed_when_m0_has_no_resource_facts(monkeypatch):
    monkeypatch.setattr(orchestration_bridge, "_read_m0_entities", lambda _s, _et: [])
    payload = bridge_payload(_state(), "ingest_m5_planning_snapshot")
    assert payload["success"] is False
    assert payload["code"] == "BLOCKED_INPUT"
    missing = payload["data"]["missing_fields"]
    assert any("resource_snapshot" in field or "calendar_snapshot" in field for field in missing)
