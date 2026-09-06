import base64
import json

from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.graph import YunpaiGraph
from yunpai_langgraph.repository import InMemoryRunRepository

from test_graph import workflow_request


def read_events(response):
    return [json.loads(line) for line in response.iter_lines() if line]


def test_stream_api_emits_gate_and_resume_events():
    client = TestClient(create_app(repository=InMemoryRunRepository()))
    response = client.post("/runs/stream", json=workflow_request())
    assert response.headers["content-type"].startswith("application/x-ndjson")
    events = read_events(response)
    assert [event["type"] for event in events] == [
        "run_start", "assistant_delta", "state_snapshot", "assistant_delta",
        "step_start", "step_result", "state_snapshot", "assistant_delta",
        "step_start", "step_result", "gate_opened", "state_snapshot", "run_done",
    ]
    assert events[0]["run_id"] == events[-1]["run_id"]
    assert events[0]["task_id"] == events[-1]["task_id"]
    run_id = events[0]["run_id"]

    resumed = client.post(
        f"/runs/{run_id}/resume/stream",
        json={"decision": "approve", "actor": "steward"},
        headers={"X-Actor-User": "steward", "X-Actor-Roles": "data-steward,admin"},
    )
    resumed_events = read_events(resumed)
    assert resumed_events[0]["type"] == "run_start"
    assert resumed_events[-1]["type"] == "run_done"
    assert next(event for event in resumed_events if event["type"] == "gate_opened")["gate"]["type"] == "engineering"
    assert {event["task_id"] for event in resumed_events} == {events[0]["task_id"]}


def test_stream_api_accepts_attachment_metadata_without_streaming_file_body():
    client = TestClient(create_app(repository=InMemoryRunRepository()))
    payload = {
        "message": "导入基础数据",
        "attachments": [{
            "kind": "master_data", "filename": "master.json", "content_type": "application/json",
            "content_b64": base64.b64encode(b'{"records":[{"kind":"material"}]}').decode(),
        }],
    }
    events = read_events(client.post("/runs/stream", json=payload))
    snapshot = next(event["state"] for event in events if event["type"] == "state_snapshot")
    assert snapshot["request"]["attachments"][0]["filename"] == "master.json"
    assert snapshot["request"]["attachments"][0]["content_b64"] == "[omitted]"
    assert next(event for event in events if event["type"] == "gate_opened")["gate"]["type"] == "candidate"


def test_public_state_redacts_nested_file_bodies():
    state = {
        "request": {"attachments": [{"filename": "order.xlsx", "content_b64": "secret"}]},
        "outputs": {"m2": {"bom_files": [{"filename": "bom.xlsx", "content_b64": "secret-2"}]}},
    }

    public = YunpaiGraph._public_state(state)

    assert public["request"]["attachments"][0]["content_b64"] == "[omitted]"
    assert public["outputs"]["m2"]["bom_files"][0]["content_b64"] == "[omitted]"
