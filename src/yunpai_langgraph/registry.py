from __future__ import annotations

import json
import base64
from pathlib import Path
import os
from typing import Any
from urllib.parse import quote

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover - only used in dependency-free smoke environments
    class _SchemaError(ValueError):
        pass

    class _ValidationError(ValueError):
        def __init__(self, message: str):
            super().__init__(message)
            self.message, self.path = message, []

    class Draft202012Validator:  # type: ignore[no-redef]
        def __init__(self, schema: dict[str, Any]): self.schema = schema
        @staticmethod
        def check_schema(schema: dict[str, Any]) -> None:
            if not isinstance(schema, dict) or schema.get("type") not in (None, "object", "array", "string", "number", "integer", "boolean"):
                raise _SchemaError("unsupported or invalid JSON Schema")
        def iter_errors(self, instance: Any):
            expected = self.schema.get("type")
            if expected == "object" and not isinstance(instance, dict): yield _ValidationError("must be object"); return
            if expected == "array" and not isinstance(instance, list): yield _ValidationError("must be array"); return
            if isinstance(instance, dict):
                for key in self.schema.get("required", []):
                    if key not in instance: yield _ValidationError(f"'{key}' is a required property")
        def validate(self, instance: Any) -> None:
            error = next(self.iter_errors(instance), None)
            if error: raise error

from .contracts import ToolHandler, ToolSpec


class ToolRegistry:
    """全局唯一工具注册表；可加载 JSON manifest 并绑定本地/HTTP handler。"""

    def __init__(self) -> None:
        self.specs: dict[str, ToolSpec] = {}
        self.handlers: dict[str, ToolHandler] = {}

    def register(self, spec: ToolSpec, handler: ToolHandler | None = None) -> None:
        if spec.name in self.specs:
            raise ValueError(f"duplicate tool: {spec.name}")
        Draft202012Validator.check_schema(spec.input_schema)
        self.specs[spec.name] = spec
        if handler:
            self.handlers[spec.name] = handler

    def load_manifests(self, root: str | Path) -> None:
        paths = sorted(Path(root).glob("m*.well-known/tool.json"))
        if not paths:
            paths = sorted(Path(root).glob("m*.json"))
        for path in paths:
            data = json.loads(path.read_text(encoding="utf-8"))
            for item in data.get("tools", []):
                http = item.get("http", {})
                self.register(ToolSpec(
                    name=item["name"], module=data["module"], description=item["description"],
                    input_schema=item.get("input_schema", {"type": "object"}),
                    output_schema=item.get("output_schema", {"type": "object"}),
                    execution=item.get("execution", "sync"), base_url=data.get("base_url", ""),
                    method=http.get("method", "POST"), path=http.get("path", ""),
                    timeout_s=float(http.get("timeout_s", 60)), tool_type=item.get("type", "tool"),
                    agent_endpoints=item.get("agent_endpoints", {}), tags=tuple(item.get("tags", [])),
                ))

    def tools_for(self, module: str) -> list[ToolSpec]:
        return [s for s in self.specs.values() if s.module == module]

    async def call(self, name: str, payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        if name not in self.specs:
            raise KeyError(f"unknown tool: {name}")
        spec = self.specs[name]
        errors = sorted(Draft202012Validator(spec.input_schema).iter_errors(payload), key=lambda e: list(e.path))
        if errors:
            raise ValueError(f"invalid input for {name}: {errors[0].message}")
        handler = self.handlers.get(name)
        if handler is None:
            raise RuntimeError(f"tool {name} has no local handler; configure HTTP adapter")
        result = await handler(payload, context)
        Draft202012Validator(spec.output_schema).validate(result)
        return result

    def bind_http(self, base_urls: dict[str, str], *, timeout_s: float = 60.0, headers_by_module: dict[str, dict[str, str]] | None = None) -> None:
        """按模块 base URL 将工具绑定为 HTTP handler，并保留合同校验。"""
        for name, spec in self.specs.items():
            base_url = base_urls.get(spec.module)
            if not base_url:
                continue

            async def http_handler(payload: dict[str, Any], context: dict[str, Any], *, _spec=spec, _base=base_url):
                try:
                    import httpx
                except ImportError as exc:
                    raise RuntimeError("HTTP adapter requires httpx") from exc
                path, body = _spec.path, dict(payload)
                for key in list(body):
                    marker = "{" + key + "}"
                    if marker in path:
                        path = path.replace(marker, quote(str(body.pop(key)), safe=""))
                headers = {"X-Yunpai-Task-ID": str(context.get("task_id", ""))}
                headers.update((headers_by_module or {}).get(_spec.module, {}))
                if context.get("tenant_id"):
                    headers["X-Yunpai-Tenant-ID"] = str(context["tenant_id"])
                if context.get("idempotency_key"):
                    headers["Idempotency-Key"] = str(context["idempotency_key"])
                # The standalone M2 API consumes uploaded source files as
                # base64 JSON and stages them itself; other modules use the
                # generic multipart adapter.
                files = [] if _spec.module == "m2" else _extract_uploads(body)
                request_kwargs: dict[str, Any] = {"headers": headers}
                if files:
                    request_kwargs["files"] = files
                    request_kwargs["data"] = {
                        key: value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
                        for key, value in body.items()
                    }
                elif _spec.method.upper() in {"GET", "DELETE"}:
                    request_kwargs["params"] = body
                else:
                    request_kwargs["json"] = body
                async with httpx.AsyncClient(timeout=_spec.timeout_s or timeout_s) as client:
                    response = await client.request(_spec.method, _base.rstrip("/") + path, **request_kwargs)
                    response.raise_for_status()
                    value = response.json()
                    # The standalone M2 web adapter wraps its workflow result
                    # in {"result": ...}; normalize that transport envelope
                    # so ReviewerAgent sees the declared tool output directly.
                    if isinstance(value, dict) and set(value) == {"result"}:
                        return value["result"]
                    return value

            self.handlers[name] = http_handler

    def mcp_tools(self) -> list[dict[str, Any]]:
        return [spec.as_mcp_tool() for spec in self.specs.values()]

    def catalog(self) -> list[dict[str, Any]]:
        return [
            {
                "name": spec.name, "module": spec.module, "description": spec.description,
                "execution": spec.execution, "type": spec.tool_type,
                "http": {"method": spec.method, "path": spec.path, "timeout_s": spec.timeout_s},
                "bound": name in self.handlers,
            }
            for name, spec in self.specs.items()
        ]


def build_default_registry() -> ToolRegistry:
    from .workers import HANDLERS
    registry = ToolRegistry()
    manifest_root = Path(os.getenv("YUNPAI_MANIFEST_DIR", Path(__file__).with_name("manifests")))
    registry.load_manifests(manifest_root)
    for name, handler in HANDLERS.items():
        if name in registry.specs:
            registry.handlers[name] = handler
    return registry


def _extract_uploads(body: dict[str, Any]) -> list[tuple[str, tuple[str, bytes, str]]]:
    uploads: list[tuple[str, tuple[str, bytes, str]]] = []
    for key in list(body):
        value = body[key]
        items = value if isinstance(value, list) else [value]
        if not items or not all(isinstance(item, dict) and isinstance(item.get("content_b64"), str) for item in items):
            continue
        body.pop(key)
        for index, item in enumerate(items):
            try:
                raw = base64.b64decode(item["content_b64"], validate=True)
            except ValueError as exc:
                raise ValueError(f"invalid base64 upload in {key}[{index}]") from exc
            uploads.append((key, (str(item.get("filename") or f"{key}-{index}.bin"), raw, str(item.get("content_type") or "application/octet-stream"))))
    return uploads


def build_runtime_registry() -> ToolRegistry:
    registry = build_default_registry()
    transport = os.getenv("YUNPAI_TOOL_TRANSPORT", "local").lower()
    env = os.getenv("YUNPAI_ENV", "sandbox").lower()
    if env == "production" and transport != "http":
        # 生产环境护栏：拒绝用 local fixture 当生产工具面；必须由部署方提供 M0-M5 URL。
        raise RuntimeError("YUNPAI_ENV=production 要求 YUNPAI_TOOL_TRANSPORT=http（本地 fixture 仅限 sandbox/preview）")
    if transport == "http":
        # 选择性 HTTP 模块绑定（origin/dev M2：YUNPAI_HTTP_MODULES 控制哪些模块走远程）。
        selected = {
            item.strip().lower()
            for item in os.getenv("YUNPAI_HTTP_MODULES", "m0,m1,m2,m3,m4,m5").split(",")
            if item.strip()
        }
        urls = {
            module: os.getenv(f"{module.upper()}_URL", registry.tools_for(module)[0].base_url if registry.tools_for(module) else "")
            for module in selected
        }
        registry.bind_http({module: url for module, url in urls.items() if url})
        registry.environment = {"env": env, "transport": "http", "local_fixture": False}  # type: ignore[attr-defined]
    else:
        registry.environment = {"env": env, "transport": "local", "local_fixture": True}  # type: ignore[attr-defined]
    return registry
