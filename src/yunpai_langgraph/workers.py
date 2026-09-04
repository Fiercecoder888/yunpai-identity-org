from __future__ import annotations

import base64
import json
from hashlib import sha256
from math import ceil
from typing import Any


def _trace(ctx: dict[str, Any], suffix: str) -> str:
    return f"{ctx.get('task_id', 'local')}:{suffix}"


def _evidence(module: str, ref: str, detail: str) -> dict[str, Any]:
    return {"module": module, "source_ref": ref, "evidence_ref": f"{module}:{ref}", "detail": detail}


def _decode_file(file_value: Any) -> tuple[str, bytes]:
    if isinstance(file_value, str):
        return "document.bin", base64.b64decode(file_value)
    if not isinstance(file_value, dict):
        raise ValueError("file must be a base64 string or file object")
    return str(file_value.get("filename") or "document.bin"), base64.b64decode(str(file_value.get("content_b64") or ""))


def _json_content(raw: bytes) -> dict[str, Any]:
    try:
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _number(value: Any, default: float = 0.0) -> float:
    """Normalize nullable spreadsheet/provider numbers without masking bad types."""
    if value is None or value == "":
        return default
    return float(value)


async def m0_import(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    candidates, quarantined = [], []
    for item in payload["files"]:
        name, raw = _decode_file(item)
        if not raw:
            quarantined.append({"filename": name, "reason": "empty_content"})
            continue
        digest = sha256(raw).hexdigest()
        candidates.append({
            "candidate_id": f"cand-{digest[:12]}", "filename": name, "sha256": digest,
            "status": "needs_review", "records": _json_content(raw).get("records", []),
            "evidence": [_evidence("m0", name, "原始文件哈希")],
        })
    batch_id = f"batch-{ctx['task_id'][-12:]}"
    return {
        "id": batch_id, "batch_id": batch_id,
        "status": "awaiting_review" if candidates or quarantined else "failed",
        "candidates": candidates, "quarantined": quarantined,
        # 本地 fixture 语义：候选不是 M0 canonical；生产发布需 HTTP transport + 真实 M0 回读。
        "provider": "local_fixture",
        "canonical": False,
        "transport": "local",
        "readback": {"available": False, "detail": "本地 fixture 只登记候选，未发布 canonical；需要 YUNPAI_TOOL_TRANSPORT=http 与真实 M0 base URL/审核授权"},
        "evidence": [_evidence("m0", "import", f"{len(candidates)} candidates (local fixture, non-canonical)")],
    }


async def m0_commit(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    batch_id = str(payload.get("batch_id") or "")
    return {
        # 任务书 §1.4：data_import_commit=committed 只有在 canonical entity/version、
        # ledger、outbox 可回读时才成立。本地 fixture 无真实 M0 表，故只记录意图，
        # 状态显式标记 fixture_recorded，不得表述为已发布 canonical。
        "status": "fixture_recorded",
        "batch_id": batch_id,
        "provider": "local_fixture",
        "canonical": False,
        "transport": "local",
        "revision": "",
        "ledger_id": "",
        "master_counts": {},
        "readback": {
            "available": False,
            "detail": "local transport 无 M0 canonical 表与回读接口；真实发布需部署方提供 M0 URL、PostgreSQL schema/权限、审核授权和写入回读接口",
        },
        "evidence": [_evidence("m0", batch_id or "fixture", "本地 fixture 记录发布意图；未发布 canonical、无 ledger/outbox 回读，需人工 Gate 后才可对接真实 M0")],
    }


async def m1_parse(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    filename, raw = _decode_file(payload["file"])
    fixture = payload.get("_fixture_document") or _json_content(raw)
    lines = fixture.get("lines") or fixture.get("records") or []
    confidence = float(fixture.get("confidence", 1.0 if lines else 0.0))
    source_issues = fixture.get("validation_issues") if isinstance(fixture.get("validation_issues"), list) else []
    header = {
        "order_id": fixture.get("order_id"), "product_code": fixture.get("product_code"),
        "quantity": fixture.get("quantity"), "due_date": fixture.get("due_date"),
    }
    missing = [key for key, value in header.items() if value in (None, "")]
    document = {
        "schema_version": "m1.document.v2",
        "source": {"original_filename": filename, "sha256": sha256(raw).hexdigest()},
        "document_type": "order", "document_subtype": "customer_order",
        "header": header, "lines": lines, "totals": {}, "field_meta": {},
        "validation_issues": [*source_issues, *({"code": "MISSING_FIELD", "message": f"缺少字段: {key}", "paths": [f"$.header.{key}"]} for key in missing)],
    }
    validation_issues = document["validation_issues"]
    needs_review = confidence < 0.8 or bool(validation_issues)
    return {
        "task_id": f"m1-{ctx['task_id'][-10:]}", "status": "needs_review" if needs_review else "done",
        "processing_stage": "review" if needs_review else "complete",
        "schema_version": "m1.document.v2", "document_schema_version": "m1.document.v2",
        "document_subtype": "customer_order", "needs_review": needs_review,
        "overall_confidence": confidence, "document": document,
        "extraction": {"order": header, "lines": lines},
        "order": header, "lines": lines, "missing": missing,
        "evidence": [_evidence("m1", filename, "m1.document.v2 字段证据")],
    }


async def m2_bom(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    profile = payload["product_profile"]
    lines = payload.get("bom_lines") or []
    if not profile.get("product_code") or not lines:
        return {
            "status": "human_input_required", "run_id": f"m2-{ctx['task_id'][-10:]}",
            "workflow_sequence": ["validate_input"], "bom_generation": {"bom_lines": []},
            "sop_generation": {}, "open_customer_questions": [
                {"field": "product_code_or_bom", "question": "请补充产品编码和已确认 BOM 行"}
            ], "artifacts": {}, "code": "BLOCKED_INPUT",
        }
    return {
        "status": "draft_created", "run_id": f"m2-{ctx['task_id'][-10:]}",
        "workflow_sequence": ["history_search", "bom_generate", "sop_generate"],
        "bom_generation": {"product_code": profile["product_code"], "bom_version": "draft-1", "bom_lines": lines, "assumptions": [], "evidence": [_evidence("m2", "bom_lines", "受控 BOM 输入")]},
        "sop_generation": {"status": "draft", "operation_count": len(payload.get("routing_steps") or lines)},
        "open_customer_questions": [], "artifacts": {},
        "evidence": [_evidence("m2", "workflow", "BOM/SOP draft")],
    }


async def m3_mrp(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    order, bom = payload.get("order") or {}, payload.get("bom") or {}
    if not bom.get("lines"):
        order_id = str(order.get("order_id") or "")
        bom_id = str(order.get("bom_id") or bom.get("bom_id") or "")
        return {
            "success": False, "code": "BLOCKED_INPUT", "errors": [{"code": "MISSING_BOM", "message": "缺少可计算的 BOM 行", "details": []}],
            "data": {
                "procurement_plan_id": f"blocked-{ctx['task_id'][-10:]}", "project_id": str(order.get("project_id") or order_id),
                "order_id": order_id, "bom_id": bom_id, "product_name": str(order.get("product_name") or bom.get("product_name") or ""),
                "order_qty": _number(order.get("order_qty")), "due_date": str(order.get("due_date") or ""),
                "status": "requires_material_review", "availability_status": "no_procurement_materials", "lines": [], "shortage_lines": [],
                "warnings": ["缺少 BOM 行"], "material_matching": [], "quality_issues": [],
                "supply_source": {"owner": "m3", "provider": "local_fixture", "upstream_supply_ignored": False},
            },
            "evidence": [_evidence("m3", "bom", "未提供 BOM 行，停止需求计算")], "trace_id": _trace(ctx, "m3"),
        }
    inventory = {str(x.get("material_code")): _number(x.get("available_qty")) for x in payload.get("inventory_snapshot", [])}
    output_lines = []
    for index, line in enumerate(bom.get("lines", []), start=1):
        code = str(line.get("material_code") or "")
        gross = _number(order.get("order_qty")) * _number(line.get("qty_per")) * (1 + _number(line.get("loss_rate")))
        available = inventory.get(code, 0.0)
        shortage = max(0.0, gross - available)
        output_lines.append({
            "line_id": str(line.get("line_id") or f"line-{index}"), "material_code": code,
            "material_name": str(line.get("material_name") or code), "uom": str(line.get("uom") or "pcs"),
            "gross_required_qty": gross, "book_qty": available, "available_qty": available,
            "open_po_qty": 0.0, "shortage_qty": shortage, "suggest_purchase_qty": shortage,
            "readiness": "shortage" if shortage else "ready",
            "recommendation": "purchase" if shortage else "use_inventory",
        })
    shortages = [line for line in output_lines if line["shortage_qty"] > 0]
    data = {
        "procurement_plan_id": str(order.get("procurement_plan_id") or f"plan-{ctx['task_id'][-10:]}"),
        "project_id": str(order.get("project_id") or ""), "order_id": str(order.get("order_id") or ""),
        "bom_id": str(order.get("bom_id") or bom.get("bom_id") or ""),
        "product_name": str(order.get("product_name") or bom.get("product_name") or ""),
        "order_qty": _number(order.get("order_qty")), "due_date": str(order.get("due_date") or ""),
        "status": "ready_for_m4", "availability_status": "partial_shortage" if shortages else "ready",
        "lines": output_lines, "shortage_lines": shortages, "warnings": [],
        "material_matching": [], "quality_issues": [],
        "supply_source": {"owner": "m3", "provider": "local_fixture", "upstream_supply_ignored": False},
    }
    return {"success": True, "data": data, "errors": [], "trace_id": _trace(ctx, "m3"), "evidence": [_evidence("m3", "inventory_snapshot", "固定库存快照计算")]}


async def m4_purchase(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    suggestions = payload["suggestions"]
    digest = sha256(json.dumps(suggestions, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {
        "id": int(digest[:8], 16), "filename": "orchestrator-json", "total_rows": len(suggestions),
        "valid_rows": len(suggestions), "invalid_rows": 0, "duplicate_rows": 0,
        "status": "needs_review" if suggestions else "not_required",
        "tenant_id": payload.get("tenant_id"), "site_id": payload.get("site_id"),
        "tracking_task_id": payload.get("tracking_task_id") or ctx.get("task_id"),
        "idempotency_key": payload.get("idempotency_key"), "source_plan_id": payload.get("procurement_plan_id"),
        "source_plan_version": payload.get("procurement_plan_version_id"),
        "source_plan_checksum": payload.get("source_plan_checksum"), "source_order_id": payload.get("order_id"),
        "payload_digest": digest, "items": suggestions, "suggestions": suggestions,
        "evidence": [_evidence("m4", "m3.shortage_lines", "M3 到 M4 受控桥接")],
    }


async def m5_schedule(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    # PMC P1：显式 priority_sort 时按交期/优先级重排订单（不改变默认输入顺序语义）。
    if str(payload.get("priority_sort") or "").lower() in {"true", "1", "yes"}:
        orders = payload.get("orders") or []
        priority_weight = {"urgent": 0, "high": 1, "normal": 2, "low": 3}

        def _sort_key(order: dict[str, Any]) -> tuple:
            due = str(order.get("due_time") or "")
            return (priority_weight.get(str(order.get("priority") or "normal").lower(), 2), due, str(order.get("order_id") or ""))

        if orders:
            payload["orders"] = sorted(orders, key=_sort_key)
    # PMC P0（补充确认）：显式生产请求（production_use_allowed=true）强制 v2；
    # legacy 贪心仅允许显式 preview 或本地 fixture 编排（无生产授权标记）。
    purpose = str(payload.get("scenario_purpose") or "production")
    explicit_production = bool(payload.get("production_use_allowed")) and str(payload.get("production_use_allowed")).lower() in {"true", "1", "yes"}
    has_v2_facts = bool(payload.get("pmc_v2") or payload.get("pmc_v2_bundle") or payload.get("calendar_windows") or any(
        isinstance(step, dict) and (step.get("standard_minutes") is not None or step.get("std_minutes") is not None)
        for step in payload.get("routing_steps", [])
    ))
    legacy_preview = bool(payload.get("legacy_preview")) or str(payload.get("scenario_purpose") or "").lower() in {"preview", "wip_pmc", "wip_pmc_review"}
    if explicit_production and not has_v2_facts and not legacy_preview:
        return {
            "success": False, "code": "BLOCKED_INPUT",
            "errors": [{"code": "LEGACY_PREVIEW_ONLY", "message": "production_use_allowed=true 的排程必须携带 v2 事实（日历/标准工时/资源快照）；legacy 贪心仅允许显式 preview", "details": []}],
            "data": {"idempotency_key": payload.get("idempotency_key", ""), "schedule": {"scenario_purpose": purpose, "operations": [], "metrics": {"operation_count": 0, "makespan_minutes": 0}}, "scenario_purpose": purpose, "lifecycle_status": "blocked", "input_hash": "", "production_blocked": True},
            "trace_id": _trace(ctx, "m5-pmc-production-v2-only"),
            "evidence": [_evidence("m5", "legacy", "显式生产请求缺 v2 事实，拒绝 legacy 贪心排程")],
        }
    if has_v2_facts:
        from .pmc_v2_adapter import PmcError, run_pmc_v2
        try:
            result = run_pmc_v2(payload)
            # The M5 manifest requires lifecycle identity and the root TaskID
            # even for v2 candidates; keep these fields at the adapter edge so
            # output-schema validation cannot silently drop traceability.
            data = result.setdefault("data", {})
            data.setdefault("parent_plan_version", payload.get("expected_head_plan_version"))
            data.setdefault("tracking_task_id", ctx.get("task_id"))
            result["trace_id"] = result.get("trace_id") or _trace(ctx, "m5-pmc-v2")
            return result
        except PmcError as exc:
            return {"success": False, "code": exc.code, "errors": [{"code": exc.code, "message": exc.message, "details": []}], "data": {"idempotency_key": payload.get("idempotency_key", ""), "schedule": {"scenario_purpose": purpose, "operations": [], "metrics": {"operation_count": 0, "makespan_minutes": 0}, "algorithm_version": "pmc-v2-frozen-20260902"}, "scenario_purpose": purpose, "lifecycle_status": "draft", "input_hash": "", "algorithm_version": "pmc-v2-frozen-20260902"}, "trace_id": _trace(ctx, "m5-pmc-v2-blocked"), "evidence": [_evidence("m5", "pmc_v2", exc.message)]}
    resources = {str(item["resource_id"]): item for item in payload["resources"]}
    if payload.get("orders") and not payload.get("routing_steps"):
        return {
            "success": False, "code": "BLOCKED_INPUT", "errors": [{"code": "MISSING_SOP", "message": "缺少可执行的 SOP/工艺路线", "details": []}],
            "data": {
                "idempotency_key": str(payload.get("idempotency_key") or ""),
                "schedule": {"scenario_purpose": payload.get("scenario_purpose", "production"), "operations": [], "metrics": {"makespan_minutes": 0, "operation_count": 0}},
                "scenario_purpose": payload.get("scenario_purpose", "production"), "lifecycle_status": "draft", "input_hash": "",
                "parent_plan_version": payload.get("expected_head_plan_version"), "tracking_task_id": ctx.get("task_id"),
            },
            "evidence": [_evidence("m5", "routing_steps", "未提供 SOP/工艺路线，停止排程")], "trace_id": _trace(ctx, "m5"),
        }
    operations, cursor = [], 0
    for order in payload["orders"]:
        product_id = str(order["product_id"])
        routes = sorted((r for r in payload["routing_steps"] if str(r["product_id"]) == product_id), key=lambda item: item["sequence"])
        for route in routes:
            eligible = route.get("eligible_resources") or []
            selected = next((x for x in eligible if x.get("resource_id") in resources and resources[x["resource_id"]].get("status", "available") == "available"), None)
            if not selected:
                data = {"idempotency_key": payload["idempotency_key"], "schedule": {"scenario_purpose": payload.get("scenario_purpose", "production")}, "scenario_purpose": payload.get("scenario_purpose", "production"), "input_hash": "", "parent_plan_version": payload.get("expected_head_plan_version"), "tracking_task_id": ctx.get("task_id")}
                return {"success": False, "data": data, "errors": [{"code": "BLOCKED_INPUT", "message": "没有可用资源", "details": [route["operation_id"]]}], "trace_id": _trace(ctx, "m5")}
            duration = float(selected.get("processing_minutes") or selected.get("cycle_minutes") or 1) * float(order["quantity"])
            start, cursor = cursor, cursor + max(1, ceil(duration))
            operations.append({"order_id": order["order_id"], "operation_id": route["operation_id"], "resource_id": selected["resource_id"], "start_minute": start, "end_minute": cursor})
    purpose = payload.get("scenario_purpose", "production")
    digest = sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    schedule = {"scenario_purpose": purpose, "plan_version": f"draft-{digest[:10]}", "operations": operations, "metrics": {"operation_count": len(operations), "makespan_minutes": cursor}, "validation_report": {"status": "pass", "errors": []}}
    data = {"idempotency_key": payload["idempotency_key"], "schedule": schedule, "scenario_purpose": purpose, "lifecycle_status": "draft", "input_hash": digest, "parent_plan_version": payload.get("expected_head_plan_version"), "tracking_task_id": ctx.get("task_id"), "replayed": False}
    return {"success": True, "data": data, "errors": [], "trace_id": _trace(ctx, "m5"), "evidence": [_evidence("m5", "planning_snapshot", "订单/路线/资源快照")]}


HANDLERS = {
    "data_import_run": m0_import,
    "data_import_commit": m0_commit,
    "ingest_document": m1_parse,
    "run_bom_sop_workflow": m2_bom,
    "run_m3_procurement_requirements": m3_mrp,
    "import_m4_purchase_suggestions_json": m4_purchase,
    "solve_scheduling": m5_schedule,
}
