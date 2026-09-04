from __future__ import annotations

import pytest

from yunpai_langgraph.pmc_execution import PmcExecutionStore


def test_dispatch_creates_pending_records_and_never_claims_mes_sent(tmp_path):
    store = PmcExecutionStore(tmp_path / "exec.sqlite")
    result = store.create_dispatch(
        plan_version="SC-1::v1", operation_keys=["OP-01", "OP-02"], order_id="PO-1",
        worker_id="W-01", idempotency_key="disp-ik-1", task_id="TASK-1",
    )
    assert result["status"] == "pending_created"
    assert result["dispatch_count"] == 2
    assert result["sent_to_mes"] is False
    summary = store.execution_summary("SC-1::v1")
    assert summary["event_count"] == 0


def test_dispatch_idempotent_replay(tmp_path):
    store = PmcExecutionStore(tmp_path / "exec.sqlite")
    first = store.create_dispatch(plan_version="SC-1::v1", operation_keys=["OP-01"], order_id="PO-1", worker_id="W-01", idempotency_key="ik", task_id="T-1")
    second = store.create_dispatch(plan_version="SC-1::v1", operation_keys=["OP-01"], order_id="PO-1", worker_id="W-01", idempotency_key="ik", task_id="T-1")
    assert second["status"] == "pending_replay"
    assert first["dispatch_count"] == 1


def test_dispatch_confirm_and_retry(tmp_path):
    store = PmcExecutionStore(tmp_path / "exec.sqlite")
    created = store.create_dispatch(plan_version="SC-1::v1", operation_keys=["OP-01"], order_id="PO-1", worker_id="W-01", idempotency_key="ik", task_id="T-1")
    assert created["dispatch_count"] == 1
    with store._connect() as db:
        dispatch_id = db.execute("SELECT dispatch_id FROM dispatch_records WHERE plan_version='SC-1::v1'").fetchone()[0]
    confirmed = store.confirm_dispatch(plan_version="SC-1::v1", dispatch_id=dispatch_id, action="confirm", actor="lead-1")
    assert confirmed["to_status"] == "confirmed"
    retried = store.confirm_dispatch(plan_version="SC-1::v1", dispatch_id=dispatch_id, action="retry", actor="lead-1")
    assert retried["to_status"] == "pending"


def test_record_events_persists_and_summarizes(tmp_path):
    store = PmcExecutionStore(tmp_path / "exec.sqlite")
    store.record_event(plan_version="SC-1::v1", event_type="start", worker_id="W-01", order_id="PO-1", operation_key="OP-01", idempotency_key="evt-1", task_id="T-1")
    store.record_event(plan_version="SC-1::v1", event_type="report", worker_id="W-01", order_id="PO-1", operation_key="OP-01", qty_good=100, idempotency_key="evt-2", task_id="T-1")
    store.record_event(plan_version="SC-1::v1", event_type="scrap", worker_id="W-01", order_id="PO-1", operation_key="OP-01", qty_scrap=3, idempotency_key="evt-3", task_id="T-1")
    store.record_event(plan_version="SC-1::v1", event_type="downtime", worker_id="W-01", order_id="PO-1", downtime_minutes=30, idempotency_key="evt-4", task_id="T-1")
    summary = store.execution_summary("SC-1::v1")
    assert summary["event_count"] == 4
    assert summary["by_type"]["report"] == 1
    assert summary["by_type"]["downtime"] == 1
    assert summary["total_scrap_qty"] == 3
    assert summary["latest_event_at"]
    # 幂等重放不重复计数
    store.record_event(plan_version="SC-1::v1", event_type="report", worker_id="W-01", order_id="PO-1", qty_good=100, idempotency_key="evt-2", task_id="T-1")
    assert store.execution_summary("SC-1::v1")["event_count"] == 4


def test_event_validation_rejects_missing_fields_and_bad_type(tmp_path):
    store = PmcExecutionStore(tmp_path / "exec.sqlite")
    with pytest.raises(ValueError, match="requires worker_id"):
        store.record_event(plan_version="SC-1::v1", event_type="start", worker_id="", order_id="PO-1", idempotency_key="ik", task_id="T-1")
    with pytest.raises(ValueError, match="unsupported execution event"):
        store.record_event(plan_version="SC-1::v1", event_type="not-an-event", worker_id="W-01", order_id="PO-1", idempotency_key="ik", task_id="T-1")


def test_material_impact_proposal_never_writes_upstream(tmp_path):
    store = PmcExecutionStore(tmp_path / "exec.sqlite")
    result = store.propose_material_impact(
        plan_version="SC-1::v1", scenario_id="SC-1",
        impacts=[{"material_code": "MAT-1", "required_qty": 50, "required_date": "2026-09-15"}],
        target_module="m3", idempotency_key="prop-ik-1", task_id="T-1",
    )
    assert result["proposal_status"] == "suggested"
    assert result["target_module"] == "m3"
    assert "授权 Gate" in result["detail"]
    with pytest.raises(ValueError, match="must be m3 or m4"):
        store.propose_material_impact(plan_version="SC-1::v1", scenario_id="SC-1", impacts=[{"material_code": "MAT-1", "required_qty": 1}], target_module="m0", idempotency_key="bad", task_id="T-1")
