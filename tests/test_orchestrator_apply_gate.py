"""M1-M5 Orchestrator 任务定向测试：Apply Gate 接真实 M5 lifecycle（T4）。

覆盖：
- Graph Apply Gate（approve）调用 M5Repository.apply_release，draft 计划在
  DB 真实变为 approved -> released，scenario head revision 推进（CAS），
  不是只修改 RunState JSON；
- release 后回读 lifecycle/head 并写入 outputs；
- 同幂等重放（同 plan 已 released 且 head 一致）幂等返回成功；
- HEAD_CONFLICT/陈旧 head 时保持 waiting_human 且不推进 plan；
- pressure_only/validation failed 不可 release（repo 层拒绝）。
"""
import os

import pytest

from yunpai_langgraph.graph import YunpaiGraph
from yunpai_langgraph.m5_repository import M5Repository, M5RepositoryError
from yunpai_langgraph.models import new_state
from yunpai_langgraph.pmc_v2_adapter import run_pmc_v2

import json
from pathlib import Path


def _schema(name):
    manifest = json.loads(Path("src/yunpai_langgraph/manifests/m5.json").read_text(encoding="utf-8"))
    tool = next(t for t in manifest["tools"] if t["name"] == name)
    return tool["output_schema"]


def _payload():
    return {
        "idempotency_key": "APPLY-GATE-1",
        "scenario_id": "SC-APPLY",
        "scenario_purpose": "production",
        "planning_start": "2026-09-03T08:00:00+08:00",
        "calendar_windows": [
            {"calendar_ref": "CAL-A", "shift_code": "DAY",
             "start_at": "2026-09-03T08:00:00+08:00", "end_at": "2026-09-03T17:00:00+08:00"},
        ],
        "route_code": "ROUTE-P1", "route_version": "approved-v1",
        "route_approval_ref": "APPROVED-APPLY-1",
        "orders": [{"order_id": "SO-APPLY-1", "product_id": "P1", "quantity": 2, "uom": "PCS",
                    "due_time": "2026-09-10T17:00:00+08:00"}],
        "resources": [
            {"resource_id": "EQ-A", "resource_type": "EQUIPMENT", "name": "设备A",
             "equipment_type": "press", "capacity_per_hour": 60, "efficiency_factor": 1,
             "calendar_ref": "CAL-A", "status": "available", "capability_codes": ["P"]},
        ],
        "routing_steps": [
            {"product_id": "P1", "operation_id": "OP-10", "sequence": 10,
             "operation_name": "工序10", "standard_minutes": 5, "setup_minutes": 0,
             "required_equipment_codes": ["EQ-A"], "predecessors": [],
             "approval_ref": "APPROVED-APPLY-1"},
        ],
        "supply_entries": [
            {"order_line_id": "SO-APPLY-1::L1", "op_code": "OP-10", "readiness": "READY",
             "requirement_ref": "MAT-1", "inventory_snapshot_ref": "INV-1"},
        ],
    }


def _persist_draft(repo, scenario_id="SC-APPLY", *, purpose="production", idempotency="APPLY-GATE-1",
                   validation=None):
    payload = _payload()
    payload["scenario_id"] = scenario_id
    payload["scenario_purpose"] = purpose
    payload["idempotency_key"] = idempotency
    solved = run_pmc_v2(payload)
    digest = solved["data"]["input_hash"]
    version = f"plan-{scenario_id}-{digest[:10]}"
    bundle = solved["data"]["input_package"]
    repo.store_snapshots(scenario_id, bundle, tenant_id="t", task_id="k")
    repo.save_plan(
        plan_version=version, scenario_id=scenario_id, tenant_id="t", task_id="k",
        lifecycle_status="draft", parent_plan_version=None, input_hash=digest,
        solver_hash="solver-v2-1", algorithm_version="pmc-v2-frozen-20260902",
        scenario_purpose=purpose,
        validation_report=validation if validation is not None else solved["data"]["validator"],
        bundle=bundle, schedule=solved["data"]["schedule"], idempotency_key=idempotency,
    )
    return version, solved


def _graph_state_with_draft(repo_path, version, scenario_id="SC-APPLY", *, legacy_preview=False):
    repo = M5Repository(repo_path)
    plan = repo.get_plan(version)
    state = new_state({
        "m5_db_path": repo_path,
        "expected_head_revision": 0,
        "scenario_id": scenario_id,
        "legacy_preview": legacy_preview,
    })
    state["outputs"]["solve_scheduling"] = {
        "data": {
            "plan_version": version,
            "scenario_id": scenario_id,
            "schedule": plan.get("schedule", {}),
            "input_hash": plan.get("input_hash", ""),
            "validator": plan.get("validation_report", {}),
            "lifecycle_status": "draft",
        }
    }
    return state


@pytest.fixture
def repo(tmp_path):
    return M5Repository(tmp_path / "m5.sqlite")


def test_apply_gate_releases_real_plan_and_reads_back(tmp_path):
    repo_path = str(tmp_path / "m5-apply.sqlite")
    repo = M5Repository(repo_path)
    version, _ = _persist_draft(repo)
    graph = YunpaiGraph()
    state = _graph_state_with_draft(repo_path, version)
    result = graph._apply_approval(
        state,
        {"type": "apply", "tool": "solve_scheduling", "module": "m5", "step_index": 0},
        actor="zhb",
    )
    assert result["applied"] is True
    assert "真实发布" in result["message"]
    readback = M5Repository(repo_path).readback_after_release(version, "SC-APPLY")
    assert readback["lifecycle_status"] == "released"
    assert readback["head_plan_version"] == version
    assert readback["head_revision"] == 1
    # RunState 输出也带真实回读结果
    data = state["outputs"]["solve_scheduling"]["data"]
    assert data["lifecycle_status"] == "released"
    assert data["head_revision"] == 1


def test_apply_gate_is_idempotent_for_same_released_plan(tmp_path):
    repo_path = str(tmp_path / "m5-apply-idem.sqlite")
    repo = M5Repository(repo_path)
    version, _ = _persist_draft(repo)
    graph = YunpaiGraph()
    state = _graph_state_with_draft(repo_path, version)
    first = graph._apply_approval(
        state, {"type": "apply", "tool": "solve_scheduling", "module": "m5"}, actor="zhb")
    assert first["applied"] is True
    # 同 plan 已 released 且 head 指向它：幂等重放成功，不产生重复 release
    state2 = _graph_state_with_draft(repo_path, version)
    second = graph._apply_approval(
        state2, {"type": "apply", "tool": "solve_scheduling", "module": "m5"}, actor="zhb")
    assert second["applied"] is True
    events = M5Repository(repo_path).lifecycle_events(version)
    released = [e for e in events if e["to_status"] == "released"]
    assert len(released) == 1
    head = M5Repository(repo_path).get_head("SC-APPLY")
    assert head["revision"] == 1


def test_apply_gate_conflict_keeps_waiting_human(tmp_path):
    """body 冒充/陈旧 head：head 已被占用时 approve 抛 ValueError，
    state 恢复 waiting_human + pending_gate(conflict)，不推进 plan。"""
    repo_path = str(tmp_path / "m5-apply-conflict.sqlite")
    repo = M5Repository(repo_path)
    version, _ = _persist_draft(repo)
    repo.set_head("SC-APPLY", "other-plan")  # 先被其他计划占用 head revision=1
    graph = YunpaiGraph()
    state = _graph_state_with_draft(repo_path, version)
    from fastapi.testclient import TestClient
    from yunpai_langgraph.api import create_app
    from yunpai_langgraph.repository import SQLiteRunRepository
    # 通过 graph.resume 路径验证保持 waiting_human
    state["status"] = "waiting_human"
    state["pending_gate"] = {"type": "apply", "tool": "solve_scheduling", "module": "m5", "step_index": 0}
    state["steps"] = [{"id": "w-0", "module": "m5", "tool": "solve_scheduling", "status": "running"}]
    with pytest.raises(ValueError) as exc:
        import asyncio
        asyncio.run(graph.resume(state, "approve", actor="zhb"))
    assert "HEAD_CONFLICT" in str(exc.value)
    assert state["status"] == "waiting_human"
    assert state["pending_gate"]["conflict"]["code"] == "HEAD_CONFLICT"
    # plan 仍是 draft，未假 released
    plan = M5Repository(repo_path).get_plan(version)
    assert plan["lifecycle_status"] == "draft"


def test_pressure_only_and_validation_failed_cannot_release(tmp_path):
    repo = M5Repository(tmp_path / "m5-blocked.sqlite")
    pressure_version, _ = _persist_draft(repo, scenario_id="SC-PRESSURE", purpose="pressure_only", idempotency="P-1")
    with pytest.raises(M5RepositoryError) as exc:
        repo.apply_release(pressure_version, "SC-PRESSURE", gate="apply", actor="zhb")
    assert exc.value.code == "PURPOSE_NOT_RELEASABLE"
    fail_version, _ = _persist_draft(repo, scenario_id="SC-FAIL", idempotency="F-1",
                                     validation={"status": "fail", "errors": [{"reason_code": "SUPPLY_NOT_READY"}]})
    with pytest.raises(M5RepositoryError) as exc:
        repo.apply_release(fail_version, "SC-FAIL", gate="apply", actor="zhb")
    assert exc.value.code == "VALIDATION_FAILED"


def test_apply_release_output_matches_m5_manifest_schema(tmp_path):
    """apply 后回读结果应满足 get_m5_schedule 输出 schema 关键字段。"""
    repo_path = str(tmp_path / "m5-schema.sqlite")
    repo = M5Repository(repo_path)
    version, _ = _persist_draft(repo)
    graph = YunpaiGraph()
    state = _graph_state_with_draft(repo_path, version)
    graph._apply_approval(state, {"type": "apply", "tool": "solve_scheduling", "module": "m5"}, actor="zhb")
    readback = M5Repository(repo_path).readback_after_release(version, "SC-APPLY")
    for key in ("plan_version", "scenario_id", "lifecycle_status", "head_revision", "lifecycle_events"):
        assert key in readback
