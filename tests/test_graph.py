import pytest
from io import BytesIO
from base64 import b64encode

from yunpai_langgraph.graph import YunpaiGraph, build_graph, invoke
from yunpai_langgraph.models import new_state


def workflow_request(*, shortage: bool = True):
    return {
        "workflow": "m0_m5",
        "documents": [{"filename": "order.json", "records": [{"kind": "order"}]}],
        "document": {"order_id": "SO-001", "product_code": "P-1", "quantity": 2, "due_date": "2026-09-10", "confidence": 1.0},
        "product": {"product_code": "P-1", "product_name": "Widget"},
        "bom_lines": [{"material_code": "MAT-1", "material_name": "Material", "quantity_per": 3, "unit": "pcs"}],
        "inventory": [{"material_code": "MAT-1", "quantity": 2 if shortage else 6}],
        "routing_steps": [{"operation_id": "OP-1", "sequence": 1, "processing_minutes": 5}],
        "resources": [{"resource_id": "R-1", "status": "available"}],
    }


async def approve_until_complete(graph: YunpaiGraph, state):
    seen = []
    while state["status"] == "waiting_human":
        gate_type = state["pending_gate"]["type"]
        seen.append(gate_type)
        if gate_type == "procurement":
            state = await graph.resume(state, "retry", {"supplier_by_material": {"MAT-1": "SUP-1"}}, actor="buyer-1")
        else:
            state = await graph.resume(state, "approve", actor="reviewer-1")
    return state, seen


@pytest.mark.asyncio
async def test_full_workflow_gates_and_completes():
    graph = YunpaiGraph()
    state, gates = await approve_until_complete(graph, await graph.run(new_state(workflow_request())))
    assert gates == ["candidate", "engineering", "procurement", "apply"]
    assert state["status"] == "completed"
    assert state["outputs"]["solve_scheduling"]["data"]["lifecycle_status"] == "released"
    assert state["outputs"]["import_m4_purchase_suggestions_json"]["tracking_task_id"] == state["task_id"]
    assert state["outputs"]["solve_scheduling"]["data"]["tracking_task_id"] == state["task_id"]
    assert state["outputs"]["run_m3_procurement_requirements"]["data"]["shortage_lines"][0]["shortage_qty"] == 4
    assert state["outputs"]["solve_scheduling"]["data"]["schedule"]["metrics"]["makespan_minutes"] == 10
    assert [step["tool"] for step in state["steps"] if step["status"] == "completed"] == [
        "data_import_run", "data_import_commit", "ingest_document", "run_bom_sop_workflow",
        "run_m3_procurement_requirements", "import_m4_purchase_suggestions_json", "solve_scheduling",
    ]
    assert len(state["approvals"]) == 4
    assert {entry["event"] for entry in state["trace"]} >= {"react.thought", "react.action", "react.observation", "react.review", "run.completed"}


@pytest.mark.asyncio
async def test_ready_inventory_skips_procurement_gate():
    graph = YunpaiGraph()
    state, gates = await approve_until_complete(graph, await graph.run(new_state(workflow_request(shortage=False))))
    assert gates == ["candidate", "engineering", "apply"]
    assert state["outputs"]["run_m3_procurement_requirements"]["data"]["availability_status"] == "ready"


@pytest.mark.asyncio
async def test_free_tool_path_uses_full_contract():
    request = workflow_request()
    request.pop("workflow")
    request["tool"] = "solve_scheduling"
    state = await invoke(request)
    assert state["route"] == "free"
    assert state["pending_gate"]["type"] == "apply"


@pytest.mark.asyncio
async def test_stream_order_attachment_is_parsed_before_m3_nullable_numbers():
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet["P6"] = "PO-STREAM-001"
    sheet["X7"] = "2026-09-12"
    sheet["E10"], sheet["I10"], sheet["J10"], sheet["R10"] = 1, "W-H909", "高清线", 4000
    output = BytesIO()
    workbook.save(output)
    request = workflow_request()
    request.pop("document")
    request["attachments"] = [{"kind": "order", "filename": "order.xlsx", "content_b64": b64encode(output.getvalue()).decode()}]
    graph = YunpaiGraph()
    state = new_state(request)
    payload = graph._payload_for(state, "ingest_document")
    assert payload["_fixture_document"]["quantity"] == 4000

    from yunpai_langgraph.workers import m3_mrp
    result = await m3_mrp({
        "order": {"order_qty": None, "order_id": "PO-STREAM-001"},
        "bom": {"lines": [{"material_code": "MAT-1", "qty_per": None, "loss_rate": None}]},
        "inventory_snapshot": [{"material_code": "MAT-1", "available_qty": None}],
    }, {"task_id": state["task_id"]})
    assert result["data"]["order_qty"] == 0


@pytest.mark.asyncio
async def test_unbound_free_tool_fails_closed():
    state = await invoke({"tool": "list_m4_tracking"})
    assert state["status"] == "failed"
    assert "no local handler" in state["errors"][0]["message"]


@pytest.mark.asyncio
async def test_free_side_effect_tool_requires_pre_execution_authorization():
    calls = []
    graph = YunpaiGraph()
    original = graph.registry.handlers["data_import_commit"]

    async def tracked(payload, context):
        calls.append((payload, context))
        return await original(payload, context)

    graph.registry.handlers["data_import_commit"] = tracked
    state = await graph.run(new_state({
        "tool": "data_import_commit",
        "payloads": {"data_import_commit": {"batch_id": "batch-1"}},
    }))
    assert state["status"] == "waiting_human"
    assert state["pending_gate"]["type"] == "authorization"
    assert state["pending_gate"]["pre_execution"] is True
    assert state["steps"] == []
    assert calls == []

    state = await graph.resume(state, "approve", actor="operator-1")
    assert state["status"] == "completed"
    assert len(calls) == 1
    assert len(state["steps"]) == 1
    assert state["steps"][0]["status"] == "completed"
    assert state["authorized_steps"] == ["free-0"]


@pytest.mark.asyncio
async def test_rejected_free_side_effect_tool_is_never_executed():
    graph = YunpaiGraph()
    state = await graph.run(new_state({
        "tool": "data_import_commit",
        "payloads": {"data_import_commit": {"batch_id": "batch-1"}},
    }))
    state = await graph.resume(state, "reject", actor="operator-1")
    assert state["status"] == "failed"
    assert state["steps"] == []
    assert state["outputs"] == {}


@pytest.mark.asyncio
async def test_chat_path_has_no_side_effect():
    state = await invoke({"message": "这个系统能做什么？"})
    assert state["status"] == "completed"
    assert state["steps"] == []
    assert "订单" in state["response"]


@pytest.mark.asyncio
async def test_reject_is_terminal_and_audited():
    graph = YunpaiGraph()
    state = await graph.run(new_state(workflow_request()))
    state = await graph.resume(state, "reject", actor="owner-1")
    assert state["status"] == "failed"
    assert state["approvals"][0]["actor"] == "owner-1"
    assert any(entry["event"] == "gate.decided" for entry in state["trace"])
    with pytest.raises(ValueError):
        await graph.resume(state, "allow")


@pytest.mark.asyncio
async def test_low_confidence_can_retry_with_corrected_document():
    graph = YunpaiGraph()
    state = await graph.run(new_state({"tool": "ingest_document", "document": {"order_id": "SO", "confidence": 0.2}}))
    assert state["pending_gate"]["type"] == "review"
    state = await graph.resume(state, "retry", {"document": {"order_id": "SO", "product_code": "P", "quantity": 1, "due_date": "2026-09-10", "confidence": 1.0}})
    assert state["status"] == "completed"
    assert [step["status"] for step in state["steps"]] == ["superseded", "completed"]


def test_compiled_graph_has_three_agent_nodes():
    graph = build_graph()
    if hasattr(graph, "get_graph"):
        assert {"planner", "worker", "reviewer"} <= set(graph.get_graph().nodes)


@pytest.mark.asyncio
async def test_compiled_graph_executes_to_first_gate():
    graph = build_graph()
    state = await graph.ainvoke(new_state(workflow_request()))
    assert state["status"] == "waiting_human"
    assert state["pending_gate"]["type"] == "candidate"
    assert state["workflow_version"] == "1.0.0"
