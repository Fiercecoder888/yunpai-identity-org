from __future__ import annotations

from yunpai_langgraph.pmc_metrics import compute_order_metrics, compute_resource_load, order_due_priority


def _snapshot(lines):
    return [{"order_id": "PO-1", "order_no": "PO-1", "lines": lines}]


def _operation(line_id, end, product="P-1"):
    return {"order_line_id": line_id, "product_code": product, "plan_end": end}


def test_on_time_rate_counts_only_lines_with_due():
    snapshots = _snapshot([
        {"order_line_id": "PO-1::L1", "product_code": "P-1", "qty": "1", "due_date": "2026-09-10T17:00:00+08:00"},
        {"order_line_id": "PO-1::L2", "product_code": "P-2", "qty": "1", "due_date": "2026-09-10T17:00:00+08:00"},
        {"order_line_id": "PO-1::L3", "product_code": "P-3", "qty": "1", "due_date": None},  # 无交期不误报
    ])
    operations = [
        _operation("PO-1::L1", "2026-09-10T16:00:00+08:00"),
        _operation("PO-1::L2", "2026-09-11T09:00:00+08:00"),
        _operation("PO-1::L3", "2026-09-30T09:00:00+08:00"),
    ]
    metrics = compute_order_metrics(operations, snapshots)
    assert metrics["lines_with_due"] == 2
    assert metrics["on_time_count"] == 1
    assert metrics["on_time_rate"] == 0.5
    assert metrics["total_tardiness_minutes"] > 0
    assert len(metrics["tardiness_orders"]) == 1
    assert metrics["tardiness_orders"][0]["order_line_id"] == "PO-1::L2"


def test_no_due_inputs_returns_null_not_zero():
    metrics = compute_order_metrics([_operation("PO-1::L1", "2026-09-10T16:00:00+08:00")], _snapshot([{"order_line_id": "PO-1::L1", "product_code": "P-1", "qty": "1"}]))
    assert metrics["on_time_rate"] is None
    assert metrics["total_tardiness_minutes"] is None
    assert metrics["lines_with_due"] == 0


def test_latest_operation_end_defines_order_completion():
    snapshots = _snapshot([{"order_line_id": "PO-1::L1", "product_code": "P-1", "qty": "1", "due_date": "2026-09-10T17:00:00+08:00"}])
    operations = [
        _operation("PO-1::L1", "2026-09-10T10:00:00+08:00"),
        _operation("PO-1::L1", "2026-09-10T18:00:00+08:00"),  # 最后工序晚于交期
    ]
    metrics = compute_order_metrics(operations, snapshots)
    assert metrics["on_time_count"] == 0
    assert metrics["tardiness_orders"][0]["completion_time"].startswith("2026-09-10T18:00:00")


def test_resource_load_aggregates_intervals():
    intervals = [
        {"resource_type": "STATION", "resource_code": "S-01", "start_minute": 0, "end_minute": 60},
        {"resource_type": "STATION", "resource_code": "S-01", "start_minute": 60, "end_minute": 120},
        {"resource_type": "PERSON", "resource_code": "W-01", "start_minute": 0, "end_minute": 60},
    ]
    load = compute_resource_load(intervals, makespan_minutes=120)
    assert load["total_busy_minutes"] == 180
    by_code = {item["resource_code"]: item for item in load["load_by_resource"]}
    assert by_code["S-01"]["busy_minutes"] == 120
    assert by_code["S-01"]["utilization"] == 1.0
    assert by_code["W-01"]["utilization"] == 0.5


def test_order_due_priority_maps_line_ids():
    facts = order_due_priority(_snapshot([
        {"order_line_id": "PO-1::L1", "product_code": "P-1", "qty": "1", "due_date": "2026-09-10T17:00:00+08:00", "priority": "urgent"},
    ]))
    assert facts["PO-1::L1"]["priority"] == "urgent"
    assert facts["PO-1::L1"]["order_id"] == "PO-1"
