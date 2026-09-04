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


def test_build_runtime_registry_requires_http_in_production_env(monkeypatch):
    from yunpai_langgraph.registry import build_runtime_registry

    monkeypatch.setenv("YUNPAI_ENV", "production")
    monkeypatch.setenv("YUNPAI_TOOL_TRANSPORT", "local")
    with pytest.raises(RuntimeError, match="production"):
        build_runtime_registry()
    monkeypatch.delenv("YUNPAI_ENV")
    monkeypatch.delenv("YUNPAI_TOOL_TRANSPORT")


def test_build_runtime_registry_sandbox_marks_local_fixture(monkeypatch):
    from yunpai_langgraph.registry import build_runtime_registry

    monkeypatch.delenv("YUNPAI_ENV", raising=False)
    monkeypatch.setenv("YUNPAI_TOOL_TRANSPORT", "local")
    registry = build_runtime_registry()
    assert registry.environment["local_fixture"] is True
    assert registry.environment["transport"] == "local"
    monkeypatch.delenv("YUNPAI_TOOL_TRANSPORT")
