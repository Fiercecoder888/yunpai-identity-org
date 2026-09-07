"""API 入口租户 fail-closed（P1.2）：缺租户不再静默落 default。

对齐 M1 适配器语义：/runs、/runs/stream、/runs/upload、/runs/upload/batch
四个入口缺租户（body/form 参数与 X-Yunpai-Tenant-ID / X-Tenant-ID 头都没有）
时返回 400 MISSING_TENANT；设置 YUNPAI_DEFAULT_TENANT 后单租户内网部署
行为等价于旧的静默回退。
"""

from __future__ import annotations

import pytest

from fastapi.testclient import TestClient

from yunpai_langgraph.api import create_app
from yunpai_langgraph.repository import InMemoryRunRepository

from test_graph import workflow_request


def _client() -> TestClient:
    return TestClient(create_app(repository=InMemoryRunRepository()))


def test_create_run_without_tenant_fails_closed():
    response = _client().post("/runs", json=workflow_request())
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "MISSING_TENANT"


def test_create_run_with_body_tenant_ok():
    created = _client().post("/runs", json={**workflow_request(), "tenant_id": "tenant-a"})
    assert created.status_code == 200
    assert created.json()["tenant_id"] == "tenant-a"


def test_create_run_accepts_tenant_header_without_body_tenant():
    created = _client().post("/runs", json=workflow_request(),
                             headers={"X-Yunpai-Tenant-ID": "tenant-h"})
    assert created.status_code == 200
    assert created.json()["tenant_id"] == "tenant-h"
    legacy_header = _client().post("/runs", json=workflow_request(),
                                   headers={"X-Tenant-ID": "tenant-h2"})
    assert legacy_header.status_code == 200
    assert legacy_header.json()["tenant_id"] == "tenant-h2"


def test_stream_run_without_tenant_fails_closed():
    response = _client().post("/runs/stream", json=workflow_request())
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "MISSING_TENANT"


def test_upload_without_tenant_fails_closed(tmp_path):
    from io import BytesIO
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet["P6"] = "PO-TENANT-001"
    output = BytesIO()
    workbook.save(output)
    response = _client().post(
        "/runs/upload",
        params={"message": "请解析并校验这份订单"},
        files={"file": ("order.xlsx", output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "MISSING_TENANT"
    # 缺租户的拒绝先于内容处理：不会落任何 run。
    assert _client().get("/runs", params={"tenant_id": "default"}).json()["runs"] == []


def test_upload_with_tenant_header_ok(tmp_path):
    from io import BytesIO
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet["P6"] = "PO-TENANT-002"
    output = BytesIO()
    workbook.save(output)
    response = _client().post(
        "/runs/upload",
        params={"message": "请解析并校验这份订单"},
        headers={"X-Yunpai-Tenant-ID": "tenant-up"},
        files={"file": ("order.xlsx", output.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert response.status_code == 200
    assert response.json()["tenant_id"] == "tenant-up"


def test_batch_upload_without_tenant_fails_closed():
    response = _client().post(
        "/runs/upload/batch",
        data={"mode": "master_data"},
        files=[("files", ("设备台账.json", b'{"records":[{"kind":"equipment"}]}', "application/json"))],
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "MISSING_TENANT"


def test_default_tenant_compat_switch_restores_legacy_behavior(monkeypatch):
    monkeypatch.setenv("YUNPAI_DEFAULT_TENANT", "intranet")
    client = _client()
    created = client.post("/runs", json=workflow_request())
    assert created.status_code == 200
    assert created.json()["tenant_id"] == "intranet"
    streamed = client.post("/runs/stream", json=workflow_request())
    assert streamed.status_code == 200
    # 显式租户仍优先于兼容开关。
    explicit = client.post("/runs", json={**workflow_request(), "tenant_id": "tenant-x"})
    assert explicit.json()["tenant_id"] == "tenant-x"


def test_default_tenant_switch_only_applies_when_set(monkeypatch):
    monkeypatch.delenv("YUNPAI_DEFAULT_TENANT", raising=False)
    response = _client().post("/runs", json=workflow_request())
    assert response.status_code == 400
    # 开关设为空串等同未设置（显式声明才生效）。
    monkeypatch.setenv("YUNPAI_DEFAULT_TENANT", "  ")
    response = _client().post("/runs", json=workflow_request())
    assert response.status_code == 400
