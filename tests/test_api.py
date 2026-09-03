from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.repository import SQLiteRunRepository

from test_graph import workflow_request


def test_api_persists_lists_and_resumes_runs(tmp_path):
    repository = SQLiteRunRepository(tmp_path / "api.sqlite")
    client = TestClient(create_app(repository=repository))
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert health["module"] == "yunpai-langgraph"
    assert health["tools"] == 114
    assert health["bound_tools"] == 7
    assert health["planner_model"]["provider"] == "qwen"
    created = client.post("/runs", json=workflow_request()).json()
    assert created["pending_gate"]["type"] == "candidate"
    run_id = created["run_id"]
    assert client.get(f"/runs/{run_id}").json()["task_id"] == created["task_id"]
    assert len(client.get("/runs", params={"tenant_id": "default"}).json()["runs"]) == 1
    resumed = client.post(f"/runs/{run_id}/resume", json={"decision": "approve", "actor": "steward"}).json()
    assert resumed["pending_gate"]["type"] == "engineering"
    assert len(client.get("/tools", params={"module": "m5"}).json()["tools"]) == 20


def test_api_accepts_request_envelope_and_rejects_invalid_resume(tmp_path):
    client = TestClient(create_app(repository=SQLiteRunRepository(tmp_path / "envelope.sqlite")))
    created = client.post("/runs", json={
        "tenant_id": "tenant-a",
        "request": {
            "tool": "data_import_commit",
            "payloads": {"data_import_commit": {"batch_id": "batch-1"}},
        },
    }).json()
    assert created["tenant_id"] == "tenant-a"
    assert created["pending_gate"]["type"] == "authorization"
    assert created["steps"] == []
    rejected = client.post(
        f"/runs/{created['run_id']}/resume",
        json={"decision": "reject", "actor": "operator-1"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["outputs"] == {}
    conflict = client.post(f"/runs/{created['run_id']}/resume", json={"decision": "approve"})
    assert conflict.status_code == 409
    assert any(item["name"] == "business-data-identification" for item in client.get("/skills").json()["skills"])


def test_api_uploads_xlsx_and_records_intent_route(tmp_path):
    from io import BytesIO
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet["P6"] = "PO-UPLOAD-001"
    sheet["X6"] = "2026年8月12日"
    sheet["X7"] = "2026-09-01"
    sheet["G6"] = "供应商"
    sheet["E10"] = 1
    sheet["I10"] = "W-H909"
    sheet["J10"] = "高清线"
    sheet["R10"] = 4000
    sheet["V10"] = 3.4
    sheet["W10"] = 13600
    output = BytesIO()
    workbook.save(output)
    client = TestClient(create_app(repository=SQLiteRunRepository(tmp_path / "upload.sqlite")))
    response = client.post(
        "/runs/upload",
        params={"message": "请解析并校验这份订单"},
        files={"file": ("order.xlsx", output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 200
    state = response.json()
    assert state["route"] == "free"
    assert state["intent"]["name"] == "free"
    assert state["route_decision"]["source"] == "deterministic_fallback"
    assert state["model"]["status"] == "not_configured"
    assert state["plan"][0]["tool"] == "ingest_document"


def test_api_rejects_non_xlsx_upload_with_controlled_status(tmp_path):
    client = TestClient(create_app(repository=SQLiteRunRepository(tmp_path / "csv.sqlite")))
    response = client.post(
        "/runs/upload",
        files={"file": ("order.csv", b"order_id,quantity\nSO-1,1\n", "text/csv")},
    )
    assert response.status_code == 415
    assert response.json()["detail"]["code"] == "UNSUPPORTED_FILE_TYPE"
