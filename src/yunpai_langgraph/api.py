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
        from fastapi import FastAPI, File, Form, Header, HTTPException
        from fastapi.responses import StreamingResponse
    except ImportError as exc: raise RuntimeError("安装 fastapi 后才能启动 HTTP API") from exc
    if repository is None:
        db_path = Path(os.getenv("YUNPAI_RUN_DB", "runtime/yunpai-runs.sqlite"))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        repository = SQLiteRunRepository(db_path)
    graph = YunpaiGraph(registry or build_runtime_registry(), repository)
    app = FastAPI(title="Yunpai LangGraph", version="0.2.0")

    def _principal_from_headers(headers: dict[str, str]) -> tuple[dict[str, Any], bool]:
        """从受信反向代理/认证中间件读取审批 principal（T5.2）。

        优先 ``X-Yunpai-Principal``（JSON：actor/roles/tenant_id），其次拆分头
        ``X-Actor-User`` + ``X-Actor-Roles`` + ``X-Tenant-Id``。
        返回 (principal, trusted)；无受信头且未强制受信时 actor 交由调用方
        从 body 取（dev/preview 降级），审计标记 principal_source=untrusted_body。
        """
        header = headers.get("x-yunpai-principal")
        if header:
            try:
                value = json.loads(header)
                actor = str(value.get("actor") or "")
                roles = value.get("roles") if isinstance(value.get("roles"), list) else [str(value.get("role") or "")]
                tenant = str(value.get("tenant_id") or value.get("tenant") or "")
                if actor:
                    return {"actor": actor, "roles": [str(r) for r in roles], "tenant_id": tenant}, True
            except (ValueError, TypeError):
                raise HTTPException(400, {"code": "INVALID_PRINCIPAL", "message": "X-Yunpai-Principal 不是合法 JSON"})
        user = headers.get("x-actor-user") or headers.get("x-yunpai-actor-user")
        if user:
            roles = [item.strip() for item in (headers.get("x-actor-roles") or "").split(",") if item.strip()]
            tenant = headers.get("x-tenant-id") or headers.get("x-yunpai-tenant-id") or ""
            return {"actor": str(user), "roles": roles, "tenant_id": str(tenant)}, True
        require_trusted = os.getenv("YUNPAI_REQUIRE_TRUSTED_PRINCIPAL", "0").lower() in {"1", "true", "yes"}
        if require_trusted:
            raise HTTPException(403, {"code": "TRUSTED_PRINCIPAL_REQUIRED",
                                      "message": "必须从受信认证中间件/反向代理提供 X-Yunpai-Principal 或 X-Actor-User 头"})
        return {}, False

    def _principal_actor(principal: dict[str, Any], trusted: bool, body: dict[str, Any]) -> tuple[str, list[str]]:
        body_actor = str(body.get("actor") or "")
        if trusted:
            actor = str(principal.get("actor") or "")
            if body_actor and body_actor != actor:
                # T5.4：body 冒充受信 principal 必须拒绝并记录审计。
                raise HTTPException(403, {"code": "ACTOR_IMPERSONATION",
                                          "message": f"请求体 actor={body_actor} 与受信 principal={actor} 不一致，拒绝冒充审批"})
            return actor, list(principal.get("roles") or [])
        # dev/preview 降级：无受信头时 body actor 不构成受信身份；若部署方
        # 要求受信（YUNPAI_REQUIRE_TRUSTED_PRINCIPAL=1）已在解析处拒绝。
        return body_actor or "operator", []

    @app.get("/health")
    async def health():
        from collections import Counter

        specs = graph.registry.specs
        bound = graph.registry.handlers
        spec_by_module = Counter(spec.module for spec in specs.values())
        bound_by_module = Counter()
        for name in bound:
            spec = specs.get(name)
            if spec is not None:
                bound_by_module[spec.module] += 1
        modules = {
            module: {"spec": int(spec_by_module.get(module, 0)), "bound": int(bound_by_module.get(module, 0))}
            for module in sorted(set(spec_by_module) | set(bound_by_module))
        }
        payload = {"status": "ok", "module": "yunpai-langgraph", "tools": len(specs), "bound_tools": len(bound), "skills": len(graph.skills.specs), "planner_model": graph.planner.router.config.public(), "modules": modules}
        environment = getattr(graph.registry, "environment", None)
        if environment:
            payload["environment"] = environment
        return payload

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
        """单文件上传入口：保存原字节/哈希/类型/相对路径为 attachment reference，
        再交给 Planner 选择 workflow。API 层不做固定 XLSX 解析；支持的实际类型
        以 M1 工具合同为准（PDF/图片/XLS*/CSV/DOCX/DXF-DWG/ZIP-TAR-RAR-7Z 等）。
        """
        from .file_sniff import sniff_format
        from .uploads import MAX_FILE_BYTES, sha256_of

        raw = await file.read()
        if not raw:
            raise HTTPException(400, "uploaded file is empty")
        if len(raw) > MAX_FILE_BYTES:
            raise HTTPException(413, {"code": "FILE_TOO_LARGE", "message": f"单文件超过 {MAX_FILE_BYTES // (1024 * 1024)} MiB 上限"})
        filename = str(file.filename or "upload.bin")
        verdict = sniff_format(raw, filename)
        if verdict.detected_format == "unknown" or not verdict.match:
            raise HTTPException(415, {
                "code": "UNSUPPORTED_FILE_TYPE",
                "message": f"无法识别的文件类型（声明 .{verdict.declared_suffix.strip('.')}，嗅探 {verdict.detected_format}）；请上传 M1 支持的订单/业务资料格式",
            })
        attachment = {
            "id": "upload-1",
            "kind": "order",
            "filename": filename,
            "relative_path": filename,
            "content_type": verdict.mime_type,
            "content_b64": base64.b64encode(raw).decode("ascii"),
            "size": len(raw),
            "sha256": sha256_of(raw),
            "detected_format": verdict.detected_format,
        }
        request: dict[str, Any] = {
            "message": message,
            "attachments": [attachment],
        }
        if workflow:
            request["workflow"] = workflow
        try:
            state = await graph.run(new_state(request, tenant_id=tenant_id))
            return graph._public_state(state)
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/runs/upload/batch")
    async def upload_batch_run(files: list[Any] = File(...), message: str = Form("请识别并登记这些业务资料"), mode: str = Form(...), tenant_id: str = Form("default")):
        """目录/基础资料/订单批量上传：显式 mode，逐文件返回状态与批次摘要。

        与单文件 /runs/upload 不同，本端点不靠用户文案猜测模式；缺 content_b64、
        坏 base64、超限或空文件都会以 skipped/parse_failed 状态逐文件返回，
        而不是静默继续或整批 400。mode 必须是 order/master_data/directory。
        """
        from .uploads import (
            MAX_BATCH_BYTES,
            MAX_BATCH_FILES,
            MAX_FILE_BYTES,
            UPLOAD_MODES,
            UploadSummary,
            sha256_of,
            to_attachment_record,
        )

        mode = str(mode).strip()
        if mode not in UPLOAD_MODES:
            raise HTTPException(422, {"code": "INVALID_UPLOAD_MODE", "message": f"mode 必须为 {'/'.join(UPLOAD_MODES)} 之一", "allowed": list(UPLOAD_MODES)})
        if len(files) > MAX_BATCH_FILES:
            raise HTTPException(413, {"code": "BATCH_TOO_LARGE", "message": f"单批文件数超过 {MAX_BATCH_FILES}"})
        summary = UploadSummary(mode=mode)
        attachments: list[dict[str, Any]] = []
        batch_bytes = 0
        for index, file in enumerate(files, start=1):
            raw = await file.read()
            if not raw:
                summary.add(to_attachment_record({"filename": str(file.filename or f"upload-{index}.bin")}, mode=mode, status="skipped", reason="empty_content"))
                continue
            if len(raw) > MAX_FILE_BYTES:
                summary.add(to_attachment_record({"filename": str(file.filename or f"upload-{index}.bin"), "size": len(raw)}, mode=mode, status="skipped", reason=f"exceeds_single_file_limit_{MAX_FILE_BYTES}"))
                continue
            batch_bytes += len(raw)
            if batch_bytes > MAX_BATCH_BYTES:
                summary.add(to_attachment_record({"filename": str(file.filename or f"upload-{index}.bin"), "size": len(raw)}, mode=mode, status="skipped", reason="exceeds_batch_size_limit"))
                continue
            digest = sha256_of(raw)
            attachment = {
                "id": f"{str(file.filename or f'upload-{index}')}-{index}",
                "kind": mode if mode in {"order", "master_data"} else "master_data",
                "filename": str(file.filename or f"upload-{index}.bin"),
                "relative_path": str(file.filename or f"upload-{index}.bin"),
                "content_type": file.content_type or "application/octet-stream",
                "content_b64": base64.b64encode(raw).decode("ascii"),
                "size": len(raw),
                "sha256": digest,
            }
            attachments.append(attachment)
            summary.add(to_attachment_record(attachment, mode=mode, status="accepted"))
        if not attachments:
            return {
                "run_id": "", "task_id": "", "status": "failed",
                "upload_summary": summary.as_dict(),
                "error": {"code": "NO_ACCEPTED_FILES", "message": "没有可识别的文件"},
            }
        request: dict[str, Any] = {
            "message": message,
            "upload_mode": mode,
            "attachments": attachments,
        }
        try:
            state = await graph.run(new_state(request, tenant_id=tenant_id))
            public = graph._public_state(state)
            public["upload_summary"] = summary.as_dict()
            return public
        except (KeyError, ValueError) as exc:
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
    async def resume_run(run_id: str, body: dict[str, Any],
                         x_yunpai_principal: str | None = Header(None),
                         x_actor_user: str | None = Header(None),
                         x_actor_roles: str | None = Header(None),
                         x_tenant_id: str | None = Header(None)):
        state = graph.repository.get(run_id)
        if state is None: raise HTTPException(404, "run not found")
        principal, trusted = _principal_from_headers({
            "x-yunpai-principal": x_yunpai_principal or "",
            "x-actor-user": x_actor_user or "",
            "x-actor-roles": x_actor_roles or "",
            "x-tenant-id": x_tenant_id or "",
        })
        actor, roles = _principal_actor(principal, trusted, body)
        decision = str(body.get("decision", "allow"))
        try:
            graph.validate_resume_decision(state, decision, body.get("supplement"))
            if trusted:
                # 只有受信 principal 才做角色/租户 Gate；本地无认证降级路径
                # 保留操作能力但审计标记 untrusted_body（生产强制受信）。
                graph.authorize_gate(state, actor=actor, roles=roles,
                                     tenant_id=principal.get("tenant_id") or None)
        except ValueError as exc:
            status = 403 if any(token in str(exc) for token in ("role", "tenant", "anonymous")) else 409
            raise HTTPException(status, str(exc)) from exc
        try:
            resumed = await graph.resume(state, decision, body.get("supplement"), actor=actor)
            if resumed.get("approvals"):
                resumed["approvals"][-1].setdefault("principal", {
                    "trusted": trusted, "actor": actor, "roles": roles,
                    "tenant_id": principal.get("tenant_id") or "",
                })
                if not trusted:
                    resumed["approvals"][-1]["principal"]["source"] = "untrusted_body"
            return graph._public_state(resumed)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/runs/{run_id}/resume/stream")
    async def resume_stream(run_id: str, body: dict[str, Any],
                            x_yunpai_principal: str | None = Header(None),
                            x_actor_user: str | None = Header(None),
                            x_actor_roles: str | None = Header(None),
                            x_tenant_id: str | None = Header(None)):
        state = graph.repository.get(run_id)
        if state is None:
            raise HTTPException(404, "run not found")
        principal, trusted = _principal_from_headers({
            "x-yunpai-principal": x_yunpai_principal or "",
            "x-actor-user": x_actor_user or "",
            "x-actor-roles": x_actor_roles or "",
            "x-tenant-id": x_tenant_id or "",
        })
        actor, roles = _principal_actor(principal, trusted, body)
        decision = str(body.get("decision", "allow"))
        if state.get("status") != "waiting_human" or not state.get("pending_gate"):
            raise HTTPException(409, "run is not waiting_human")
        if decision not in {"allow", "approve", "continue", "retry", "reject", "stop"}:
            raise HTTPException(409, "unsupported gate decision")
        try:
            graph.validate_resume_decision(state, decision, body.get("supplement"))
            if trusted:
                graph.authorize_gate(state, actor=actor, roles=roles,
                                     tenant_id=principal.get("tenant_id") or None)
        except ValueError as exc:
            status = 403 if any(token in str(exc) for token in ("role", "tenant", "anonymous")) else 409
            raise HTTPException(status, str(exc)) from exc
        return ndjson_response(
            graph.stream_resume(state, decision, body.get("supplement"), actor=actor)
        )

    @app.get("/m0/readback/{batch_id}")
    async def m0_readback(batch_id: str):
        """M0 canonical 回读报告（dry-run 语义）。

        返回当前 transport 是否具备真实 M0 canonical/ledger/outbox 回读；
        没有回读证据时绝不写“生产完成”。
        """
        from .m0_sandbox import M0SandboxStore

        db_path = Path(os.getenv("YUNPAI_M0_SANDBOX_DB", "runtime/yunpai-m0-sandbox.sqlite"))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        transport = os.getenv("YUNPAI_TOOL_TRANSPORT", "local").lower()
        real_available = transport == "http" and bool(os.getenv("M0_URL"))
        return M0SandboxStore(db_path).readback_report(batch_id, real_m0_available=real_available)
    return app


def main() -> None:
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=9000)


if __name__ == "__main__":
    main()
