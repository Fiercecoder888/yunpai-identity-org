from __future__ import annotations

import base64
import json
from io import BytesIO
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


def _extract_uploaded_bom(files: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse uploaded BOM workbooks into M2 lines with source evidence.

    M2 receives bytes only after a Gate retry, so this deterministic parser is
    deliberately independent of the LLM and preserves workbook coordinates.
    """
    if not isinstance(files, list):
        return [], []
    try:
        from openpyxl import load_workbook
    except ImportError:
        return [], [{"code": "PARSER_UNAVAILABLE", "message": "缺少 openpyxl，无法解析 BOM XLSX"}]
    aliases = {
        "material_code": ("物料编码", "料号", "物料编号", "材料编码", "编码"),
        "material_name": ("材料名称", "原材料名称", "物料名称", "品名", "名称"),
        "specification": ("规格", "规格型号", "型号"),
        "quantity": ("用量", "数量", "用量/装箱数量", "单机用量"),
        "unit": ("单位",),
        "supplier": ("供应商",),
    }
    lines: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    for file_value in files:
        filename, raw = _decode_file(file_value)
        if not filename.lower().endswith(".xlsx"):
            issues.append({"code": "UNSUPPORTED_BOM_FILE", "filename": filename, "message": "BOM 上传当前需要 XLSX"})
            continue
        try:
            workbook = load_workbook(BytesIO(raw), read_only=True, data_only=True)
            for sheet in workbook.worksheets:
                rows = list(sheet.iter_rows(values_only=True))
                header = None
                mapping: dict[str, int] = {}
                for row_index, row in enumerate(rows[:30], start=1):
                    candidate = {
                        key: index
                        for key, alias_list in aliases.items()
                        for index, value in enumerate(row)
                        if any(alias in str(value or "").replace(" ", "") for alias in alias_list)
                    }
                    if "material_code" in candidate and ("material_name" in candidate or "quantity" in candidate):
                        header, mapping = row_index, candidate
                        break
                if header is None:
                    continue
                for row_index, row in enumerate(rows[header:], start=header + 1):
                    code_index = mapping.get("material_code")
                    code = row[code_index] if code_index is not None and code_index < len(row) else None
                    if code in (None, ""):
                        continue
                    line = {"material_code": str(code).strip(), "source_file": filename, "source_sheet": sheet.title, "source_row": row_index}
                    for key, index in mapping.items():
                        if index < len(row) and row[index] not in (None, ""):
                            line[key] = row[index]
                    if "quantity" not in line:
                        issues.append({"code": "MISSING_BOM_QUANTITY", "filename": filename, "sheet": sheet.title, "row": row_index, "message": "BOM 行缺少用量"})
                    lines.append(line)
            workbook.close()
        except Exception as exc:
            issues.append({"code": "BOM_PARSE_FAILED", "filename": filename, "message": str(exc)})
    return lines, issues


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
        "evidence": [_evidence("m0", "import", f"{len(candidates)} candidates")],
    }


async def m0_commit(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "committed", "batch_id": payload["batch_id"],
        "master_counts": {"published_batches": 1},
        "revision": "m0-v1", "ledger_id": f"ledger-{ctx['task_id'][-10:]}",
        "evidence": [_evidence("m0", payload["batch_id"], "人工批准后的 canonical 发布")],
    }


async def m1_parse(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Local-compat M1 handler (fixture/preview only, never production).

    This handler intentionally does NOT implement the full multi-format M1
    parsing the manifest describes (PDF/image/DOCX/CAD/archive + MinerU/
    Instructor extraction, TaskStore, review queue, knowledge projections).
    It only understands JSON or a pre-parsed ``_fixture_document`` structure
    for demo/local flows.  Any other content fails closed with an explicit
    code so a fixture success is never mistaken for a complete M1 parse; in
    production transport (``YUNPAI_TOOL_TRANSPORT=http``) this handler is
    replaced by the dedicated M1 HTTP adapter pointing at the real service.
    """
    filename, raw = _decode_file(payload["file"])
    fixture = payload.get("_fixture_document")
    parsed_source = fixture if isinstance(fixture, dict) and fixture else _json_content(raw)
    if not parsed_source:
        return {
            "task_id": f"m1-{ctx['task_id'][-10:]}",
            "status": "failed",
            "code": "LOCAL_FIXTURE_UNSUPPORTED_FORMAT",
            "message": "本地 fixture handler 无法解析该文件（仅支持 JSON 或预解析结构，不冒充完整 M1 多格式解析）。生产解析请通过 M1_URL 调用真实 M1 服务。",
            "provider": "local_fixture",
            "fixture": True,
            "document": None,
            "document_schema_version": None,
            "schema_version": None,
            "needs_review": False,
            "overall_confidence": 0.0,
        }
    lines = parsed_source.get("lines") or parsed_source.get("records") or []
    confidence = float(parsed_source.get("confidence", 1.0 if lines else 0.0))
    source_issues = parsed_source.get("validation_issues") if isinstance(parsed_source.get("validation_issues"), list) else []
    header = {
        "order_id": parsed_source.get("order_id"), "product_code": parsed_source.get("product_code"),
        "quantity": parsed_source.get("quantity"), "due_date": parsed_source.get("due_date"),
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
        "provider": "local_fixture",
        "fixture": True,
        "evidence": [_evidence("m1", filename, "m1.document.v2 字段证据（本地 fixture，非生产解析）")],
    }


async def m2_bom(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    profile = payload["product_profile"]
    lines = payload.get("bom_lines") or []
    parse_issues: list[dict[str, Any]] = []
    if not lines and payload.get("bom_files"):
        lines, parse_issues = _extract_uploaded_bom(payload.get("bom_files"))
    routing_steps = payload.get("routing_steps") or []
    if not profile.get("product_code") or not lines or parse_issues:
        return {
            "status": "human_input_required", "run_id": f"m2-{ctx['task_id'][-10:]}",
            "workflow_sequence": ["validate_input"], "bom_generation": {"bom_lines": []},
            "sop_generation": {}, "open_customer_questions": [
                {"field": "product_code_or_bom", "question": "请补充产品编码和已确认 BOM 行"},
                *([{"field": "bom_file_parse", "question": issue["message"]} for issue in parse_issues[:5]]),
            ], "artifacts": {}, "code": "BLOCKED_INPUT",
        }
    duplicate_codes = sorted({code for code in (str(line.get("material_code") or "") for line in lines) if code and sum(1 for item in lines if str(item.get("material_code") or "") == code) > 1})
    matching = {"status": "matched", "score": 1.0, "matched_by": ["product_code", "material_code"], "ambiguous_candidates": 0, "unmatched_fields": []}
    return {
        "status": "draft_created", "run_id": f"m2-{ctx['task_id'][-10:]}",
        "workflow_sequence": ["parse_sources", "history_search", "match_bom_sop", "bom_generate", "sop_generate"],
        "bom_generation": {"product_code": profile["product_code"], "bom_version": "draft-1", "bom_lines": lines, "assumptions": [], "duplicate_material_codes": duplicate_codes, "evidence": [_evidence("m2", "bom_lines", "受控 BOM 输入")]},
        "sop_generation": {"status": "draft", "operation_count": len(routing_steps or lines), "source_files": payload.get("sop_files") or []},
        "matching": matching,
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
    # Explicit WIP/v2 facts are handled by the frozen constrained scheduler.
    # The legacy branch remains available for older lightweight fixtures.
    if payload.get("pmc_v2") or payload.get("pmc_v2_bundle") or payload.get("calendar_windows") or any(
        isinstance(step, dict) and (step.get("standard_minutes") is not None or step.get("std_minutes") is not None)
        for step in payload.get("routing_steps", [])
    ):
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
            return {"success": False, "code": exc.code, "errors": [{"code": exc.code, "message": exc.message, "details": []}], "data": {"idempotency_key": payload.get("idempotency_key", ""), "schedule": {"scenario_purpose": payload.get("scenario_purpose", "production"), "operations": [], "metrics": {"operation_count": 0, "makespan_minutes": 0}, "algorithm_version": "pmc-v2-frozen-20260902"}, "scenario_purpose": payload.get("scenario_purpose", "production"), "lifecycle_status": "draft", "input_hash": "", "algorithm_version": "pmc-v2-frozen-20260902"}, "trace_id": _trace(ctx, "m5-pmc-v2-blocked"), "evidence": [_evidence("m5", "pmc_v2", exc.message)]}
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
