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
    # 合并 main(M3/M4 adapter) + pmctooldev(M5 PMC v2) + M1 专用 adapter 后真实绑定：
    # m0 5 + m1 17 + m2 1 + m3 16 + m4 24 + m5 18 = 81；m3/m4 两个 receive_* 排除。
    assert health["bound_tools"] == 81
    assert health["skills"] == 8
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
    skills = {item["name"]: item for item in client.get("/skills").json()["skills"]}
    assert "business-data-identification" in skills
    assert "dispatch_m5_schedule" in skills["yunpai-m5-pmc-lifecycle"]["tools"]


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


def test_api_batch_upload_requires_explicit_mode(tmp_path):
    from io import BytesIO
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet["P6"] = "PO-BATCH-001"
    sheet["E10"] = 1
    sheet["I10"] = "W-H909"
    sheet["R10"] = 4000
    output = BytesIO()
    workbook.save(output)
    client = TestClient(create_app(repository=SQLiteRunRepository(tmp_path / "batch.sqlite")))
    missing_mode = client.post(
        "/runs/upload/batch",
        files=[("files", ("order.xlsx", output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert missing_mode.status_code == 422
    invalid_mode = client.post(
        "/runs/upload/batch",
        data={"mode": "随便猜"},
        files=[("files", ("order.xlsx", output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert invalid_mode.status_code == 422
    assert invalid_mode.json()["detail"]["code"] == "INVALID_UPLOAD_MODE"

    created = client.post(
        "/runs/upload/batch",
        data={"mode": "master_data", "message": "识别这些基础资料"},
        files=[("files", ("设备台账.json", b'{"records":[{"kind":"equipment"}]}', "application/json"))],
    )
    assert created.status_code == 200
    state = created.json()
    assert state["route"] == "free"
    assert state["plan"][0]["kind"] == "skill"
    assert state["plan"][0]["tool"] == "business-data-identification"
    summary = state["upload_summary"]
    assert summary["mode"] == "master_data"
    assert summary["total"] == 1
    assert summary["accepted"] == 1
    assert summary["files"][0]["status"] == "accepted"
    assert summary["files"][0]["sha256"]


def test_api_batch_upload_flags_empty_files_as_skipped(tmp_path):
    client = TestClient(create_app(repository=SQLiteRunRepository(tmp_path / "batch-empty.sqlite")))
    response = client.post(
        "/runs/upload/batch",
        data={"mode": "directory"},
        files=[
            ("files", ("a.xlsx", b"", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")),
            ("files", ("b.json", b"{}", "application/json")),
        ],
    )
    assert response.status_code == 200
    summary = response.json()["upload_summary"]
    assert summary["total"] == 2
    statuses = {item["filename"]: item["status"] for item in summary["files"]}
    assert statuses["a.xlsx"] == "skipped"
    assert any(item["reason"] for item in summary["files"])
