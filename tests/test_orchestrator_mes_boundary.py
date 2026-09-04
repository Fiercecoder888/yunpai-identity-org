"""M1-M5 Orchestrator 任务定向测试：MES 下发边界（T6，条件任务）。

当前没有正式 MES endpoint/ACK 合同：本任务只验收 durable pending dispatch。
- released 计划可创建 dispatch，持久化 status=pending；
- acknowledged_count 必须为 0，不得把 pending 写成 sent/acknowledged；
- 同幂等键重放返回 replayed，不产生重复 dispatch；
- 非 released / 缺 operation_keys / 缺幂等键失败关闭。
"""
import asyncio

import pytest

from yunpai_langgraph import m5_tools as mt
from yunpai_langgraph.m5_repository import M5Repository


def _released_plan(repo, ctx):
    """复用 lifecycle 测试的求解/持久化/批准/发布流程。"""
    payload = {
        "idempotency_key": "DISPATCH-T6-1",
        "scenario_id": "SC-DISPATCH",
        "scenario_purpose": "production",
        "planning_start": "2026-09-03T08:00:00+08:00",
        "calendar_windows": [
            {"calendar_ref": "CAL-A", "shift_code": "DAY",
             "start_at": "2026-09-03T08:00:00+08:00", "end_at": "2026-09-03T17:00:00+08:00"},
        ],
        "route_code": "ROUTE-P1", "route_version": "approved-v1",
        "route_approval_ref": "APPROVED-DISPATCH-1",
        "orders": [{"order_id": "SO-DISPATCH-1", "product_id": "P1", "quantity": 2, "uom": "PCS",
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
             "approval_ref": "APPROVED-DISPATCH-1"},
        ],
        "supply_entries": [
            {"order_line_id": "SO-DISPATCH-1::L1", "op_code": "OP-10", "readiness": "READY",
             "requirement_ref": "MAT-1", "inventory_snapshot_ref": "INV-1"},
        ],
    }
    from yunpai_langgraph.pmc_v2_adapter import run_pmc_v2
    solved = run_pmc_v2(payload)
    digest = solved["data"]["input_hash"]
    version = f"plan-SC-DISPATCH-{digest[:10]}"
    bundle = solved["data"]["input_package"]
    repo.store_snapshots("SC-DISPATCH", bundle, tenant_id=ctx["tenant_id"], task_id=ctx["task_id"])
    repo.save_plan(plan_version=version, scenario_id="SC-DISPATCH", tenant_id=ctx["tenant_id"],
                   task_id=ctx["task_id"], lifecycle_status="draft", parent_plan_version=None,
                   input_hash=digest, solver_hash="solver-v2-1",
                   algorithm_version="pmc-v2-frozen-20260902", scenario_purpose="production",
                   validation_report=solved["data"]["validator"], bundle=bundle,
                   schedule=solved["data"]["schedule"], idempotency_key="DISPATCH-T6-1")
    repo.apply_release(version, "SC-DISPATCH", tenant_id=ctx["tenant_id"], gate="apply",
                       actor="zhb", task_id=ctx["task_id"], expected_head_revision=0)
    return version


@pytest.fixture
def ctx(tmp_path):
    return {"task_id": "TASK-DISPATCH", "tenant_id": "tenant-dispatch",
            "m5_db_path": str(tmp_path / "m5.sqlite")}


def test_dispatch_is_durable_pending_without_mes_ack(ctx):
    repo = M5Repository(ctx["m5_db_path"])
    version = _released_plan(repo, ctx)
    result = asyncio.run(mt.m5_dispatch_schedule(
        {"plan_version": version, "idempotency_key": "D-1",
         "operation_keys": ["SO-DISPATCH-1::OP-10"], "target_system": "mes"},
        ctx))
    assert result["success"] is True
    data = result["data"]
    assert data["status"] == "pending"
    assert data["acknowledged_count"] == 0
    assert data["failed_count"] == 0
    # 没有 MES ACK 合同：绝不把 pending 写成 sent/acknowledged。
    assert data["status"] != "sent"
    stored = repo.get_dispatch(data["id"])
    assert stored is not None
    assert stored["status"] == "pending"
    # 同幂等键重放 -> replayed，不产生重复 dispatch
    again = asyncio.run(mt.m5_dispatch_schedule(
        {"plan_version": version, "idempotency_key": "D-1",
         "operation_keys": ["SO-DISPATCH-1::OP-10"]}, ctx))
    assert again["success"] is True
    assert again["data"]["replayed"] is True
    assert len(repo.list_dispatch(version)) == 1


def test_dispatch_rejects_non_released_and_missing_args(ctx):
    repo = M5Repository(ctx["m5_db_path"])
    payload = {
        "idempotency_key": "X-1", "scenario_id": "SC-X",
        "scenario_purpose": "production",
        "planning_start": "2026-09-03T08:00:00+08:00",
        "calendar_windows": [{"calendar_ref": "CAL-A", "shift_code": "DAY",
                              "start_at": "2026-09-03T08:00:00+08:00", "end_at": "2026-09-03T17:00:00+08:00"}],
        "route_code": "R1", "route_version": "v1", "route_approval_ref": "AP-1",
        "orders": [{"order_id": "SO-1", "product_id": "P1", "quantity": 1, "uom": "PCS", "due_time": "2026-09-10T17:00:00+08:00"}],
        "resources": [{"resource_id": "EQ-A", "resource_type": "EQUIPMENT", "name": "设备A",
                       "equipment_type": "press", "capacity_per_hour": 60, "efficiency_factor": 1,
                       "calendar_ref": "CAL-A", "status": "available"}],
        "routing_steps": [{"product_id": "P1", "operation_id": "OP-10", "sequence": 10,
                           "standard_minutes": 5, "required_equipment_codes": ["EQ-A"],
                           "predecessors": [], "approval_ref": "AP-1"}],
        "supply_entries": [{"order_line_id": "SO-1::L1", "op_code": "OP-10", "readiness": "READY",
                             "requirement_ref": "MAT-1", "inventory_snapshot_ref": "INV-1"}],
    }
    from yunpai_langgraph.pmc_v2_adapter import run_pmc_v2
    solved = run_pmc_v2(payload)
    digest = solved["data"]["input_hash"]
    bundle = solved["data"]["input_package"]
    repo.save_plan(plan_version="plan-SC-X-1", scenario_id="SC-X", tenant_id="t", task_id="k",
                   lifecycle_status="draft", parent_plan_version=None, input_hash=digest,
                   solver_hash="s", algorithm_version="a", scenario_purpose="production",
                   validation_report=solved["data"]["validator"], bundle=bundle, schedule={})
    # draft 计划不能派工
    blocked = asyncio.run(mt.m5_dispatch_schedule(
        {"plan_version": "plan-SC-X-1", "idempotency_key": "D-2", "operation_keys": ["SO-1::OP-10"]}, ctx))
    assert blocked["success"] is False
    assert blocked["errors"][0]["code"] == "NOT_RELEASED"
    # 缺 operation_keys
    missing_keys = asyncio.run(mt.m5_dispatch_schedule(
        {"plan_version": "plan-SC-X-1", "idempotency_key": "D-3"}, ctx))
    assert missing_keys["errors"][0]["code"] == "MISSING_OPERATION_KEYS"
