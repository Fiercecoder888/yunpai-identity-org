from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

from .graph import YunpaiGraph
from .models import new_state
from .registry import ToolRegistry, build_runtime_registry
from .repository import RunRepository, SQLiteRunRepository


def create_app(*, repository: RunRepository | None = None, registry: ToolRegistry | None = None):
    try:
        from fastapi import FastAPI, File, HTTPException
        from fastapi.responses import StreamingResponse
    except ImportError as exc: raise RuntimeError("安装 fastapi 后才能启动 HTTP API") from exc
    if repository is None:
        db_path = Path(os.getenv("YUNPAI_RUN_DB", "runtime/yunpai-runs.sqlite"))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        repository = SQLiteRunRepository(db_path)
    graph = YunpaiGraph(registry or build_runtime_registry(), repository)
    app = FastAPI(title="Yunpai LangGraph", version="0.2.0")

    @app.get("/health")
    async def health():
        return {"status": "ok", "module": "yunpai-langgraph", "tools": len(graph.registry.specs), "bound_tools": len(graph.registry.handlers), "planner_model": graph.planner.router.config.public()}

    @app.get("/tools")
    async def list_tools(module: str | None = None):
        catalog = graph.registry.catalog()
        return {"tools": [item for item in catalog if module is None or item["module"] == module]}

    @app.get("/skills")
    async def list_skills():
        return {"skills": graph.skills.catalog()}

    @app.post("/runs")
    async def create_run(body: dict[str, Any]):
        request = body.get("request", body)
        if not isinstance(request, dict):
            raise HTTPException(422, "request must be an object")
        try:
            state = await graph.run(new_state(request, tenant_id=str(body.get("tenant_id", "default"))))
            return graph._public_state(state)
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

    def ndjson_response(events):
        async def body():
            async for event in events:
                yield json.dumps(event, ensure_ascii=False) + "\n"

        return StreamingResponse(
            body(),
            media_type="application/x-ndjson",
            headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
        )

    @app.post("/runs/stream")
    async def create_streaming_run(body: dict[str, Any]):
        request = body.get("request", body)
        if not isinstance(request, dict):
            raise HTTPException(422, "request must be an object")
        state = new_state(request, tenant_id=str(body.get("tenant_id", "default")))
        graph.repository.save(state)
        return ndjson_response(graph.stream(state))

    @app.post("/runs/upload")
    async def upload_run(file: Any = File(...), message: str = "请解析并验证这份订单", tenant_id: str = "default", workflow: str | None = None):
        from .order_workbook import parse_order_workbook

        raw = await file.read()
        if not raw:
            raise HTTPException(400, "uploaded file is empty")
        filename = str(file.filename or "order.xlsx")
        if Path(filename).suffix.lower() != ".xlsx":
            raise HTTPException(415, {"code": "UNSUPPORTED_FILE_TYPE", "message": "订单上传当前仅支持 XLSX"})
        try:
            document = parse_order_workbook(filename, raw)
            request: dict[str, Any] = {
                "message": message,
                "documents": [{"filename": filename, "content_type": file.content_type or "application/octet-stream", "content_b64": base64.b64encode(raw).decode("ascii")}],
                "document": document,
            }
            if workflow:
                request["workflow"] = workflow
            state = await graph.run(new_state(request, tenant_id=tenant_id))
            return graph._public_state(state)
        except (KeyError, ValueError, RuntimeError) as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.get("/runs")
    async def list_runs(tenant_id: str | None = None, limit: int = 100):
        return {"runs": [graph._public_state(state) for state in graph.repository.list(tenant_id=tenant_id, limit=limit)]}

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str):
        state = graph.repository.get(run_id)
        if state is None: raise HTTPException(404, "run not found")
        return graph._public_state(state)

    @app.post("/runs/{run_id}/resume")
    async def resume_run(run_id: str, body: dict[str, Any]):
        state = graph.repository.get(run_id)
        if state is None: raise HTTPException(404, "run not found")
        try:
            resumed = await graph.resume(state, str(body.get("decision", "allow")), body.get("supplement"), actor=str(body.get("actor", "operator")))
            return graph._public_state(resumed)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/runs/{run_id}/resume/stream")
    async def resume_stream(run_id: str, body: dict[str, Any]):
        state = graph.repository.get(run_id)
        if state is None:
            raise HTTPException(404, "run not found")
        decision = str(body.get("decision", "allow"))
        if state.get("status") != "waiting_human" or not state.get("pending_gate"):
            raise HTTPException(409, "run is not waiting_human")
        if decision not in {"allow", "approve", "continue", "retry", "reject", "stop"}:
            raise HTTPException(409, "unsupported gate decision")
        try:
            graph.validate_resume_decision(state, decision, body.get("supplement"))
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return ndjson_response(
            graph.stream_resume(
                state,
                decision,
                body.get("supplement"),
                actor=str(body.get("actor", "operator")),
            )
        )
    return app


def main() -> None:
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=9000)


if __name__ == "__main__":
    main()
