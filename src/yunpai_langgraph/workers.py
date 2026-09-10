from __future__ import annotations

import base64
import json
import os
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


def _m0_store(ctx: dict[str, Any]):
    import os

    from .m0_sandbox import M0SandboxStore

    db_path = ctx.get("m0_sandbox_db") or os.getenv("YUNPAI_M0_SANDBOX_DB") or "runtime/yunpai-m0-sandbox.sqlite"
    return M0SandboxStore(db_path)


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
    from .file_sniff import sniff_documents

    files = payload.get("files") or []
    items = [item for item in files if isinstance(item, dict)]
    sniffed = sniff_documents(items)
    accepted = [item for item in sniffed if item.get("status") == "accepted"]
    skipped = [item for item in sniffed if item.get("status") != "accepted"]
    encoded_by_name = {str(item.get("filename")): item for item in items}
    store = _m0_store(ctx)
    registered = store.register_batch(
        task_id=str(ctx.get("task_id") or "local"),
        tenant_id=str(ctx.get("tenant_id") or "default"),
        files=[{**encoded_by_name.get(item.get("filename"), {}), "filename": item.get("filename")} for item in accepted],
        batch_id=payload.get("batch_id"),
    )
    batch_id = registered["batch_id"]
    quarantined = [{"filename": item.get("filename"), "reason": item.get("reason") or "unsupported_or_invalid"} for item in skipped]
    preview_documents = store.preview(batch_id).get("documents", [])
    if not preview_documents and not quarantined:
        return {"id": batch_id, "batch_id": batch_id, "status": "failed", "candidates": [], "quarantined": [], "environment": "sandbox", "canonical": False, "readback": {"available": False, "detail": "没有可登记文件"}, "evidence": []}
    return {
        "id": batch_id, "batch_id": batch_id,
        "status": "awaiting_review",
        "candidates": [
            {
                "candidate_id": doc["candidate_id"], "filename": doc["filename"], "sha256": doc["sha256"],
                "status": doc["review_status"], "document_kind": doc["document_kind"],
                "records": doc.get("payload_json") if isinstance(doc.get("payload_json"), list) else [],
                "evidence": [_evidence("m0", doc["filename"], "sandbox 候选登记哈希")],
            }
            for doc in preview_documents
        ],
        "quarantined": quarantined,
        # 本地 sandbox 语义：候选不是 M0 canonical；生产发布需 HTTP transport + 真实 M0 回读。
        "provider": "local_fixture",
        "canonical": False,
        "transport": "local",
        "environment": "sandbox",
        "readback": {"available": False, "detail": "本地 sandbox 只登记候选，未发布 canonical；需要 YUNPAI_TOOL_TRANSPORT=http 与真实 M0 base URL/审核授权"},
        "evidence": [_evidence("m0", "import", f"{len(preview_documents)} candidates registered in sandbox (non-canonical)")],
    }


async def m0_status(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    result = _m0_store(ctx).status(str(payload.get("batch_id") or ""))
    if result is None:
        raise ValueError(f"batch not found: {payload.get('batch_id')}")
    return result


async def m0_preview(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    return _m0_store(ctx).preview(str(payload.get("batch_id") or ""))


async def m0_resolve(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    batch_id = str(payload.get("batch_id") or "")
    kind = str(payload.get("kind") or "")
    action = str(payload.get("action") or "")
    raw_id = payload.get("id")
    candidate_id = str(payload.get("candidate_id") or "")
    if kind not in {"entity", "mapping", "candidate"}:
        raise ValueError("resolve kind 必须为 entity|mapping|candidate")
    if action not in {"approve", "reject"}:
        raise ValueError("resolve action 必须为 approve|reject")
    store = _m0_store(ctx)
    try:
        if candidate_id:
            return store.resolve(batch_id=batch_id, candidate_id=candidate_id, action=action, actor=str(ctx.get("actor") or "operator"))
        resolve_id = int(raw_id) if str(raw_id).strip().isdigit() else None
        if resolve_id is None:
            raise ValueError("resolve 需要显式 id(候选序号) 或 candidate_id")
        return store.resolve(batch_id=batch_id, resolve_id=resolve_id, action=action, actor=str(ctx.get("actor") or "operator"))
    except ValueError as exc:
        if "already decided" in str(exc):
            raise
        raise ValueError(str(exc)) from exc


async def m0_commit(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    batch_id = str(payload.get("batch_id") or "")
    store = _m0_store(ctx)
    status_result = store.status(batch_id)
    if status_result is None:
        raise ValueError(f"batch not found: {batch_id}")
    require_resolved = str(payload.get("require_resolved") or "").lower() in {"true", "1", "yes"}
    pending = store.pending_count(batch_id)
    if require_resolved and pending > 0:
        return {
            "status": "blocked", "code": "BLOCKED_INPUT",
            "errors": [{"code": "PENDING_REVIEW", "message": f"batch {batch_id} 仍有 {pending} 个候选未裁决，禁止 commit", "details": []}],
            "batch_id": batch_id,
            # 本地 sandbox 语义：绝不表述为已发布 canonical。
            "provider": "local_fixture", "canonical": False, "transport": "local", "environment": "sandbox",
            "readback": {"available": False, "detail": "未完成人工裁决，未发布 canonical"},
            "evidence": [_evidence("m0", batch_id, "commit 被拒：存在未裁决候选")],
        }
    return {
        # 任务书 §1.4：data_import_commit=committed 只有在 canonical entity/version、
        # ledger、outbox 可回读时才成立。本地 sandbox 无真实 M0 表，故只记录意图，
        # 状态显式标记 fixture_recorded，不得表述为已发布 canonical。
        "status": "fixture_recorded",
        "batch_id": batch_id,
        "provider": "local_fixture",
        "canonical": False,
        "transport": "local",
        "environment": "sandbox",
        "revision": "",
        "ledger_id": "",
        "master_counts": {},
        "pending_review_before_commit": pending if require_resolved else 0,
        "readback": {
            "available": False,
            "detail": "local transport 无 M0 canonical 表与回读接口；真实发布需部署方提供 M0 URL、PostgreSQL schema/权限、审核授权和写入回读接口",
        },
        "evidence": [_evidence("m0", batch_id or "fixture", "本地 sandbox 记录发布意图；未发布 canonical、无 ledger/outbox 回读，需人工 Gate 后才可对接真实 M0")],
    }


async def m1_parse(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """Local-compat M1 handler (fixture/preview only, never production).

    This handler intentionally does NOT implement the full multi-format M1
    parsing the manifest describes (PDF/image/DOCX/CAD/archive + MinerU/
    Instructor extraction, TaskStore, review queue, knowledge projections).
    It understands JSON, a pre-parsed ``_fixture_document`` structure, and —
    for XLSX/XLSM order spreadsheets — the deterministic order parser shared
    with ``business_catalog``/M1 HTTP supplement (``order_semantics``).  All
    other content fails closed with an explicit code so a fixture success is
    never mistaken for a complete M1 parse; in production transport
    (``YUNPAI_TOOL_TRANSPORT=http``) this handler is replaced by the dedicated
    M1 HTTP adapter pointing at the real service.
    """
    from .order_semantics import sniff_xlsx_bytes, workbook_parse_candidate

    filename, raw = _decode_file(payload["file"])
    fixture = payload.get("_fixture_document")
    parsed_source: dict[str, Any] = {}
    parser_meta: dict[str, Any] = {}
    # 只按字节结构 + 表头/价格证据决定是否本地确定性解析 XLSX/XLSM，不依赖
    # 文件名/路径/租户；解析器给出的证据（parser 版本、sheet/行/列坐标、
    # 原值/归一化值、缺失字段）原样带出；非订单表格（库存/设备/无证据）仍失败关闭。
    candidate = workbook_parse_candidate(filename, raw)
    if candidate is not None:
        parsed_source = candidate.get("document") or {}
        parser_meta = {
            "name": str(candidate.get("parser_name") or "order.parser.v2"),
            "version": str(candidate.get("parser_version") or "order.parser.v2"),
            "revision": str(candidate.get("parser_version") or "order.parser.v2"),
        }
    elif sniff_xlsx_bytes(raw):
        # v2 无订单证据时，老式坐标模板（P6/X7/第 10 行起等固定布局）由坐标解析
        # 兜底——同样只按内容，不伪造事实；无任何事实则失败关闭。
        try:
            from .order_workbook import parse_order_workbook

            legacy = parse_order_workbook(filename, raw)
            if legacy.get("order_id") or legacy.get("lines"):
                parsed_source = legacy
                parser_meta = {
                    "name": "order.workbook.coordinates.v1",
                    "version": "order.workbook.coordinates.v1",
                    "revision": "order.workbook.coordinates.v1",
                }
        except Exception:
            parsed_source = {}
    if not parsed_source and isinstance(fixture, dict) and fixture:
        parsed_source = fixture
    if not parsed_source:
        parsed_source = _json_content(raw)
    if not parsed_source:
        return {
            "task_id": f"m1-{ctx['task_id'][-10:]}",
            "status": "failed",
            "code": "LOCAL_FIXTURE_UNSUPPORTED_FORMAT",
            "message": "本地 fixture handler 无法解析该文件（仅支持 JSON、预解析结构或含订单结构证据的 XLSX/XLSM；不冒充完整 M1 多格式解析）。生产解析请通过 M1_URL 调用真实 M1 服务。",
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
    order_prefix = str(parsed_source.get("order_id") or "order")

    def _stable_line_id(line: dict[str, Any], index: int) -> str:
        existing = line.get("line_id")
        if isinstance(existing, str) and existing.strip():
            return existing.strip()
        sheet = line.get("sheet")
        row = line.get("row")
        if sheet is not None and row is not None:
            return f"{order_prefix}::{sheet}!R{row}"
        return f"{order_prefix}::L{index:02d}"

    normalized_lines: list[dict[str, Any]] = []
    for index, line in enumerate(lines, start=1):
        if not isinstance(line, dict):
            continue
        normalized = dict(line)
        normalized["line_id"] = _stable_line_id(normalized, index)
        # 契约需要的 display 字段：model/name_raw 与 product_code/name 对齐，
        # 保持缺失为 None，不伪造编码。
        if "model" not in normalized:
            normalized["model"] = normalized.get("product_code")
        if "name_raw" not in normalized and normalized.get("product_name") is not None:
            normalized["name_raw"] = normalized.get("product_name")
        normalized_lines.append(normalized)
    lines = normalized_lines
    totals: dict[str, Any] = {}
    total_quantity = parsed_source.get("total_quantity")
    if total_quantity is None:
        total_quantity = parsed_source.get("quantity")
    if total_quantity is not None:
        totals["quantity"] = total_quantity
    if parsed_source.get("total_amount") is not None:
        totals["amount"] = parsed_source.get("total_amount")
    document = {
        "schema_version": "m1.document.v2",
        "source": {"original_filename": filename, "sha256": sha256(raw).hexdigest()},
        "document_type": "order", "document_subtype": "customer_order",
        "header": header, "lines": lines, "totals": totals, "field_meta": {},
        "validation_issues": [*source_issues, *({"code": "MISSING_FIELD", "message": f"缺少字段: {key}", "paths": [f"$.header.{key}"]} for key in missing)],
    }
    field_evidence = parsed_source.get("field_evidence")
    if isinstance(field_evidence, list) and field_evidence:
        document["field_evidence"] = field_evidence
    sheet_docs = parsed_source.get("sheet_docs")
    if isinstance(sheet_docs, list) and sheet_docs:
        document["sheet_docs"] = sheet_docs
    if parser_meta:
        document["parser_name"] = parser_meta["name"]
        document["parser_version"] = parser_meta["version"]
    validation_issues = document["validation_issues"]
    needs_review = confidence < 0.8 or bool(validation_issues)
    parser_detail = "order_semantics/" + parser_meta["version"] if parser_meta else "fixture"
    return {
        "task_id": f"m1-{ctx['task_id'][-10:]}", "status": "needs_review" if needs_review else "done",
        "processing_stage": "review" if needs_review else "complete",
        "schema_version": "m1.document.v2", "document_schema_version": "m1.document.v2",
        "document_subtype": "customer_order", "needs_review": needs_review,
        "overall_confidence": confidence, "document": document,
        "extraction": {"order": header, "lines": lines},
        "order": header, "lines": lines, "missing": missing,
        "parser": parser_meta or None,
        "provider": "local_fixture",
        "fixture": True,
        "evidence": [_evidence("m1", filename, f"m1.document.v2 字段证据（本地 fixture {parser_detail}，非生产解析）")],
    }


async def m2_bom(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    from .m2_fact_validation import validate_engineering_facts

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
    fact_validation = validate_engineering_facts(
        product_code=profile.get("product_code"),
        bom_lines=lines,
        bom_version=payload.get("bom_version") or "draft-1",
        bom_effective_from=payload.get("bom_effective_from"),
        bom_effective_to=payload.get("bom_effective_to"),
        route_steps=routing_steps,
        sop_version=payload.get("sop_version"),
        sop_effective_from=payload.get("sop_effective_from"),
        sop_effective_to=payload.get("sop_effective_to"),
    )
    return {
        "status": "draft_created", "run_id": f"m2-{ctx['task_id'][-10:]}",
        "workflow_sequence": ["parse_sources", "history_search", "match_bom_sop", "bom_generate", "sop_generate"],
        "bom_generation": {"product_code": profile["product_code"], "bom_version": "draft-1", "bom_lines": lines, "assumptions": [], "duplicate_material_codes": duplicate_codes, "evidence": [_evidence("m2", "bom_lines", "受控 BOM 输入")]},
        "sop_generation": {"status": "draft", "operation_count": len(routing_steps or lines), "source_files": payload.get("sop_files") or []},
        "engineering_fact_validation": fact_validation,
        "matching": matching,
        "open_customer_questions": [
            {"field": item["field"], "question": f"请补充工程事实：{item['field']}"}
            for item in fact_validation["missing_fields"]
        ], "artifacts": {},
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
    # The legacy branch remains available only for explicitly preview/sandbox
    # marked requests; production requests without v2 facts fail closed.
    purpose = str(payload.get("scenario_purpose") or "production")
    v2_marked = bool(
        payload.get("pmc_v2") or payload.get("pmc_v2_bundle") or payload.get("calendar_windows")
        or any(isinstance(step, dict) and (step.get("standard_minutes") is not None or step.get("std_minutes") is not None)
               for step in payload.get("routing_steps", []))
    )
    legacy_preview = bool(payload.get("legacy_preview")) or str(purpose).lower() in {"preview", "sandbox"}
    if not v2_marked and payload.get("orders") and not payload.get("routing_steps"):
        return {
            "success": False, "code": "BLOCKED_INPUT", "errors": [{"code": "MISSING_SOP", "message": "缺少可执行的 SOP/工艺路线", "details": []}],
            "data": {
                "idempotency_key": str(payload.get("idempotency_key") or ""),
                "schedule": {"scenario_purpose": purpose, "operations": [], "metrics": {"makespan_minutes": 0, "operation_count": 0}},
                "scenario_purpose": purpose, "lifecycle_status": "draft", "input_hash": "",
                "parent_plan_version": payload.get("expected_head_plan_version"), "tracking_task_id": ctx.get("task_id"),
            },
            "evidence": [_evidence("m5", "routing_steps", "未提供 SOP/工艺路线，停止排程")], "trace_id": _trace(ctx, "m5"),
        }
    if v2_marked:
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
            persisted = _persist_v2_draft(result, payload, ctx)
            if persisted is not None:
                return persisted
            return result
        except PmcError as exc:
            return {"success": False, "code": exc.code, "errors": [{"code": exc.code, "message": exc.message, "details": []}], "data": {"idempotency_key": payload.get("idempotency_key", ""), "schedule": {"scenario_purpose": purpose, "operations": [], "metrics": {"operation_count": 0, "makespan_minutes": 0}, "algorithm_version": "pmc-v2-frozen-20260902"}, "scenario_purpose": purpose, "lifecycle_status": "draft", "input_hash": "", "algorithm_version": "pmc-v2-frozen-20260902", "parent_plan_version": payload.get("expected_head_plan_version"), "tracking_task_id": ctx.get("task_id")}, "trace_id": _trace(ctx, "m5-pmc-v2-blocked"), "evidence": [_evidence("m5", "pmc_v2", exc.message)]}
    if not legacy_preview:
        # Production requests must go through PMC v2.  Without an explicit
        # preview/sandbox marker the legacy branch must not run.
        return {
            "success": False, "code": "BLOCKED_INPUT",
            "errors": [{"code": "LEGACY_PRODUCTION_BLOCKED", "message": "production 请求必须携带 v2 事实并进入 PMC v2；legacy 分支只能显式标记为 preview/sandbox", "details": []}],
            "data": {
                "idempotency_key": str(payload.get("idempotency_key") or ""),
                "schedule": {"scenario_purpose": "production", "operations": [], "metrics": {"makespan_minutes": 0, "operation_count": 0}},
                "scenario_purpose": "production", "lifecycle_status": "draft", "input_hash": "",
                "parent_plan_version": payload.get("expected_head_plan_version"), "tracking_task_id": ctx.get("task_id"),
            },
            "evidence": [_evidence("m5", "legacy", "production 请求不得进入 legacy 分支")], "trace_id": _trace(ctx, "m5"),
        }
    resources = {str(item["resource_id"]): item for item in payload["resources"]}
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


def _persist_v2_draft(result: dict[str, Any], payload: dict[str, Any],
                      ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Task 2: when an M5 repository is configured, persist the six snapshot
    kinds and a draft plan with idempotent replay / same-key conflict rules.

    Enabled only when ``ctx["m5_db_path"]`` or the ``YUNPAI_M5_DB`` env var is
    set, so the default stateless registry path is unchanged.  Returns the
    final handler response when the repository path is enabled (including a
    replayed or conflicted response), otherwise ``None``.
    """
    db_path = (ctx or {}).get("m5_db_path") or os.getenv("YUNPAI_M5_DB")
    if not db_path:
        return None
    from .m5_repository import M5Repository, M5RepositoryError
    scenario_id = str(payload.get("scenario_id") or "")
    idem = str(payload.get("idempotency_key") or "")
    data = result.get("data") or {}
    digest = str(data.get("input_hash") or "")
    bundle = data.get("input_package")
    if not scenario_id or not bundle or not digest:
        return None
    repo = M5Repository(db_path)
    purpose = str(data.get("scenario_purpose") or "production")
    version = f"plan-{scenario_id}-{digest[:10]}"
    try:
        existing = repo.find_by_idempotency(scenario_id, idem) if idem else None
        if existing is not None:
            stored = repo.get_plan(existing["plan_version"])
            if stored is not None and existing["input_hash"] == digest:
                schedule = stored.get("schedule") or {}
                replayed_data = {
                    "idempotency_key": idem,
                    "schedule": schedule,
                    "scenario_purpose": stored.get("scenario_purpose", purpose),
                    "lifecycle_status": stored.get("lifecycle_status", "draft"),
                    "input_hash": stored.get("input_hash", digest),
                    "plan_version": stored["plan_version"],
                    "parent_plan_version": stored.get("parent_plan_version"),
                    "tracking_task_id": ctx.get("task_id"),
                    "replayed": True,
                }
                return {"success": True, "data": replayed_data, "errors": [],
                        "trace_id": _trace(ctx, "m5-pmc-v2-replay"),
                        "evidence": [_evidence("m5", "pmc_v2", "idempotent replay of stored draft")]}
            # same idempotency key, different input -> conflict (Task 2)
            return {
                "success": False, "code": "BLOCKED_INPUT",
                "errors": [{"code": "IDEMPOTENCY_CONFLICT",
                            "message": f"同幂等键 {idem} 已用于不同输入（scenario {scenario_id}）",
                            "details": [{"stored_hash": existing["input_hash"], "new_hash": digest}]}],
                "data": {
                    "idempotency_key": idem,
                    "schedule": {"scenario_purpose": purpose, "operations": [], "metrics": {"operation_count": 0, "makespan_minutes": 0}},
                    "scenario_purpose": purpose, "lifecycle_status": "draft",
                    "input_hash": digest, "parent_plan_version": payload.get("expected_head_plan_version"),
                    "tracking_task_id": ctx.get("task_id"), "replayed": False,
                },
                "trace_id": _trace(ctx, "m5-pmc-v2-conflict"),
                "evidence": [_evidence("m5", "pmc_v2", "idempotency conflict")],
            }
        repo.store_snapshots(scenario_id, bundle, tenant_id=str(ctx.get("tenant_id") or "default"),
                             task_id=str(ctx.get("task_id") or ""))
        repo.save_plan(
            plan_version=version, scenario_id=scenario_id,
            tenant_id=str(ctx.get("tenant_id") or "default"), task_id=str(ctx.get("task_id") or ""),
            lifecycle_status="draft", parent_plan_version=payload.get("expected_head_plan_version"),
            input_hash=digest, solver_hash=f"solver-{data.get('algorithm_version', 'pmc-v2')}",
            algorithm_version=data.get("algorithm_version", "pmc-v2-frozen-20260902"),
            scenario_purpose=purpose, validation_report=data.get("validator") or {},
            bundle=bundle, schedule=data.get("schedule") or {},
            idempotency_key=idem or None,
        )
        data["plan_version"] = version
        schedule = data.setdefault("schedule", {})
        schedule["plan_version"] = version
        return None
    except M5RepositoryError as exc:
        return {
            "success": False, "code": "BLOCKED_INPUT",
            "errors": [{"code": exc.code, "message": exc.message, "details": []}],
            "data": {
                "idempotency_key": idem,
                "schedule": {"scenario_purpose": purpose, "operations": [], "metrics": {"operation_count": 0, "makespan_minutes": 0}},
                "scenario_purpose": purpose, "lifecycle_status": "draft",
                "input_hash": digest, "parent_plan_version": payload.get("expected_head_plan_version"),
                "tracking_task_id": ctx.get("task_id"), "replayed": False,
            },
            "trace_id": _trace(ctx, "m5-pmc-v2-persist-blocked"),
            "evidence": [_evidence("m5", "pmc_v2", exc.message)],
        }


def _m5(name: str):
    """Lazily import the local M5 PMC handler for a manifest tool name."""
    from .m5_tools import M5_HANDLERS
    return M5_HANDLERS[name]


async def sample_file(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """确定性采样：把文件压成 LLM 可看的表头 + 前 N 行样本，不伪造内容。"""
    from .recognized_store import sample_file as _sample

    encoded = str(payload.get("content_b64") or "")
    filename = str(payload.get("filename") or "document.bin")
    if not encoded:
        return {"success": False, "code": "MISSING_FILE",
                "errors": [{"code": "MISSING_FILE", "message": "缺少 content_b64", "details": []}],
                "data": {}, "trace_id": _trace(ctx, "sample_file")}
    try:
        raw = base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        return {"success": False, "code": "INVALID_BASE64",
                "errors": [{"code": "INVALID_BASE64", "message": str(exc), "details": []}],
                "data": {}, "trace_id": _trace(ctx, "sample_file")}
    sample = _sample(raw, filename, max_rows=int(payload.get("max_rows") or 10))
    return {"success": True, "data": sample, "errors": [],
            "trace_id": _trace(ctx, "sample_file"),
            "evidence": [_evidence("catalog", "sample_file", f"sampled {filename} ({sample['sniff']['detected_format']})")]}


async def ingest_recognized(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """确定性落库：schema 校验 + PII 脱敏 + 自描述表存储 + sha256 幂等。"""
    from .recognized_store import RecognizedTableStore

    kind = str(payload.get("kind") or "")
    filename = str(payload.get("filename") or "")
    sha256 = str(payload.get("sha256") or "")
    columns = payload.get("columns") or []
    rows = payload.get("rows") or []
    confidence = float(payload.get("confidence") or 0.0)
    redact = bool(payload.get("redact", True))
    if not (kind and filename and sha256):
        return {"success": False, "code": "MISSING_REQUIRED",
                "errors": [{"code": "MISSING_REQUIRED", "message": "kind/filename/sha256 必填", "details": []}],
                "data": {}, "trace_id": _trace(ctx, "ingest_recognized")}
    if not isinstance(columns, list) or not all(isinstance(c, str) for c in columns):
        return {"success": False, "code": "INVALID_COLUMNS",
                "errors": [{"code": "INVALID_COLUMNS", "message": "columns 必须为字符串数组", "details": []}],
                "data": {}, "trace_id": _trace(ctx, "ingest_recognized")}
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        return {"success": False, "code": "INVALID_ROWS",
                "errors": [{"code": "INVALID_ROWS", "message": "rows 必须为对象数组", "details": []}],
                "data": {}, "trace_id": _trace(ctx, "ingest_recognized")}
    store = RecognizedTableStore(ctx.get("recognized_db"))
    try:
        result = store.ingest(kind=kind, filename=filename, sha256=sha256,
                              columns=list(columns), rows=rows, confidence=confidence,
                              redact=redact, tenant_id=str(ctx.get("tenant_id") or "default"))
    except ValueError as exc:
        return {"success": False, "code": "INVALID_KIND",
                "errors": [{"code": "INVALID_KIND", "message": str(exc), "details": []}],
                "data": {}, "trace_id": _trace(ctx, "ingest_recognized")}
    return {"success": True, "data": result, "errors": [],
            "trace_id": _trace(ctx, "ingest_recognized"),
            "evidence": [_evidence("catalog", "ingest_recognized", f"{kind} rows={result['inserted_rows']} dup={result['duplicate']}")]}


async def query_recognized_table(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """agent 读回：对已落库的自描述表做过滤/聚合。"""
    from .recognized_store import RecognizedTableStore

    store = RecognizedTableStore(ctx.get("recognized_db"))
    rows = store.query(
        kind=payload.get("kind"),
        filters=payload.get("filters"),
        aggregate=payload.get("aggregate"),
        limit=int(payload.get("limit") or 200),
        tenant_id=str(ctx.get("tenant_id") or "default"),
    )
    return {"success": True, "data": {"rows": rows, "count": len(rows)}, "errors": [],
            "trace_id": _trace(ctx, "query_recognized_table"),
            "evidence": [_evidence("catalog", "query_recognized_table", f"returned {len(rows)} rows")]}


async def ingest_canonical(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """确定性落库：agent 映射后的 canonical 记录，schema 校验 + PII + sha256 幂等。

    生产 transport（配置了 M0_URL）时，校验通过后经 M0 canonical 发布
    （validate + publish + 回读核验）；本地/单元测试无 M0_URL 时只写 sandbox SQLite。
    """
    import os

    from .canonical_ingest import CanonicalLandingStore, to_m0_records

    entity_type = str(payload.get("entity_type") or "")
    filename = str(payload.get("filename") or "")
    sha256 = str(payload.get("sha256") or "")
    records = payload.get("records")
    confidence = float(payload.get("confidence") or 0.0)
    if not entity_type or not isinstance(records, list):
        return {"success": False, "code": "MISSING_REQUIRED",
                "errors": [{"code": "MISSING_REQUIRED", "message": "entity_type/records 必填", "details": []}],
                "data": {}, "trace_id": _trace(ctx, "ingest_canonical")}
    store = CanonicalLandingStore(ctx.get("canonical_db"))
    result = store.ingest(entity_type=entity_type, records=records, filename=filename,
                          sha256=sha256, confidence=confidence,
                          tenant_id=str(ctx.get("tenant_id") or "default"))
    m0_publication: dict[str, Any] | None = None
    if result.get("success") and os.getenv("M0_URL"):
        try:
            from .m0_catalog import publish_records

            m0_records = to_m0_records(
                entity_type, result.get("data", {}).get("clean_records") or [],
                filename=filename, sha256=sha256,
                tenant_id=str(ctx.get("tenant_id") or "default"),
                actor=str(ctx.get("actor") or "operator"),
            )
            m0_publication = publish_records(
                m0_records,
                tenant_id=str(ctx.get("tenant_id") or "default"),
                task_id=str(ctx.get("task_id") or "task"),
                actor=str(ctx.get("actor") or "operator"),
            )
        except Exception as exc:  # noqa: BLE001 - M0 不可达不阻断本地落库，如实上报
            m0_publication = {"status": "failed", "published": 0, "error": str(exc)}
    return {**result,
            "m0_publication": m0_publication,
            "trace_id": _trace(ctx, "ingest_canonical"),
            "evidence": [_evidence("catalog", "ingest_canonical", f"{entity_type} rows={result['data'].get('inserted_rows')} dup={result['data'].get('duplicate')}")]}


# ---------------------------------------------------------------------------
# 身份/账号（对话建账号：厂长在会话里给员工开账号、分配组织与角色）
# 权限闸在 ToolRegistry.call 统一执行（映射 identity.admin，见 tool_permissions.py）。
# ---------------------------------------------------------------------------

_USER_ID_RE = __import__("re").compile(r"^[A-Za-z0-9_.@-]{3,64}$")


def _identity_store() -> Any:
    from .identity import IdentityStore

    return IdentityStore(os.getenv("YUNPAI_IDENTITY_DB", "runtime/yunpai-identity.sqlite"))


def _identity_tenant(payload: dict[str, Any], ctx: dict[str, Any]) -> str:
    return str(payload.get("tenant_id") or ctx.get("tenant_id") or "default")


def _resolve_org_id(store: Any, tenant: str, payload: dict[str, Any]) -> str | None:
    """org_id 优先；否则按 org_name 在组织树里精确/包含匹配（对话里用户只报班组名）。"""
    org_id = str(payload.get("org_id") or "").strip()
    if org_id:
        return org_id
    name = str(payload.get("org_name") or "").strip()
    if not name:
        return None
    nodes = store.org_tree(tenant_id=tenant)
    for node in nodes:
        if str(node.get("name") or "") == name:
            return str(node["org_id"])
    for node in nodes:
        if name in str(node.get("name") or ""):
            return str(node["org_id"])
    raise _tool_error("identity", "ORG_NOT_FOUND",
                      f"组织节点不存在: {name}（可先用「组织架构」页新建，或直接给 org_id）")


def _org_name_for(store: Any, tenant: str, org_id: str | None) -> str | None:
    if not org_id:
        return None
    for node in store.org_tree(tenant_id=tenant):
        if str(node.get("org_id") or "") == str(org_id):
            return str(node.get("name") or "")
    return None


def _tool_error(tool: str, code: str, message: str) -> Any:
    from .registry import ToolHTTPError

    return ToolHTTPError(tool, code, message)


async def list_identity_users(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """本租户账号列表（可按组织/角色过滤）。"""
    store = _identity_store()
    tenant = _identity_tenant(payload, ctx)
    users = store.list_users(tenant_id=tenant)
    org_id = str(payload.get("org_id") or "").strip()
    role = str(payload.get("role") or payload.get("role_code") or "").strip()
    if org_id:
        users = [item for item in users if str(item.get("org_id") or "") == org_id]
    if role:
        users = [item for item in users if role in list(item.get("role_codes") or [])]
    limit = max(1, int(payload.get("limit") or 50))
    users = users[:limit]
    return {
        "tenant_id": tenant,
        "total": len(users),
        "users": users,
        "trace_id": _trace(ctx, "list_identity_users"),
        "evidence": [_evidence("identity", f"users:{tenant}", f"count={len(users)} org={org_id or '-'} role={role or '-'}")],
    }


def _next_user_ids(store: Any, tenant: str, prefix: str, count: int) -> list[str]:
    """按前缀生成不冲突的账号：worker001、worker002…（跳过已占用的）。"""
    used = {str(item.get("user_id") or "") for item in store.list_users(tenant_id=tenant)}
    ids: list[str] = []
    index = 1
    while len(ids) < count:
        candidate = f"{prefix}{index:03d}"
        index += 1
        if candidate in used or candidate in ids:
            continue
        ids.append(candidate)
    return ids


#: 角色英文/口语别名 → 角色 code（大小写不敏感）。
#: **只做归一化，不是意图词表**：不参与路由，也不改变工具选择逻辑。
_ROLE_ALIASES: dict[str, tuple[str, ...]] = {
    "quality-assurance": ("qa", "qc", "quality", "quality assurance", "qa/qc",
                          "品保", "质检", "品控", "品保监督"),
    "team-leader": ("leader", "team lead", "foreman", "组长", "班长"),
    "worker": ("worker", "操作工", "工人", "员工", "装配工"),
    "planner": ("planner", "计划员", "计划"),
    "engineer": ("engineer", "工程师", "工程"),
    "data-steward": ("steward", "data steward", "主数据", "资料员"),
    "release-manager": ("release", "release manager", "发布负责人"),
    "org-admin": ("admin", "org admin", "组织管理员", "管理员"),
    "factory-director": ("director", "factory director", "厂长"),
}

#: 别名索引（小写 → code）。模型常把「品保」写成 qa/qc，直接失败太脆。
_ROLE_ALIAS_INDEX: dict[str, str] = {
    alias.strip().lower(): code
    for code, aliases in _ROLE_ALIASES.items()
    for alias in aliases
    if alias.strip()
}


def _normalize_roles(store: Any, tenant: str, roles: Any) -> list[str]:
    """把角色值规整成角色 code：模型/用户说「组长」「qa」也要落到 team-leader / quality-assurance。

    匹配顺序（合法 code 不被改写）：
    1. 租户角色表的 ``role_code``（大小写不敏感）；
    2. 英文/口语别名表（大小写不敏感，见 ``_ROLE_ALIASES``）；
    3. 租户角色表的中文名（精确）；
    4. 「唯一包含」匹配（例如「品保」→「品保监督」）；
    5. 都匹配不上 → 原样返回，交给下游报「未注册角色」。
    """
    values = [str(role).strip() for role in (roles or []) if str(role).strip()]
    if not values:
        return []
    try:
        catalog = store.list_roles(tenant_id=tenant)
    except Exception:
        return values
    by_code = {str(item.get("role_code")): str(item.get("role_code")) for item in catalog}
    by_code_lower = {code.lower(): code for code in by_code}
    by_name = {str(item.get("name")): str(item.get("role_code"))
               for item in catalog if str(item.get("name") or "").strip()}
    resolved: list[str] = []
    for token in values:
        lowered = token.lower()
        if token in by_code:
            resolved.append(token)
            continue
        if lowered in by_code_lower:
            resolved.append(by_code_lower[lowered])
            continue
        alias = _ROLE_ALIAS_INDEX.get(lowered)
        if alias:
            resolved.append(alias)
            continue
        if token in by_name:
            resolved.append(by_name[token])
            continue
        candidates = {code for name, code in by_name.items() if name in token or token in name}
        resolved.append(candidates.pop() if len(candidates) == 1 else token)
    return resolved


def _create_one(store: Any, tenant: str, *, user_id: str, display_name: str,
                role_codes: list[str], org_id: str | None, skill: Any,
                password: str | None) -> dict[str, Any]:
    from .auth import generate_password, hash_password

    if not _USER_ID_RE.match(user_id):
        raise _tool_error("create_identity_user", "INVALID_USER_ID",
                          f"账号只允许字母/数字/_ . @ -，长度 3~64：{user_id}")
    if store.get_user(tenant_id=tenant, user_id=user_id):
        raise _tool_error("create_identity_user", "USER_EXISTS", f"账号已存在: {user_id}")
    initial = str(password or "") or generate_password()
    if len(initial) < 8:
        raise _tool_error("create_identity_user", "WEAK_PASSWORD", "初始密码至少 8 位")
    try:
        store.create_user(tenant_id=tenant, user_id=user_id,
                          password_hash=hash_password(initial),
                          display_name=display_name or user_id,
                          org_id=org_id, status="active", must_change_password=1)
        store.bind_user(tenant_id=tenant, user_id=user_id, role_codes=role_codes,
                        org_id=org_id, skill=skill)
    except ValueError as exc:
        raise _tool_error("create_identity_user", "INVALID_USER", str(exc)) from exc
    return {"user_id": user_id, "display_name": display_name or user_id,
            "org_id": org_id, "org_name": _org_name_for(store, tenant, org_id),
            "role_codes": role_codes, "skill": skill,
            "initial_password": initial}


async def create_identity_user(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """建账号 + 绑角色/组织（支持单个与批量）；初始密码只回显一次，首登强制改密。

    单个：``{user_id, display_name, role_codes, org_name}``
    批量：``{people:[{display_name, user_id?, role_codes?, org_name?}...], user_id_prefix}``
    """
    store = _identity_store()
    tenant = _identity_tenant(payload, ctx)
    default_roles = _normalize_roles(store, tenant, payload.get("role_codes")) or ["worker"]
    default_org = _resolve_org_id(store, tenant, payload)
    default_skill = payload.get("skill")

    people = payload.get("people")
    if isinstance(people, list) and people:
        entries: list[dict[str, Any]] = [item for item in people if isinstance(item, dict)]
        if not entries:
            raise _tool_error("create_identity_user", "INVALID_PEOPLE", "people 必须是对象数组")
        prefix = str(payload.get("user_id_prefix") or "worker").strip() or "worker"
        generated = iter(_next_user_ids(store, tenant, prefix, len(entries)))
        created: list[dict[str, Any]] = []
        for entry in entries:
            user_id = str(entry.get("user_id") or "").strip() or next(generated)
            roles = _normalize_roles(store, tenant, entry.get("role_codes")) or default_roles
            org_id = _resolve_org_id(store, tenant, entry) if (entry.get("org_id") or entry.get("org_name")) else default_org
            created.append(_create_one(
                store, tenant, user_id=user_id,
                display_name=str(entry.get("display_name") or "").strip() or user_id,
                role_codes=roles, org_id=org_id,
                skill=entry.get("skill") or default_skill, password=None))
        return {
            "tenant_id": tenant,
            "count": len(created),
            "created": created,
            "role_codes": default_roles,
            "org_id": default_org,
            "password_returned_once": True,
            "must_change_password": True,
            "trace_id": _trace(ctx, "create_identity_user"),
            "evidence": [_evidence("identity", f"users:{tenant}",
                                   f"created={len(created)} role={','.join(default_roles)}")],
        }

    user_id = str(payload.get("user_id") or "").strip()
    display_name = str(payload.get("display_name") or "").strip()
    if not user_id and display_name:
        _, existing = _resolve_user_id_by_name(store, tenant, display_name)
        if existing:
            who = existing[0]
            raise _tool_error(
                "create_identity_user", "NAME_EXISTS",
                f"「{display_name}」已经有账号 {who.get('user_id')}（角色：{','.join(str(r) for r in (who.get('role_codes') or ['工人']))}）。"
                f"不用重复建号；如果是要给他加角色，可以说「给 {who.get('user_id')} 加上品保角色」。")
        user_id = next(iter(_next_user_ids(
            store, tenant, str(payload.get("user_id_prefix") or "worker").strip() or "worker", 1)))
    if not user_id:
        raise _tool_error("create_identity_user", "MISSING_USER_ID",
                          "需要给出账号（user_id）或姓名（display_name），多人请用 people 数组")
    created = _create_one(store, tenant, user_id=user_id, display_name=display_name or user_id,
                          role_codes=default_roles, org_id=default_org,
                          skill=default_skill, password=payload.get("password"))
    return {
        "tenant_id": tenant,
        "count": 1,
        "created": [created],
        "user_id": created["user_id"],
        "display_name": created["display_name"],
        "org_id": created["org_id"],
        "role_codes": created["role_codes"],
        "skill": created["skill"],
        "initial_password": created["initial_password"],
        "password_returned_once": True,
        "must_change_password": True,
        "trace_id": _trace(ctx, "create_identity_user"),
        "evidence": [_evidence("identity", created["user_id"],
                               f"created role={','.join(default_roles)} org={default_org or '-'}")],
    }


def _resolve_user_id_by_name(store: Any, tenant: str, name: str) -> tuple[str | None, list[dict[str, Any]]]:
    """按 display_name 精确匹配账号。返回 (唯一 user_id 或 None, 全部匹配)。"""
    target = str(name or "").strip()
    if not target:
        return None, []
    matches = [u for u in store.list_users(tenant_id=tenant)
               if str(u.get("display_name") or "").strip() == target]
    ids = [str(u.get("user_id")) for u in matches if str(u.get("user_id") or "").strip()]
    return (ids[0] if len(ids) == 1 else None), matches


async def assign_identity_account(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """给已有账号调组织/角色（分配账号、换岗、加角色）。"""
    store = _identity_store()
    tenant = _identity_tenant(payload, ctx)
    user_id = str(payload.get("user_id") or "").strip()
    if not user_id and (payload.get("display_name") or payload.get("name")):
        match, matches = _resolve_user_id_by_name(
            store, tenant, str(payload.get("display_name") or payload.get("name") or ""))
        if len(matches) > 1:
            who = "、".join(f"{u.get('user_id')}（{u.get('display_name')}）" for u in matches)
            raise _tool_error("assign_identity_account", "AMBIGUOUS_USER_NAME",
                              f"有 {len(matches)} 个叫「{payload.get('display_name')}」的账号：{who}。请指定账号，例如「给 worker001 调整」")
        user_id = match or ""
    user = store.get_user(tenant_id=tenant, user_id=user_id)
    if not user and user_id:
        # 模型常把**姓名**填进 user_id（「把张伟分到1班组」）→ 按姓名唯一匹配回账号
        match, matches = _resolve_user_id_by_name(store, tenant, user_id)
        if len(matches) > 1:
            who = "、".join(f"{u.get('user_id')}（{u.get('display_name')}）" for u in matches)
            raise _tool_error("assign_identity_account", "AMBIGUOUS_USER_NAME",
                              f"有 {len(matches)} 个叫「{user_id}」的账号：{who}。请指定账号，例如「给 worker001 调整」")
        if match:
            user_id = match
            user = store.get_user(tenant_id=tenant, user_id=user_id)
    if not user:
        raise _tool_error("assign_identity_account", "USER_NOT_FOUND",
                          f"账号不存在: {user_id}（如果是新员工，可以说「给{payload.get('display_name') or '他'}建一个账号」）")
    bindings = store.list_bindings(tenant_id=tenant, user_id=user_id)
    current = bindings[0] if bindings else {}
    raw_roles = payload.get("role_codes")
    if isinstance(raw_roles, list) and raw_roles:
        role_codes = _normalize_roles(store, tenant, raw_roles)
        if str(payload.get("role_mode") or "set").strip().lower() == "add":
            # 「加上/再加」→ 在原角色上追加（去重保序）
            merged = list(current.get("role_codes") or []) + role_codes
            role_codes = list(dict.fromkeys(str(role) for role in merged if str(role).strip()))
    else:
        role_codes = list(current.get("role_codes") or []) or ["worker"]
    if payload.get("org_id") or payload.get("org_name"):
        org_id = _resolve_org_id(store, tenant, payload)
    else:
        # 只改角色、没提组织 → 保留原组织（否则「让他当组长」会把班组清空）
        org_id = current.get("org_id")
    try:
        binding = store.bind_user(tenant_id=tenant, user_id=user_id, role_codes=role_codes,
                                  org_id=org_id, skill=payload.get("skill"))
    except ValueError as exc:
        raise _tool_error("assign_identity_account", "INVALID_BINDING", str(exc)) from exc
    return {
        "tenant_id": tenant,
        "user_id": user_id,
        "display_name": user.get("display_name"),
        "org_id": org_id,
        "org_name": _org_name_for(store, tenant, org_id),
        "role_codes": role_codes,
        "binding": binding,
        "trace_id": _trace(ctx, "assign_identity_account"),
        "evidence": [_evidence("identity", user_id,
                               f"assigned role={','.join(role_codes)} org={org_id or '-'}")],
    }


# ---------------------------------------------------------------------------
# 组织节点（对话建公司/部门/班组；同名同父复用，不重复建）
# ---------------------------------------------------------------------------

_ORG_TYPE_PREFIX = {"company": "company", "dept": "dept", "team": "team"}


def _org_type_from_name(name: str) -> str:
    """按名称推断节点类型：含公司/厂 → company；含部 → dept；含班组/组/线/车间 → team。"""
    if any(token in name for token in ("公司", "厂")):
        return "company"
    if "部" in name:
        return "dept"
    if any(token in name for token in ("班组", "组", "线", "车间")):
        return "team"
    return "team"


def _org_slug(name: str, org_type: str, taken: set[str]) -> str:
    """生成稳定且不冲突的 org_id：``team-1``/``dept-3f2a1b`` 这类 slug。

    名称里的 ASCII 字母数字直接保留（「1班组」→ ``team-1``）；纯中文名用名称的
    短摘要（稳定：同一名称永远同一后缀），与既有节点冲突时再加序号。
    """
    ascii_part = "".join(
        ch for ch in name.lower() if ch.isascii() and (ch.isalnum() or ch in "-_")
    ).strip("-_")
    if not ascii_part:
        ascii_part = sha256(name.encode("utf-8")).hexdigest()[:6]
    prefix = _ORG_TYPE_PREFIX.get(org_type, "org")
    base = f"{prefix}-{ascii_part}"[:60]
    slug = base
    index = 2
    while slug in taken:
        slug = f"{base}-{index}"[:64]
        index += 1
    return slug


def _resolve_parent_id(payload: dict[str, Any], nodes: list[dict[str, Any]]) -> str | None:
    """父节点：parent_id 优先（必须是已有节点）；否则按 parent_name 精确/唯一包含匹配。"""
    raw_id = str(payload.get("parent_id") or "").strip()
    if raw_id:
        if not any(str(node.get("org_id") or "") == raw_id for node in nodes):
            raise _tool_error("create_org_node", "ORG_PARENT_NOT_FOUND", f"父组织不存在: {raw_id}")
        return raw_id
    parent_name = str(payload.get("parent_name") or "").strip()
    if not parent_name:
        return None
    for node in nodes:
        if str(node.get("name") or "") == parent_name:
            return str(node["org_id"])
    matched = {str(node["org_id"]) for node in nodes if parent_name in str(node.get("name") or "")}
    if len(matched) == 1:
        return matched.pop()
    raise _tool_error("create_org_node", "ORG_PARENT_NOT_FOUND",
                      f"父组织不存在: {parent_name}（可先在「管理 → 组织架构」新建，或直接给 parent_id）")


def _org_payload(store: Any, tenant: str, node: dict[str, Any], *, created: bool) -> dict[str, Any]:
    org_id = str(node.get("org_id") or "")
    path = store.org_path(tenant_id=tenant, org_id=org_id)
    names = {str(item.get("org_id") or ""): str(item.get("name") or "")
             for item in store.org_tree(tenant_id=tenant)}
    return {
        "tenant_id": tenant,
        "org_id": org_id,
        "name": str(node.get("name") or ""),
        "org_type": str(node.get("org_type") or ""),
        "parent_id": node.get("parent_id") or None,
        "org_path": path,
        "org_path_names": [names.get(item, item) for item in path],
        "created": created,
        "reused": not created,
    }


async def create_org_node(payload: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    """新建组织节点（公司/部门/班组），并挂到父节点下。

    - ``name``：节点名（必填），如「1班组」「生产部」；
    - ``org_type``：company|dept|team（可选，不传按名称推断）；
    - ``parent_name`` / ``parent_id``：父节点（可选，找不到报 ORG_PARENT_NOT_FOUND）。

    幂等：**同名同父节点已存在时复用**（不重复建、org_id 不变）。
    """
    from .identity import ORG_TYPES

    store = _identity_store()
    tenant = _identity_tenant(payload, ctx)
    name = str(payload.get("name") or "").strip()
    if not name:
        raise _tool_error("create_org_node", "INVALID_ORG_NAME", "需要给出组织节点名称，如「1班组」「生产部」")
    raw_type = str(payload.get("org_type") or "").strip().lower()
    if raw_type and raw_type not in ORG_TYPES:
        raise _tool_error("create_org_node", "INVALID_ORG_TYPE",
                          f"org_type 只能是 company/dept/team：{raw_type}")
    nodes = store.org_tree(tenant_id=tenant)
    parent_id = _resolve_parent_id(payload, nodes)
    for node in nodes:
        # 同名同父 → 复用（用户重复说「建1班组」不会建出两个）
        if (str(node.get("name") or "") == name
                and (node.get("parent_id") or None) == (parent_id or None)):
            result = _org_payload(store, tenant, node, created=False)
            result.update({"trace_id": _trace(ctx, "create_org_node"),
                           "evidence": [_evidence("identity", result["org_id"],
                                                  f"reused name={name} parent={parent_id or '-'}")]})
            return result
    org_type = raw_type or _org_type_from_name(name)
    slug = _org_slug(name, org_type, {str(node.get("org_id") or "") for node in nodes})
    node = store.upsert_org(tenant_id=tenant, org_id=slug, name=name,
                            parent_id=parent_id, org_type=org_type, source="manual")
    result = _org_payload(store, tenant, node, created=True)
    result.update({"trace_id": _trace(ctx, "create_org_node"),
                   "evidence": [_evidence("identity", result["org_id"],
                                          f"created name={name} type={org_type} parent={parent_id or '-'}")]})
    return result


HANDLERS = {
    "data_import_run": m0_import,
    "data_import_status": m0_status,
    "data_import_preview": m0_preview,
    "data_import_resolve": m0_resolve,
    "data_import_commit": m0_commit,
    "ingest_document": m1_parse,
    "run_bom_sop_workflow": m2_bom,
    "run_m3_procurement_requirements": m3_mrp,
    "import_m4_purchase_suggestions_json": m4_purchase,
    "solve_scheduling": m5_schedule,
    # M5 PMC v2 tool handlers (Taskbook Tasks 3-5); the two excluded tools
    # (report_workload, bind_worker_to_order) intentionally stay unbound.
    "get_m5_schedule": _m5("get_m5_schedule"),
    "list_m5_schedules": _m5("list_m5_schedules"),
    "get_m5_pmc_progress": _m5("get_m5_pmc_progress"),
    "get_m5_material_readiness": _m5("get_m5_material_readiness"),
    "get_m5_integration_contracts": _m5("get_m5_integration_contracts"),
    "ingest_m5_planning_snapshot": _m5("ingest_m5_planning_snapshot"),
    "replan_m5_schedule": _m5("replan_m5_schedule"),
    "dispatch_m5_schedule": _m5("dispatch_m5_schedule"),
    "get_m5_execution_summary": _m5("get_m5_execution_summary"),
    "search_m5_knowledge": _m5("search_m5_knowledge"),
    "record_m5_knowledge": _m5("record_m5_knowledge"),
    "prepare_m5_department_message": _m5("prepare_m5_department_message"),
    "get_m5_department_message": _m5("get_m5_department_message"),
    "get_m5_department_message_delivery": _m5("get_m5_department_message_delivery"),
    "advise_m5_schedule": _m5("advise_m5_schedule"),
    "run_m5_intelligent_schedule": _m5("run_m5_intelligent_schedule"),
    "generate_m5_material_procurement_plan": _m5("generate_m5_material_procurement_plan"),
    # M0 自描述表识别（agent-driven file recognition，确定性安全网）
    "sample_file": sample_file,
    "ingest_recognized": ingest_recognized,
    "query_recognized_table": query_recognized_table,
    "ingest_canonical": ingest_canonical,
    # 身份/账号（对话建账号、分配账号、建组织节点）
    "list_identity_users": list_identity_users,
    "create_identity_user": create_identity_user,
    "assign_identity_account": assign_identity_account,
    "create_org_node": create_org_node,
}
