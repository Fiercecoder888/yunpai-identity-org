from yunpai_langgraph.pmc_v2_adapter import run_pmc_v2


def _payload():
    resources = []
    for index in range(12):
        resources.extend([
            {"resource_id": f"S-{index + 1:02d}", "resource_type": "STATION"},
            {"resource_id": f"W-{index + 1:02d}", "resource_type": "PERSON", "qualified_operation_codes": [f"OP-{index + 1:02d}"]},
        ])
    return {
        "idempotency_key": "streaming-regression",
        "scenario_id": "STREAMING-12-OPS",
        "scenario_purpose": "wip_pmc",
        "production_use_allowed": True,
        "execution_model": "STREAMING_FLOW",
        "transfer_batch_size": 10,
        "calendar_windows": [{"start_at": "2026-09-03T08:00:00+08:00", "end_at": "2026-09-03T17:00:00+08:00"}],
        "resources": resources,
        "orders": [{"order_id": "PO-STREAM-001", "product_id": "W-H128", "quantity": 30, "uom": "PCS"}],
        "routing_steps": [
            {"product_id": "W-H128", "operation_id": f"OP-{i:02d}", "sequence": i,
             "operation_name": f"工序{i:02d}", "standard_minutes": 2 if i == 1 else 1,
             "required_station_codes": [f"S-{i:02d}"], "required_person_codes": [f"W-{i:02d}"],
             "predecessors": [f"OP-{i - 1:02d}"] if i > 1 else [],
             "parallel_allowed": True, "setup_minutes": 2 if i == 2 else 0}
            for i in range(1, 13)
        ],
    }


def test_streaming_route_expands_batches_and_projects_quantity_wip():
    result = run_pmc_v2(_payload())
    assert result["success"] is True
    schedule = result["data"]["schedule"]
    assert schedule["execution_model"] == "STREAMING_FLOW"
    assert schedule["metrics"]["operation_count"] == 36
    assert len(schedule["operations"]) == 36
    assert any(op["batch_index"] == 2 for op in schedule["operations"])
    op1_b2 = next(op for op in schedule["operations"] if op["op_code"] == "OP-01" and op["batch_index"] == 2)
    op2_b1 = next(op for op in schedule["operations"] if op["op_code"] == "OP-02" and op["batch_index"] == 1)
    assert op1_b2["plan_start"] == op2_b1["plan_start"]
    assert len(schedule["wip_edges"]) == 11
    assert any(float(seg["end_quantity"]) > 0 for seg in schedule["wip_segments"])
    assert any(seg["state"] == "starved" for seg in schedule["state_segments"])


def test_streaming_adapter_satisfies_registered_m5_output_contract():
    from yunpai_langgraph.registry import build_default_registry

    payload = _payload()
    payload["scenario_purpose"] = "production"
    payload["wip_pmc"] = True
    payload["production_use_allowed"] = False
    payload["tracking_task_id"] = "TASK-PMCV2-REGISTRY"
    payload["planning_start"] = "2026-09-03T08:00:00+08:00"
    payload["orders"][0]["due_time"] = "2026-09-04T17:00:00+08:00"
    payload["resources"] = [{**item, "name": item.get("resource_id")} for item in payload["resources"]]
    payload["resources"].append({"resource_id": "EQ-01", "name": "验证设备", "resource_type": "EQUIPMENT"})
    payload["routing_steps"] = [
        {**item, "eligible_resources": [{"resource_id": "EQ-01", "processing_minutes": 1}]}
        for item in payload["routing_steps"]
    ]
    result = __import__("asyncio").run(
        build_default_registry().call("solve_scheduling", payload, {"task_id": "TASK-PMCV2-REGISTRY"})
    )
    assert result["data"]["parent_plan_version"] is None
    assert result["data"]["tracking_task_id"] == "TASK-PMCV2-REGISTRY"
    assert result["data"]["schedule"]["execution_model"] == "STREAMING_FLOW"
    assert result["data"]["schedule"]["production_blocked"] is True
