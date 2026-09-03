import pytest

from yunpai_langgraph.registry import build_default_registry


@pytest.mark.asyncio
async def test_http_binding_propagates_task_and_tenant(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self): pass
        def json(self): return {"items": []}

    class Client:
        def __init__(self, **kwargs): captured["timeout"] = kwargs["timeout"]
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def request(self, method, url, **kwargs):
            captured.update(method=method, url=url, **kwargs)
            return Response()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    registry = build_default_registry()
    registry.bind_http({"m4": "http://m4.test"})
    result = await registry.call("list_m4_tracking", {}, {"task_id": "TASK-1", "tenant_id": "TENANT-1"})
    assert result == {"items": []}
    assert captured["url"].startswith("http://m4.test/")
    assert captured["headers"]["X-Yunpai-Task-ID"] == "TASK-1"
    assert captured["headers"]["X-Yunpai-Tenant-ID"] == "TENANT-1"
    assert captured["params"] == {}


@pytest.mark.asyncio
async def test_http_binding_converts_base64_files_to_multipart(monkeypatch):
    import base64
    import httpx
    captured = {}

    class Response:
        def raise_for_status(self): pass
        def json(self): return {"status": "awaiting_review"}

    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def request(self, method, url, **kwargs):
            captured.update(kwargs)
            return Response()

    monkeypatch.setattr(httpx, "AsyncClient", Client)
    registry = build_default_registry()
    registry.bind_http({"m0": "http://m0.test"})
    payload = {"files": [{"filename": "order.json", "content_type": "application/json", "content_b64": base64.b64encode(b"{}").decode()}]}
    await registry.call("data_import_run", payload, {"task_id": "TASK-2"})
    field, file_tuple = captured["files"][0]
    assert field == "files"
    assert file_tuple == ("order.json", b"{}", "application/json")
