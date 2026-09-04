from __future__ import annotations

import json

import pytest

from yunpai_langgraph.pmc_plan_store import PmcPlanStore, input_checksum


def _payload(scenario: str = "SC-1", qty: int = 10) -> dict:
    return {"scenario_id": scenario, "orders": [{"order_id": "PO-1", "product_id": "P-1", "quantity": qty}]}


def test_save_draft_creates_versioned_plan_with_checksum(tmp_path):
    store = PmcPlanStore(tmp_path / "plans.sqlite")
    result = store.save_draft(
        scenario_id="SC-1", purpose="production", payload=_payload(),
        input_hash="h1", solver_hash="s1", idempotency_key="ik-1", task_id="T-1",
    )
    assert result["plan_version"] == "SC-1::v1"
    assert result["lifecycle_status"] == "draft"
    assert result["head"] == 1
    assert result["input_checksum"] == input_checksum(_payload())
    plan = store.get_plan("SC-1", "SC-1::v1")
    assert plan["task_id"] == "T-1"
    assert plan["solver_hash"] == "s1"
    assert any(event["event"] == "plan.created" for event in json.loads(plan["events_json"]))


def test_same_idempotency_key_replays_same_version(tmp_path):
    store = PmcPlanStore(tmp_path / "plans.sqlite")
    first = store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(), input_hash="h", solver_hash="s", idempotency_key="ik-dup", task_id="T-1")
    second = store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(), input_hash="h", solver_hash="s", idempotency_key="ik-dup", task_id="T-1")
    assert first["plan_version"] == second["plan_version"]
    assert second["head"] == 1


def test_same_key_different_payload_conflicts_and_replan_cas(tmp_path):
    store = PmcPlanStore(tmp_path / "plans.sqlite")
    v1 = store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(qty=10), input_hash="h", solver_hash="s", idempotency_key="ik-change", task_id="T-1")
    assert v1["plan_version"] == "SC-1::v1"
    # 同一幂等键 + 不同 payload -> 幂等冲突。
    with pytest.raises(ValueError, match="idempotency conflict"):
        store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(qty=20), input_hash="h2", solver_hash="s2", idempotency_key="ik-change", task_id="T-2")
    # 发布 v1 后重排用新幂等键 + expected_parent（CAS）产生新版本，不覆盖已发布计划。
    store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="approved", actor="planner-1")
    store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="released", actor="zhb")
    v2 = store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(qty=20), input_hash="h2", solver_hash="s2", idempotency_key="ik-replan", task_id="T-3", expected_parent_version="SC-1::v1")
    assert v2["plan_version"] == "SC-1::v2"
    assert store.get_plan("SC-1", "SC-1::v2")["parent_version"] == "SC-1::v1"
    # 基于过期 head 的 CAS 被拒绝。
    with pytest.raises(ValueError, match="CAS failed"):
        store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(qty=30), input_hash="h3", solver_hash="s3", idempotency_key="ik-stale", task_id="T-4", expected_parent_version="SC-1::v1")


def test_lifecycle_transition_enforces_order_and_records_audit(tmp_path):
    store = PmcPlanStore(tmp_path / "plans.sqlite")
    store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(), input_hash="h", solver_hash="s", idempotency_key="ik-1", task_id="T-1")
    assert store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="approved", actor="planner-1")["lifecycle_status"] == "approved"
    assert store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="released", actor="reviewer-1")["lifecycle_status"] == "released"
    assert store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="dispatched", actor="dispatch-1")["lifecycle_status"] == "dispatched"
    assert store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="execution", actor="mes-1")["lifecycle_status"] == "execution"
    # 跳过状态非法：execution 不能回退 released；draft 不能直接 dispatched。
    with pytest.raises(ValueError, match="illegal lifecycle transition"):
        store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="released")
    plan = store.get_plan("SC-1", "SC-1::v1")
    events = json.loads(plan["events_json"])
    assert len([e for e in events if e["event"] == "plan.transition"]) == 4
    assert events[-1]["actor"] == "mes-1"


def test_unknown_target_and_missing_plan_rejected(tmp_path):
    store = PmcPlanStore(tmp_path / "plans.sqlite")
    with pytest.raises(ValueError, match="unknown lifecycle status"):
        store.transition(scenario_id="SC-1", plan_version="SC-1::v1", target="invalid")
    with pytest.raises(ValueError, match="plan not found"):
        store.transition(scenario_id="SC-1", plan_version="SC-1::missing", target="approved")


def test_diff_versions_reports_input_changes(tmp_path):
    store = PmcPlanStore(tmp_path / "plans.sqlite")
    store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(qty=10), input_hash="h", solver_hash="s", idempotency_key="ik-diff-1", task_id="T-1")
    store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(qty=25), input_hash="h2", solver_hash="s2", idempotency_key="ik-diff-2", task_id="T-1")
    diff = store.diff_versions("SC-1", "SC-1::v1", "SC-1::v2")
    assert diff["change_count"] >= 1
    assert any(change["field"] == "orders" for change in diff["changes"])


def test_list_versions_orders_newest_first(tmp_path):
    store = PmcPlanStore(tmp_path / "plans.sqlite")
    for index in range(1, 4):
        store.save_draft(scenario_id="SC-1", purpose="production", payload=_payload(qty=index * 10), input_hash=f"h{index}", solver_hash=f"s{index}", idempotency_key=f"ik-{index}", task_id="T-1")
    versions = store.list_versions("SC-1")
    assert [item["plan_version"] for item in versions] == ["SC-1::v3", "SC-1::v2", "SC-1::v1"]


def test_run_pmc_v2_persists_draft_when_plan_store_db_given(tmp_path):
    import copy

    from yunpai_langgraph.pmc_v2_adapter import run_pmc_v2

    payload = {
        "idempotency_key": "persist-regression",
        "scenario_id": "SC-PERSIST-1",
        "scenario_purpose": "wip_pmc",
        "production_use_allowed": False,
        "execution_model": "STREAMING_FLOW",
        "transfer_batch_size": 10,
        "calendar_windows": [{"start_at": "2026-09-03T08:00:00+08:00", "end_at": "2026-09-03T17:00:00+08:00"}],
        "resources": [{"resource_id": "S-01", "resource_type": "STATION"}, {"resource_id": "W-01", "resource_type": "PERSON", "qualified_operation_codes": ["OP-01"]}],
        "orders": [{"order_id": "PO-PERSIST-1", "product_id": "P-1", "quantity": 10, "uom": "PCS"}],
        "routing_steps": [
            {"product_id": "P-1", "operation_id": "OP-01", "sequence": 1, "standard_minutes": 2, "required_station_codes": ["S-01"], "required_person_codes": ["W-01"], "parallel_allowed": True, "setup_minutes": 0},
        ],
        "tracking_task_id": "TASK-PERSIST-1",
        "plan_store_db": str(tmp_path / "plan-store.sqlite"),
    }
    result = run_pmc_v2(copy.deepcopy(payload))
    assert result["success"] is True
    data = result["data"]
    assert data["plan_store"]["lifecycle_status"] == "draft"
    assert data["plan_version"] == "SC-PERSIST-1::v1"
    store = PmcPlanStore(tmp_path / "plan-store.sqlite")
    plan = store.get_plan("SC-PERSIST-1", "SC-PERSIST-1::v1")
    assert plan is not None
    assert plan["solver_hash"] == data["solver_hash"]
