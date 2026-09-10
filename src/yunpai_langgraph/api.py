from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from .auth import (
    SESSION_COOKIE,
    generate_password,
    hash_password,
    login,
    session_from_token,
    sign_session_token,
    verify_password,
)
from .graph import YunpaiGraph
from .guided_chat import SCALE_OPTIONS, handle_message as handle_guidance_message
from .guided_setup import catalog_payload
from .identity import BOOTSTRAP_ADMIN_ROLES, IdentityStore, authorize, effective_permissions, permission_for_gate
from .models import new_state
from .registry import ToolRegistry, build_runtime_registry
from .repository import RunRepository, SQLiteRunRepository

logger = logging.getLogger("yunpai.api")

# 端点签名需要 Request 注解（会话 Cookie 读取）；延迟字符串注解由 FastAPI 按
# 模块全局解析，故在模块级条件导入（无 fastapi 环境仍可 import 本模块）。
try:  # pragma: no cover - 视环境而定
    from fastapi import Request
except ImportError:  # pragma: no cover
    Request = None  # type: ignore[assignment]


def create_app(*, repository: RunRepository | None = None, registry: ToolRegistry | None = None,
               identity_store: IdentityStore | None = None):
    try:
        from fastapi import FastAPI, File, Form, Header, HTTPException
        from fastapi.responses import JSONResponse, StreamingResponse
    except ImportError as exc: raise RuntimeError("安装 fastapi 后才能启动 HTTP API") from exc
    if repository is None:
        db_path = Path(os.getenv("YUNPAI_RUN_DB", "runtime/yunpai-runs.sqlite"))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        repository = SQLiteRunRepository(db_path)
    graph = YunpaiGraph(registry or build_runtime_registry(), repository)
    # 工具权限映射必须全覆盖（漏配 = 默认放行，因此启动即校验）。
    from .tool_permissions import assert_full_coverage

    assert_full_coverage(graph.registry.specs)
    # 身份/组织/权限事实源（F-013/F-014/F-015 正式版，2026-09-07）。
    if identity_store is None:
        identity_store = IdentityStore(os.getenv("YUNPAI_IDENTITY_DB", "runtime/yunpai-identity.sqlite"))
    app = FastAPI(title="Yunpai LangGraph", version="0.2.0")

    @app.middleware("http")
    async def _accept_unprefixed_identity_paths(request, call_next):
        """兼容「剥掉 /api 前缀」的部署（vite dev proxy、_deploy-gb10/static_proxy.py）。

        api-gateway 把 `/api/auth/*` 原样转给 orchestrator，而 vite dev proxy 与演示
        静态代理会 `rewrite: path.replace(/^\\/api/, '')` → `/auth/*`。两条路都要能用，
        故把无前缀的 `/auth|/identity|/guidance/*` 内部映射回 `/api/...`。
        这三个前缀与既有无前缀路由（/runs、/tools、/health、/skills、/m0/readback）
        不冲突。
        """
        path = str(request.scope.get("path") or "")
        for prefix in ("/auth", "/identity", "/guidance"):
            if path == prefix or path.startswith(prefix + "/"):
                request.scope["path"] = "/api" + path
                break
        return await call_next(request)

    def _principal_from_headers(headers: dict[str, str],
                                cookies: dict[str, str] | None = None) -> tuple[dict[str, Any], bool]:
        """从受信反向代理/认证中间件读取审批 principal（T5.2）。

        优先 ``X-Yunpai-Principal``（JSON：actor/roles/tenant_id），其次拆分头
        ``X-Actor-User`` + ``X-Actor-Roles`` + ``X-Tenant-Id``；无受信头时尝试
        登录会话 Cookie（接缝 5：验签解出 principal，trusted=login，角色取
        identity 绑定解析结果）注入现有链路——替换而非新造，冒充校验语义
        不变。返回 (principal, trusted)；两者皆无且未强制受信时 actor 交由
        调用方从 body 取（dev/preview 降级），审计标记 principal_source=untrusted_body。
        """
        header = headers.get("x-yunpai-principal")
        if header:
            try:
                value = json.loads(header)
                actor = str(value.get("actor") or "")
                roles = value.get("roles") if isinstance(value.get("roles"), list) else [str(value.get("role") or "")]
                tenant = str(value.get("tenant_id") or value.get("tenant") or "")
                if actor:
                    return {"actor": actor, "roles": [str(r) for r in roles], "tenant_id": tenant, "source": "trusted_header"}, True
            except (ValueError, TypeError):
                raise HTTPException(400, {"code": "INVALID_PRINCIPAL", "message": "X-Yunpai-Principal 不是合法 JSON"})
        user = headers.get("x-actor-user") or headers.get("x-yunpai-actor-user")
        if user:
            roles = [item.strip() for item in (headers.get("x-actor-roles") or "").split(",") if item.strip()]
            tenant = headers.get("x-tenant-id") or headers.get("x-yunpai-tenant-id") or ""
            return {"actor": str(user), "roles": roles, "tenant_id": str(tenant), "source": "trusted_header"}, True
        session_token = str((cookies or {}).get(SESSION_COOKIE) or "")
        if session_token:
            session = session_from_token(identity_store, session_token)
            if session:
                resolved = identity_store.resolve(
                    tenant_id=session["tenant_id"], user_id=session["user_id"])
                return {
                    "actor": session["user_id"],
                    "roles": list(resolved["roles"]),
                    "tenant_id": session["tenant_id"],
                    "source": "login",
                }, True
        require_trusted = os.getenv("YUNPAI_REQUIRE_TRUSTED_PRINCIPAL", "0").lower() in {"1", "true", "yes"}
        if require_trusted:
            # 接缝 5：语义升级为「受信头或有效登录会话二选一」，无两者 401。
            raise HTTPException(401, {"code": "TRUSTED_PRINCIPAL_REQUIRED",
                                      "message": "必须提供受信认证头（X-Yunpai-Principal/X-Actor-User）或有效登录会话 Cookie"})
        return {}, False

    def _resolve_tenant(*, explicit: Any, headers: dict[str, str]) -> str:
        """运行入口租户解析（P1.2，与 M1 适配器 fail-closed 对齐）。

        解析顺序：显式参数（body/form/query 的 tenant_id）→ 租户头
        （X-Yunpai-Tenant-ID / X-Tenant-ID）→ 兼容开关 ``YUNPAI_DEFAULT_TENANT``
        （单租户内网部署显式声明，请求时读取）→ 都没有则 400 MISSING_TENANT，
        不再静默落入 default 租户。
        """
        tenant = str(explicit or "").strip()
        if not tenant:
            tenant = str(headers.get("x-yunpai-tenant-id") or headers.get("x-tenant-id") or "").strip()
        if not tenant:
            fallback = os.getenv("YUNPAI_DEFAULT_TENANT", "").strip()
            if fallback:
                return fallback
            raise HTTPException(400, {
                "code": "MISSING_TENANT",
                "message": "缺少租户上下文（tenant_id 参数或 X-Yunpai-Tenant-ID 头），已失败关闭；"
                           "单租户内网部署可设置 YUNPAI_DEFAULT_TENANT 显式兼容",
            })
        return tenant

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
    async def list_tools(module: str | None = None, request: Request = None):
        """工具清单：带身份时按 principal 权限过滤（无身份 = 本地/内部调用，返回全量）。"""
        catalog = graph.registry.catalog()
        principal = _run_principal(request, tenant_id=_bootstrap_tenant("", request)) if request is not None else {}
        permissions = principal.get("permissions") if principal else None
        scopes = principal.get("permission_scopes") if principal else None
        if permissions is not None:
            from .tool_permissions import tool_allowed

            catalog = [
                item for item in catalog
                if tool_allowed(str(item["name"]), str(item["module"]), permissions, scopes)
            ]
        return {"tools": [item for item in catalog if module is None or item["module"] == module]}

    @app.get("/skills")
    async def list_skills():
        return {"skills": graph.skills.catalog()}

    @app.post("/runs")
    async def create_run(body: dict[str, Any], request: Request,
                         x_yunpai_tenant_id: str | None = Header(None),
                         x_tenant_id: str | None = Header(None)):
        request_payload = body.get("request", body)
        if not isinstance(request_payload, dict):
            raise HTTPException(422, "request must be an object")
        tenant_id = _resolve_tenant(explicit=body.get("tenant_id"), headers={
            "x-yunpai-tenant-id": x_yunpai_tenant_id or "",
            "x-tenant-id": x_tenant_id or "",
        })
        try:
            state = await graph.run(new_state(_with_caller(request, tenant_id, request_payload),
                                              tenant_id=tenant_id,
                                              principal=_run_principal(request, tenant_id=tenant_id)))
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
    async def create_streaming_run(body: dict[str, Any], request: Request,
                                   x_yunpai_tenant_id: str | None = Header(None),
                                   x_tenant_id: str | None = Header(None)):
        request_payload = body.get("request", body)
        if not isinstance(request_payload, dict):
            raise HTTPException(422, "request must be an object")
        tenant_id = _resolve_tenant(explicit=body.get("tenant_id"), headers={
            "x-yunpai-tenant-id": x_yunpai_tenant_id or "",
            "x-tenant-id": x_tenant_id or "",
        })
        state = new_state(_with_caller(request, tenant_id, request_payload), tenant_id=tenant_id,
                          principal=_run_principal(request, tenant_id=tenant_id))
        graph.repository.save(state)
        return ndjson_response(graph.stream(state))

    @app.post("/runs/upload")
    async def upload_run(request: Request, file: Any = File(...), message: str = "请解析并验证这份订单", tenant_id: str = "",
                         workflow: str | None = None,
                         x_yunpai_tenant_id: str | None = Header(None),
                         x_tenant_id: str | None = Header(None)):
        """单文件上传入口：保存原字节/哈希/类型/相对路径为 attachment reference，
        再交给 Planner 选择 workflow。API 层不做固定 XLSX 解析；支持的实际类型
        以 M1 工具合同为准（PDF/图片/XLS*/CSV/DOCX/DXF-DWG/ZIP-TAR-RAR-7Z 等）。
        """
        from .file_sniff import sniff_format
        from .uploads import MAX_FILE_BYTES, sha256_of

        tenant_id = _resolve_tenant(explicit=tenant_id, headers={
            "x-yunpai-tenant-id": x_yunpai_tenant_id or "",
            "x-tenant-id": x_tenant_id or "",
        })
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
        request_payload: dict[str, Any] = {
            "message": message,
            "attachments": [attachment],
        }
        if workflow:
            request_payload["workflow"] = workflow
        try:
            state = await graph.run(new_state(request_payload, tenant_id=tenant_id,
                                              principal=_run_principal(request, tenant_id=tenant_id)))
            return graph._public_state(state)
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.post("/runs/upload/batch")
    async def upload_batch_run(request: Request, files: list[Any] = File(...), message: str = Form("请识别并登记这些业务资料"),
                               mode: str = Form(...), tenant_id: str = Form(""),
                               x_yunpai_tenant_id: str | None = Header(None),
                               x_tenant_id: str | None = Header(None)):
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

        tenant_id = _resolve_tenant(explicit=tenant_id, headers={
            "x-yunpai-tenant-id": x_yunpai_tenant_id or "",
            "x-tenant-id": x_tenant_id or "",
        })
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
        request_payload: dict[str, Any] = {
            "message": message,
            "upload_mode": mode,
            "attachments": attachments,
        }
        try:
            state = await graph.run(new_state(request_payload, tenant_id=tenant_id,
                                              principal=_run_principal(request, tenant_id=tenant_id)))
            public = graph._public_state(state)
            public["upload_summary"] = summary.as_dict()
            return public
        except (KeyError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

    @app.get("/runs")
    async def list_runs(tenant_id: str | None = None, limit: int = 100, request: Request = None):
        """运行列表（多用户隔离）：有身份时只返回本人 run，租户管理员可见本租户全部。

        无有效身份 = legacy/本地行为，返回全部（见 ``_run_access_scope`` 说明）。
        """
        scope = _run_access_scope(request, tenant_id=tenant_id) if request is not None else None
        if scope is not None:
            # 客户端传的 tenant_id 不能放大范围：有身份时一律以调用者租户为准
            # （前端目前硬编码 tenant_id=default，忽略它才不会让别的租户用户看不到自己的会话）。
            tenant_id = scope["tenant_id"]
            # 归属过滤在仓库层之后做，故按租户多取（仓库上限 1000）再截断到 limit，
            # 避免别人的 run 把本人的挤掉。
            states = graph.repository.list(tenant_id=tenant_id, limit=1000)
            visible = [state for state in states if _run_visible(state, scope)][:max(1, limit)]
        else:
            visible = graph.repository.list(tenant_id=tenant_id, limit=limit)
        return {"runs": [graph._public_state(state) for state in visible]}

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str, request: Request = None):
        state = graph.repository.get(run_id)
        if state is None: raise HTTPException(404, "run not found")
        scope = _run_access_scope(
            request, tenant_id=str(state.get("tenant_id") or "")) if request is not None else None
        if not _run_visible(state, scope):
            # 非本人且非管理员 → 404（不用 403，避免泄露该 run 是否存在）
            raise HTTPException(404, "run not found")
        return graph._public_state(state)

    @app.delete("/runs/{run_id}")
    async def delete_run(run_id: str, tenant_id: str | None = None, request: Request = None):
        """删除运行（订单删除）：归属校验同 GET，非本人且非管理员 → 404。"""
        state = graph.repository.get(run_id)
        if state is None:
            raise HTTPException(404, "run not found")
        scope = _run_access_scope(
            request, tenant_id=tenant_id or str(state.get("tenant_id") or "")) if request is not None else None
        if not _run_visible(state, scope):
            raise HTTPException(404, "run not found")
        if tenant_id and tenant_id != str(state.get("tenant_id") or "default"):
            raise HTTPException(409, "cross-tenant delete rejected")
        deleted = graph.repository.delete(run_id)
        return {"run_id": run_id, "deleted": bool(deleted)}

    @app.post("/runs/batch-delete")
    async def batch_delete_runs(body: dict[str, Any], tenant_id: str | None = None, request: Request = None):
        """批量删除运行：非本人且非管理员 → 跳过并计数（不报错、不泄露归属）。"""
        run_ids = body.get("run_ids") if isinstance(body, dict) else None
        if not isinstance(run_ids, list):
            raise HTTPException(422, "run_ids must be an array")
        scope = _run_access_scope(request, tenant_id=tenant_id) if request is not None else None
        deleted_ids: list[str] = []
        for run_id in run_ids:
            if not isinstance(run_id, str) or not run_id.strip():
                continue
            state = graph.repository.get(run_id)
            if state is None:
                continue
            if not _run_visible(state, scope):
                continue
            if tenant_id and tenant_id != str(state.get("tenant_id") or "default"):
                continue
            if graph.repository.delete(run_id):
                deleted_ids.append(run_id)
        return {"deleted": deleted_ids, "count": len(deleted_ids)}

    def _request_principal(request) -> tuple[dict[str, Any], bool]:
        return _principal_from_headers({
            "x-yunpai-principal": request.headers.get("x-yunpai-principal", ""),
            "x-actor-user": request.headers.get("x-actor-user", ""),
            "x-actor-roles": request.headers.get("x-actor-roles", ""),
            "x-tenant-id": request.headers.get("x-tenant-id", "")
            or request.headers.get("x-yunpai-tenant-id", ""),
        }, cookies=dict(request.cookies))

    def _caller_profile(request, *, tenant_id: str) -> dict[str, Any] | None:
        """当前登录人的身份画像（注入 run 请求，供对话直接回答「我的角色是什么」）。

        无有效会话 → None（不注入），行为与之前完全一致。
        """
        try:
            principal, trusted = _request_principal(request)
        except HTTPException:
            return None
        actor = str(principal.get("actor") or "")
        if not trusted or not actor:
            return None
        tenant = str(principal.get("tenant_id") or tenant_id or "")
        try:
            resolved = identity_store.resolve(tenant_id=tenant, user_id=actor) or {}
        except Exception:  # 身份库异常不应阻断对话
            resolved = {}
        user = identity_store.get_user(tenant_id=tenant, user_id=actor) or {}
        # org_path 只给 org_id（如 ["company"]），翻成名字更好答「我在哪个部门」
        org_ids = [str(item) for item in (resolved.get("org_path") or [])]
        try:
            names = {str(node.get("org_id")): str(node.get("name") or "")
                     for node in identity_store.org_tree(tenant_id=tenant)}
        except Exception:
            names = {}
        org_path_names = [names.get(org_id) or org_id for org_id in org_ids]
        return {
            "user_id": actor,
            "display_name": user.get("display_name") or actor,
            "roles": list(resolved.get("roles") or principal.get("roles") or []),
            "role_names": list(resolved.get("role_names") or []),
            "org_path": org_path_names,
            "org_path_ids": org_ids,
            "permissions": list(resolved.get("permissions") or []),
        }

    def _with_caller(request, tenant_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        caller = _caller_profile(request, tenant_id=tenant_id)
        return {**payload, "caller": caller} if caller else payload

    def _run_principal(request, *, tenant_id: str) -> dict[str, Any]:
        """运行入口身份（工具级权限闸用）：会话/受信头 → 角色+生效权限。

        权限集合与 `authorize()` 同语义（绑定 → legacy 角色 → bootstrap 首管），
        避免「Gate 放行但工具全被拒」。无有效身份时返回 {}——与既有
        ``YUNPAI_REQUIRE_TRUSTED_PRINCIPAL`` 语义一致（该开关只在 resume/identity
        端点强制 401）；此时工具闸按 legacy 放行，生产应同时开启该开关。
        """
        try:
            principal, trusted = _request_principal(request)
        except HTTPException:
            return {}
        actor = str(principal.get("actor") or "")
        if not trusted or not actor:
            return {}
        effective = effective_permissions(
            identity_store, tenant_id=tenant_id, user_id=actor,
            legacy_roles=[str(role) for role in (principal.get("roles") or [])],
        )
        return {
            "actor": actor,
            "roles": list(principal.get("roles") or effective["roles"]),
            "permissions": list(effective["permissions"]),
            "permission_scopes": dict(effective["permission_scopes"]),
            "tenant_id": tenant_id,
            "source": principal.get("source"),
        }

    def _run_access_scope(request, *, tenant_id: str | None = None) -> dict[str, Any] | None:
        """``/runs*`` 调用者数据范围（多用户隔离，2026-09-09）。

        返回 ``None`` = **无有效身份**：按 legacy/本地行为放行（列表返回全部 run）。
        这与本文件既有约定一致（``YUNPAI_REQUIRE_TRUSTED_PRINCIPAL`` 默认 0，本地
        联调 / 测试 / 内网直连不带 Cookie 与受信头都要能跑）。**生产必须设
        ``YUNPAI_REQUIRE_TRUSTED_PRINCIPAL=1``**（或在网关强制注入受信头），否则
        这个放行口依然存在。

        返回 dict 时按调用者归属过滤：

        - ``actor`` / ``tenant_id``：来自会话 Cookie 或受信头（受信头的
          ``tenant_id`` 为空时退回入参 tenant，再退回 ``YUNPAI_DEFAULT_TENANT``）；
        - ``is_admin``：生效权限含租户级管理权限 ``identity.admin``（厂长注册时
          绑定的 ``org-admin`` 角色，或 legacy 受信头 ``admin``）→ 可见本租户全部
          run（「厂长能看全厂」）；
        - 否则只可见 ``state.principal.actor == actor`` 的 run（本人聊天记录）。
        """
        try:
            principal, trusted = _request_principal(request)
        except HTTPException:
            return None
        actor = str(principal.get("actor") or "").strip()
        if not trusted or not actor:
            return None
        tenant = str(principal.get("tenant_id") or "").strip() or str(tenant_id or "").strip()
        if not tenant:
            tenant = os.getenv("YUNPAI_DEFAULT_TENANT", "").strip() or "default"
        effective = effective_permissions(
            identity_store, tenant_id=tenant, user_id=actor,
            legacy_roles=[str(role) for role in (principal.get("roles") or [])],
        )
        permissions = [str(item) for item in effective["permissions"]]
        return {
            "actor": actor,
            "tenant_id": tenant,
            "is_admin": "identity.admin" in permissions,
            "permissions": permissions,
        }

    @staticmethod
    def _run_visible(state: dict[str, Any], scope: dict[str, Any] | None) -> bool:
        """run 是否对调用者可见：``scope is None``（无身份）= legacy 放行全部。"""
        if scope is None:
            return True
        if str(state.get("tenant_id") or "default") != scope["tenant_id"]:
            return False
        if scope["is_admin"]:
            return True
        principal = state.get("principal") if isinstance(state.get("principal"), dict) else {}
        return str(principal.get("actor") or "") == scope["actor"]

    def _identity_gate_check(state: dict[str, Any], *, actor: str, roles: list[str],
                             principal: dict[str, Any], trusted: bool) -> None:
        """业务端点 identity 判定（接缝 4 第二步）。

        ``YUNPAI_IDENTITY_ENFORCE``：``off`` 跳过；``shadow``（默认）只记
        判定结果与审计不拦截（跑一个验收轮）；``on`` 强制（deny → 403）。
        与既有 GATE_ALLOWED_ROLES（T5.3）叠加，不替换。
        """
        mode = os.getenv("YUNPAI_IDENTITY_ENFORCE", "shadow").strip().lower()
        if mode in {"", "off"} or not trusted or not str(actor or "").strip():
            return
        gate_type = str((state.get("pending_gate") or {}).get("type") or "")
        permission = permission_for_gate(gate_type)
        if not permission:
            return
        tenant = str(principal.get("tenant_id") or state.get("tenant_id") or "default")
        decision = authorize(identity_store, tenant_id=tenant, user_id=actor,
                             permission=permission, legacy_roles=list(roles or []))
        if decision["allowed"]:
            return
        if mode == "on":
            raise HTTPException(403, {"code": "IDENTITY_DENIED",
                                      "message": f"gate {gate_type} 需要 {decision['resolved']['role_names'] or '已绑定角色'} 之外的权限 {permission}",
                                      "permission": permission, "reason": decision["reason"]})
        logger.warning("identity shadow deny tenant=%s user=%s gate=%s permission=%s reason=%s",
                       tenant, actor, gate_type, permission, decision["reason"])

    @app.post("/runs/{run_id}/resume")
    async def resume_run(run_id: str, body: dict[str, Any], request: Request,
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
        }, cookies=dict(request.cookies))
        actor, roles = _principal_actor(principal, trusted, body)
        decision = str(body.get("decision", "allow"))
        human_override = bool(body.get("human_override", False))
        override_reason = str(body.get("override_reason") or "")
        try:
            graph.validate_resume_decision(
                state, decision, body.get("supplement"), human_override=human_override
            )
            if trusted:
                # 只有受信 principal 才做角色/租户 Gate；本地无认证降级路径
                # 保留操作能力但审计标记 untrusted_body（生产强制受信）。
                graph.authorize_gate(state, actor=actor, roles=roles,
                                     tenant_id=principal.get("tenant_id") or None)
        except ValueError as exc:
            status = 403 if any(token in str(exc) for token in ("role", "tenant", "anonymous")) else 409
            raise HTTPException(status, str(exc)) from exc
        _identity_gate_check(state, actor=actor, roles=roles, principal=principal, trusted=trusted)
        try:
            resumed = await graph.resume(
                state,
                decision,
                body.get("supplement"),
                actor=actor,
                human_override=human_override,
                override_reason=override_reason,
            )
            if resumed.get("approvals"):
                resumed["approvals"][-1].setdefault("principal", {
                    "trusted": trusted, "actor": actor, "roles": roles,
                    "tenant_id": principal.get("tenant_id") or "",
                })
                if principal.get("source"):
                    resumed["approvals"][-1]["principal"]["source"] = principal["source"]
                if not trusted:
                    resumed["approvals"][-1]["principal"]["source"] = "untrusted_body"
            return graph._public_state(resumed)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/runs/{run_id}/resume/stream")
    async def resume_stream(run_id: str, body: dict[str, Any], request: Request,
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
        }, cookies=dict(request.cookies))
        actor, roles = _principal_actor(principal, trusted, body)
        decision = str(body.get("decision", "allow"))
        human_override = bool(body.get("human_override", False))
        override_reason = str(body.get("override_reason") or "")
        if state.get("status") != "waiting_human" or not state.get("pending_gate"):
            raise HTTPException(409, "run is not waiting_human")
        if decision not in {"allow", "approve", "continue", "retry", "reject", "stop"}:
            raise HTTPException(409, "unsupported gate decision")
        try:
            graph.validate_resume_decision(
                state, decision, body.get("supplement"), human_override=human_override
            )
            if trusted:
                graph.authorize_gate(state, actor=actor, roles=roles,
                                     tenant_id=principal.get("tenant_id") or None)
        except ValueError as exc:
            status = 403 if any(token in str(exc) for token in ("role", "tenant", "anonymous")) else 409
            raise HTTPException(status, str(exc)) from exc
        _identity_gate_check(state, actor=actor, roles=roles, principal=principal, trusted=trusted)
        return ndjson_response(
            graph.stream_resume(
                state,
                decision,
                body.get("supplement"),
                actor=actor,
                human_override=human_override,
                override_reason=override_reason,
            )
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
    # ------------------------------------------------- 登录 v1（F-013 接缝 5）

    def _require_identity_permission(permission: str, *, tenant_id: str,
                                     request) -> dict[str, Any]:
        """identity 管理 API 的鉴权门（接缝 4 第一步：identity 自有 API 全过
        authorize）。接受受信头（legacy 角色）或登录会话；deny → 403 且已留审计。"""
        principal, trusted = _request_principal(request)
        actor = str(principal.get("actor") or "")
        if not trusted or not actor:
            raise HTTPException(401, {"code": "AUTHENTICATION_REQUIRED",
                                      "message": "需要受信认证头或有效登录会话"})
        principal_tenant = str(principal.get("tenant_id") or "")
        if principal_tenant and principal_tenant != tenant_id:
            raise HTTPException(403, {"code": "CROSS_TENANT",
                                      "message": f"principal 租户 {principal_tenant} 无权管理租户 {tenant_id}"})
        decision = authorize(identity_store, tenant_id=tenant_id, user_id=actor,
                             permission=permission,
                             legacy_roles=list(principal.get("roles") or []))
        if not decision["allowed"]:
            raise HTTPException(403, {"code": "IDENTITY_DENIED",
                                      "message": f"缺少权限 {permission}（reason={decision['reason']}）",
                                      "permission": permission, "reason": decision["reason"]})
        return principal

    def _header_tenant(request) -> dict[str, str]:
        if request is None:
            return {}
        return {
            "x-yunpai-tenant-id": request.headers.get("x-yunpai-tenant-id", ""),
            "x-tenant-id": request.headers.get("x-tenant-id", ""),
        }

    def _tenant_for_request(explicit: Any, request) -> str:
        """identity 端点租户解析：显式参数 → 会话/受信头 principal 租户 →
        租户头 → YUNPAI_DEFAULT_TENANT → 400 MISSING_TENANT。"""
        if request is not None and not str(explicit or "").strip():
            principal, _ = _request_principal(request)
            explicit = str(principal.get("tenant_id") or "")
        return _resolve_tenant(explicit=explicit, headers=_header_tenant(request))

    @app.post("/api/auth/login")
    async def auth_login(body: dict[str, Any],
                         x_yunpai_tenant_id: str | None = Header(None),
                         x_tenant_id: str | None = Header(None)):
        tenant_id = _resolve_tenant(explicit=body.get("tenant_id"), headers={
            "x-yunpai-tenant-id": x_yunpai_tenant_id or "",
            "x-tenant-id": x_tenant_id or "",
        })
        user_id = str(body.get("user_id") or "")
        user = login(identity_store, tenant_id=tenant_id, user_id=user_id,
                     password=str(body.get("password") or ""))
        if not user:
            raise HTTPException(401, {"code": "INVALID_CREDENTIALS", "message": "用户名或密码错误"})
        token = sign_session_token(identity_store.session_secret(),
                                   tenant_id=tenant_id, user_id=user_id)
        resolved = identity_store.resolve(tenant_id=tenant_id, user_id=user_id)
        response = JSONResponse({
            "tenant_id": tenant_id,
            "user_id": user_id,
            "display_name": user.get("display_name"),
            "roles": resolved["roles"],
            "role_names": resolved["role_names"],
            "permissions": resolved["permissions"],
            "must_change_password": bool(user.get("must_change_password")),
        })
        response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", path="/")
        return response

    @app.post("/api/auth/logout")
    async def auth_logout():
        response = JSONResponse({"ok": True})
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    @app.get("/api/auth/me")
    async def auth_me(request: Request):
        principal, trusted = _request_principal(request)
        actor = str(principal.get("actor") or "")
        if not trusted or not actor:
            raise HTTPException(401, {"code": "AUTHENTICATION_REQUIRED",
                                      "message": "未登录（无有效会话或受信头）"})
        tenant_id = str(principal.get("tenant_id") or "")
        if not tenant_id:
            raise HTTPException(401, {"code": "AUTHENTICATION_REQUIRED",
                                      "message": "principal 缺租户上下文"})
        resolved = identity_store.resolve(tenant_id=tenant_id, user_id=actor)
        user = identity_store.get_user(tenant_id=tenant_id, user_id=actor) or {}
        return {"principal": {"actor": actor, "tenant_id": tenant_id,
                              "roles": list(principal.get("roles") or []),
                              "source": principal.get("source")},
                "display_name": user.get("display_name"),
                "must_change_password": bool(user.get("must_change_password")),
                **resolved}

    # ------------------------------------------- 厂长自助注册 / 改密（F-013 补）

    def _bootstrap_tenant(explicit: Any, request) -> str:
        """注册/状态端点租户解析：显式 → 租户头 → YUNPAI_DEFAULT_TENANT → default。

        这两个端点在登录前调用，不能要求已认证 principal；单租户交付下默认
        落 ``default``，避免前端登录页被迫先拿租户。
        """
        tenant = str(explicit or "").strip()
        if not tenant and request is not None:
            tenant = str(_header_tenant(request).get("x-yunpai-tenant-id") or "").strip()
        return tenant or (os.getenv("YUNPAI_DEFAULT_TENANT", "").strip() or "default")

    @app.get("/api/auth/config")
    async def auth_config(request: Request):
        """前端鉴权配置：账号密码模式（无匿名会话、无 OIDC、按用户隔离）。"""
        tenant = _bootstrap_tenant("", request)
        return {
            "auth_mode": "authenticated_isolated",
            "oidc_enabled": False,
            "shared_data": False,
            "csrf_required": False,
            "capabilities": {
                "anonymous_session": False,
                "oidc_login": False,
                "session_management": True,
                "user_isolation": True,
            },
            "tenants": [{"id": tenant, "name": tenant}],
        }

    @app.get("/api/auth/bootstrap-status")
    async def auth_bootstrap_status(request: Request, tenant_id: str = ""):
        """系统是否已初始化：无任何账号 → 前端跳「厂长注册」，否则跳登录页。"""
        tenant = _bootstrap_tenant(tenant_id, request)
        users = identity_store.count_users(tenant_id=tenant)
        company = next((node for node in identity_store.org_tree(tenant_id=tenant)
                        if node.get("org_type") == "company"), None)
        return {"tenant_id": tenant, "needs_bootstrap": users == 0, "user_count": users,
                "company_name": (company or {}).get("name")}

    @app.post("/api/auth/register-admin")
    async def auth_register_admin(body: dict[str, Any], request: Request):
        """厂长自助注册（全系统唯一一次）：建公司 → 建账号 → 绑双角色 → 自动登录。

        幂等闸：租户已有任意账号即 409，之后新增账号只能由厂长在账号管理里分配。
        角色绑 ``BOOTSTRAP_ADMIN_ROLES`` = factory-director + org-admin（不动种子）。
        """
        tenant = _bootstrap_tenant(body.get("tenant_id"), request)
        if identity_store.count_users(tenant_id=tenant) > 0:
            raise HTTPException(409, {"code": "ALREADY_BOOTSTRAPPED",
                                      "message": "系统已完成初始化；请由厂长在「账号管理」中分配账号"})
        user_id = str(body.get("user_id") or "").strip()
        password = str(body.get("password") or "")
        company_name = str(body.get("company_name") or "").strip()
        display_name = str(body.get("display_name") or "").strip() or user_id
        if not company_name:
            raise HTTPException(422, {"code": "INVALID_REGISTRATION", "message": "公司名称不能为空"})
        if not re.match(r"^[A-Za-z0-9_.@-]{3,64}$", user_id):
            raise HTTPException(422, {"code": "INVALID_USER_ID",
                                      "message": "账号只允许字母/数字/_ . @ -，长度 3~64"})
        if len(password) < 8:
            raise HTTPException(422, {"code": "WEAK_PASSWORD", "message": "密码至少 8 位"})
        identity_store.upsert_org(tenant_id=tenant, org_id="company", name=company_name,
                                  org_type="company", source="manual")
        identity_store.create_user(tenant_id=tenant, user_id=user_id,
                                   password_hash=hash_password(password),
                                   display_name=display_name, org_id="company",
                                   status="active", must_change_password=0)
        identity_store.bind_user(tenant_id=tenant, user_id=user_id,
                                 role_codes=list(BOOTSTRAP_ADMIN_ROLES), org_id="company")
        token = sign_session_token(identity_store.session_secret(),
                                   tenant_id=tenant, user_id=user_id)
        resolved = identity_store.resolve(tenant_id=tenant, user_id=user_id)
        response = JSONResponse({
            "tenant_id": tenant, "user_id": user_id, "display_name": display_name,
            "roles": resolved["roles"], "role_names": resolved["role_names"],
            "permissions": resolved["permissions"], "must_change_password": False,
        })
        response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="lax", path="/")
        return response

    @app.post("/api/auth/change-password")
    async def auth_change_password(body: dict[str, Any], request: Request):
        """改密（首登强制改密与主动改密同一入口）。

        首登强制改密（库中 ``must_change_password == 1``）不要求当前密码：用户手上
        只有一次性初始密码、且可能已经看不到了。普通主动改密仍必须校验当前密码
        （缺 → 422 OLD_PASSWORD_REQUIRED，错 → 403 INVALID_CREDENTIALS）。
        是否需要当前密码以**库中该用户**为准，不信任请求体。
        """
        principal, trusted = _request_principal(request)
        actor = str(principal.get("actor") or "")
        if not trusted or not actor:
            raise HTTPException(401, {"code": "AUTHENTICATION_REQUIRED", "message": "未登录"})
        tenant = str(principal.get("tenant_id") or "")
        user = identity_store.get_user(tenant_id=tenant, user_id=actor)
        if not user:
            raise HTTPException(401, {"code": "AUTHENTICATION_REQUIRED", "message": "账号不存在"})
        if not bool(user.get("must_change_password")):
            old_password = str(body.get("old_password") or "")
            if not old_password:
                raise HTTPException(422, {"code": "OLD_PASSWORD_REQUIRED",
                                          "message": "请提供当前密码"})
            if not verify_password(old_password, str(user.get("password_hash") or "")):
                raise HTTPException(403, {"code": "INVALID_CREDENTIALS", "message": "原密码不正确"})
        new_password = str(body.get("new_password") or "")
        if len(new_password) < 8:
            raise HTTPException(422, {"code": "WEAK_PASSWORD", "message": "新密码至少 8 位"})
        identity_store.set_password(tenant_id=tenant, user_id=actor,
                                    password_hash=hash_password(new_password),
                                    must_change_password=0)
        return {"ok": True, "user_id": actor}

    # ------------------------------------------- identity 管理 API（P-011/P-012）

    @app.get("/api/identity/catalog")
    async def identity_catalog():
        """权限清单 + 种子角色（只读静态目录，引导AI/前端共用，不涉敏感数据）。"""
        return catalog_payload()

    @app.get("/api/identity/org")
    async def identity_org_tree(tenant_id: str = "", request: Request = None):
        tenant = _tenant_for_request(tenant_id, request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        return {"tenant_id": tenant, "org": identity_store.org_tree(tenant_id=tenant)}

    @app.post("/api/identity/org")
    async def identity_org_upsert(body: dict[str, Any], request: Request):
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        node = identity_store.upsert_org(
            tenant_id=tenant,
            org_id=str(body.get("org_id") or ""),
            name=str(body.get("name") or ""),
            parent_id=body.get("parent_id"),
            org_type=str(body.get("org_type") or "dept"),
            source="manual",
        )
        return node

    @app.post("/api/identity/org/derive")
    async def identity_org_derive(body: dict[str, Any], request: Request):
        """从 canonical worker 实体派生组织树（接缝 3；手工节点不覆盖）。"""
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        from .m0_backend import M0Store

        m0_db = Path(os.getenv("YUNPAI_M0_DB", "runtime/yunpai-m0.sqlite"))
        workers = [entity.get("payload_json") or {}
                   for entity in M0Store(m0_db).list_entities("worker", tenant).get("entities", [])]
        if not workers:
            raise HTTPException(409, {"code": "NO_WORKER_ENTITIES",
                                      "message": f"tenant={tenant} canonical 无 worker 实体，无法派生"})
        result = identity_store.derive_org_from_workers(workers, tenant_id=tenant)
        return {"tenant_id": tenant, "workers": len(workers),
                "created": result["created"],
                "skipped_manual": result["skipped_manual"],
                "departments": result["departments"]}

    @app.delete("/api/identity/org/{org_id:path}")
    async def identity_org_delete(org_id: str, tenant_id: str = "", request: Request = None):
        """删除组织节点（有子节点/账号/绑定时 409，先挪人或先删子节点）。"""
        tenant = _tenant_for_request(tenant_id, request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        try:
            deleted = identity_store.delete_org(tenant_id=tenant, org_id=org_id)
        except ValueError as exc:
            raise HTTPException(409, {"code": "ORG_IN_USE", "message": str(exc)}) from exc
        if not deleted:
            raise HTTPException(404, {"code": "ORG_NOT_FOUND", "message": f"组织节点不存在: {org_id}"})
        return {"tenant_id": tenant, "org_id": org_id, "deleted": True}

    @app.get("/api/identity/roles")
    async def identity_roles(tenant_id: str = "", request: Request = None):
        tenant = _tenant_for_request(tenant_id, request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        return {"tenant_id": tenant, "roles": identity_store.list_roles(tenant_id=tenant)}

    @app.post("/api/identity/roles")
    async def identity_role_upsert(body: dict[str, Any], request: Request):
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        try:
            role = identity_store.upsert_role(
                tenant_id=tenant,
                role_code=str(body.get("role_code") or ""),
                name=str(body.get("name") or ""),
                permissions=[str(p) for p in (body.get("permissions") or [])],
            )
        except ValueError as exc:
            raise HTTPException(422, {"code": "INVALID_ROLE", "message": str(exc)}) from exc
        return role

    @app.get("/api/identity/bindings")
    async def identity_bindings(tenant_id: str = "", user_id: str = "",
                                request: Request = None):
        tenant = _tenant_for_request(tenant_id, request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        return {"tenant_id": tenant,
                "bindings": identity_store.list_bindings(tenant_id=tenant, user_id=user_id or None)}

    @app.post("/api/identity/bindings")
    async def identity_bind_user(body: dict[str, Any], request: Request):
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        try:
            bound = identity_store.bind_user(
                tenant_id=tenant,
                user_id=str(body.get("user_id") or ""),
                role_codes=[str(r) for r in (body.get("role_codes") or [])],
                org_id=body.get("org_id"),
                skill=body.get("skill"),
            )
        except ValueError as exc:
            raise HTTPException(422, {"code": "INVALID_BINDING", "message": str(exc)}) from exc
        return bound

    @app.post("/api/identity/bindings/bulk")
    async def identity_bind_users_bulk(body: dict[str, Any], request: Request):
        """按部门批量授权（接缝 3 阶段③）：逐条绑定，任何一条失败整批 422。"""
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        items = body.get("bindings")
        if not isinstance(items, list) or not items:
            raise HTTPException(422, {"code": "INVALID_BULK_BINDING", "message": "bindings 必须为非空数组"})
        try:
            return identity_store.bind_users_bulk(
                tenant_id=tenant, bindings=[item for item in items if isinstance(item, dict)])
        except ValueError as exc:
            raise HTTPException(422, {"code": "INVALID_BULK_BINDING", "message": str(exc)}) from exc

    @app.get("/api/identity/users")
    async def identity_users(tenant_id: str = "", request: Request = None):
        """账号列表（含所属组织与角色），厂长账号管理页数据源。"""
        tenant = _tenant_for_request(tenant_id, request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        return {"tenant_id": tenant, "users": identity_store.list_users(tenant_id=tenant)}

    @app.post("/api/identity/users")
    async def identity_create_user(body: dict[str, Any], request: Request):
        """厂长给员工分配账号：建账号 + 绑角色/组织，初始密码只回显这一次。"""
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        user_id = str(body.get("user_id") or "").strip()
        if not re.match(r"^[A-Za-z0-9_.@-]{3,64}$", user_id):
            raise HTTPException(422, {"code": "INVALID_USER_ID",
                                      "message": "账号只允许字母/数字/_ . @ -，长度 3~64"})
        if identity_store.get_user(tenant_id=tenant, user_id=user_id):
            raise HTTPException(409, {"code": "USER_EXISTS", "message": f"账号已存在: {user_id}"})
        initial_password = str(body.get("password") or "") or generate_password()
        if len(initial_password) < 8:
            raise HTTPException(422, {"code": "WEAK_PASSWORD", "message": "初始密码至少 8 位"})
        role_codes = [str(role) for role in (body.get("role_codes") or [])] or ["worker"]
        org_id = body.get("org_id") or None
        try:
            identity_store.create_user(
                tenant_id=tenant, user_id=user_id,
                password_hash=hash_password(initial_password),
                display_name=str(body.get("display_name") or "").strip() or user_id,
                org_id=org_id, status="active", must_change_password=1)
            identity_store.bind_user(tenant_id=tenant, user_id=user_id,
                                     role_codes=role_codes, org_id=org_id,
                                     skill=body.get("skill"))
        except ValueError as exc:
            raise HTTPException(422, {"code": "INVALID_USER", "message": str(exc)}) from exc
        return {"tenant_id": tenant, "user_id": user_id,
                "display_name": str(body.get("display_name") or "").strip() or user_id,
                "org_id": org_id, "role_codes": role_codes, "status": "active",
                "must_change_password": True,
                "initial_password": initial_password,
                "password_returned_once": True}

    @app.patch("/api/identity/users/{user_id}")
    async def identity_update_user(user_id: str, body: dict[str, Any], request: Request):
        """改姓名 / 调组织 / 启用停用 / 重绑角色（停用即吊销其现有会话）。"""
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        try:
            updated = identity_store.update_user(
                tenant_id=tenant, user_id=user_id,
                display_name=body.get("display_name"),
                org_id=body.get("org_id") if "org_id" in body else None,
                status=body.get("status"))
        except ValueError as exc:
            raise HTTPException(422, {"code": "INVALID_USER", "message": str(exc)}) from exc
        role_codes = body.get("role_codes")
        if isinstance(role_codes, list) and role_codes:
            try:
                identity_store.bind_user(tenant_id=tenant, user_id=user_id,
                                         role_codes=[str(role) for role in role_codes],
                                         org_id=body.get("org_id") or updated.get("org_id"),
                                         skill=body.get("skill"))
            except ValueError as exc:
                raise HTTPException(422, {"code": "INVALID_BINDING", "message": str(exc)}) from exc
        return {**updated, "role_codes": role_codes if isinstance(role_codes, list) else None}

    @app.post("/api/identity/users/{user_id}/reset-password")
    async def identity_reset_password(user_id: str, body: dict[str, Any], request: Request):
        """重置密码：生成新初始密码，只回显这一次，并要求首登改密。"""
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        if not identity_store.get_user(tenant_id=tenant, user_id=user_id):
            raise HTTPException(404, {"code": "USER_NOT_FOUND", "message": f"账号不存在: {user_id}"})
        new_password = generate_password()
        identity_store.set_password(tenant_id=tenant, user_id=user_id,
                                    password_hash=hash_password(new_password),
                                    must_change_password=1)
        return {"tenant_id": tenant, "user_id": user_id,
                "initial_password": new_password, "password_returned_once": True,
                "must_change_password": True}

    @app.delete("/api/identity/users/{user_id}")
    async def identity_delete_user(user_id: str, tenant_id: str = "",
                                   request: Request = None):
        """删除账号（不能删自己；不能删最后一个账号）。"""
        tenant = _tenant_for_request(tenant_id, request)
        principal = _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        if user_id == str(principal.get("actor") or ""):
            raise HTTPException(409, {"code": "CANNOT_DELETE_SELF", "message": "不能删除当前登录账号"})
        if not identity_store.get_user(tenant_id=tenant, user_id=user_id):
            raise HTTPException(404, {"code": "USER_NOT_FOUND", "message": f"账号不存在: {user_id}"})
        if identity_store.count_users(tenant_id=tenant) <= 1:
            raise HTTPException(409, {"code": "LAST_USER", "message": "系统至少保留一个账号"})
        deleted = identity_store.delete_user(tenant_id=tenant, user_id=user_id)
        if not deleted:
            raise HTTPException(404, {"code": "USER_NOT_FOUND", "message": f"账号不存在: {user_id}"})
        return {"tenant_id": tenant, "user_id": user_id, "deleted": True}

    @app.get("/api/identity/resolve")
    async def identity_resolve(tenant_id: str = "", user_id: str = "",
                               request: Request = None):
        tenant = _tenant_for_request(tenant_id, request)
        principal = _request_principal(request)[0]
        actor = str(principal.get("actor") or "")
        target = user_id or actor
        if target != actor:
            _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        elif not actor:
            raise HTTPException(401, {"code": "AUTHENTICATION_REQUIRED", "message": "未认证"})
        return identity_store.resolve(tenant_id=tenant, user_id=target)

    @app.get("/api/identity/authz/recent")
    async def identity_authz_recent(tenant_id: str = "", limit: int = 50,
                                    request: Request = None):
        """最近授权判定（deny 留痕查询；identity.admin）。"""
        tenant = _tenant_for_request(tenant_id, request)
        _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        return {"tenant_id": tenant,
                "decisions": identity_store.recent_authz(tenant_id=tenant, limit=max(1, min(limit, 500)))}

    # --------------------------------------------- 引导AI（F-015 / P-013）

    def _load_workers(body: dict[str, Any], tenant: str) -> list[dict[str, Any]]:
        explicit = body.get("workers")
        if isinstance(explicit, list) and explicit:
            return [item for item in explicit if isinstance(item, dict)]
        from .m0_backend import M0Store

        m0_db = Path(os.getenv("YUNPAI_M0_DB", "runtime/yunpai-m0.sqlite"))
        return [entity.get("payload_json") or {}
                for entity in M0Store(m0_db).list_entities("worker", tenant).get("entities", [])]

    # --------------------------------------------- 引导AI 轻量对话（F-015 重设计）

    @app.get("/api/guidance/presets")
    async def guidance_presets():
        """规模三档选项（只读，前端渲染首开三选一按钮；具体架构由引导模型生成）。"""
        return {"presets": [dict(o) for o in SCALE_OPTIONS]}

    @app.post("/api/guidance/chat")
    async def guidance_chat(body: dict[str, Any], request: Request):
        """引导AI 对话入口（LLM 驱动）：规模三选一 → 模型生成架构与分配判断 →
        对话增删改 → 确认落地。state 为客户端回传的不透明 JSON，服务端无会话表。"""
        tenant = _tenant_for_request(body.get("tenant_id"), request)
        principal = _require_identity_permission("identity.admin", tenant_id=tenant, request=request)
        roster = _load_workers(body, tenant)
        router = getattr(graph.planner, "router", None)
        result = await handle_guidance_message(
            identity_store, tenant_id=tenant, user_id=str(principal.get("actor") or ""),
            message=str(body.get("message") or ""), roster=roster,
            state=body.get("state"), router=router,
        )
        return {"tenant_id": tenant, **result}

    return app


def main() -> None:
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=9000)


if __name__ == "__main__":
    main()
