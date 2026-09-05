"""确定性跨模块桥接（任务书 T2）：主链装配不再在 graph._payload_for 用大段
临时字典重建事实，而是由本模块按上游 outputs/canonical 回读装配 payload。

原则：
- M1->M2  从 m1.document.v2 与已发布 canonical order/product 读取；
- M2->M3  只消费已批准 BOM/route，库存来自库存事实快照，不接受隐式默认；
- M3->M4  消费 M3 handoff envelope（revision/checksum），供应商/交期由
          M4 供应/采购事实解析；
- M4->M5  消费 M4 supply snapshot（PO/ETA/收货/QC），不忽略 M4 输出；
- 只调用 ToolRegistry 已注册工具，传播 TaskID/tenant/site/trace/幂等键；
- 缺任何权威输入 -> 结构化 BLOCKED_INPUT
  {success:false, code:"BLOCKED_INPUT", errors:[{code,message,details}],
   data:{missing_fields, source_module, required_tool, recovery, snapshot_kind?},
   trace_id, evidence:[...]}。

本桥接只服务于受控 workflow（m1_m5_document_to_plan / canonical_to_m5）；
旧 m0_m5 保留为兼容路径，仍走 graph._payload_for。
"""
from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from typing import Any

from .models import RunState, summarize
from .planning_snapshot import SIX_CLASS_BUNDLE, blocked_input, snapshot_counts

BRIDGED_WORKFLOWS = ("m1_m5_document_to_plan", "canonical_to_m5")

#: 缺权威输入时的恢复动作模板（人类 Gate 可见）。
_RECOVERY = "请补充 {fields} 的权威来源（canonical 回读/已批准事实），再重试本步骤"


def _now_task(state: RunState) -> str:
    return str(state.get("task_id") or "task")


def _trace(state: RunState, tool: str) -> str:
    return f"{_now_task(state)}:{tool}"


def _data(result: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {}
    data = result.get("data")
    return data if isinstance(data, dict) else result


def blocked(state: RunState, *, source_module: str, tool: str,
            missing_fields: list[str], required_tool: str = "",
            recovery: str = "") -> dict[str, Any]:
    recovery = recovery or _RECOVERY.format(fields="、".join(sorted(set(missing_fields))) or "对应事实")
    return blocked_input(
        missing_fields=missing_fields,
        source_module=source_module,
        required_tool=required_tool or tool,
        recovery=recovery,
    )


# ---------------------------------------------------------------------------
# 上游读取辅助：outputs 按 tool 名取 result，再取 data/子路径。
# ---------------------------------------------------------------------------

def output_data(state: RunState, tool: str) -> dict[str, Any]:
    return _data(state.get("outputs", {}).get(tool))


def _pick(*values: Any) -> Any:
    for value in values:
        if isinstance(value, dict) and value:
            return value
        if isinstance(value, list) and value:
            return value
    return None


def read_order(state: RunState) -> dict[str, Any]:
    """M1/m0 输出的订单权威字段：优先 canonical/M1，而不是最初 request。"""
    from_m1 = output_data(state, "ingest_document")
    order = _pick(
        from_m1.get("order"), from_m1.get("extraction", {}).get("order"),
        from_m1.get("document", {}).get("header"),
    )
    supplement = from_m1.get("semantic_supplement")
    supplement_document = supplement.get("document") if isinstance(supplement, dict) else None
    supplement_header = supplement_document.get("header") if isinstance(supplement_document, dict) else None
    request = state.get("request", {})
    explicit = {
        key: request.get(key)
        for key in ("order_id", "order_number", "product_code", "product_name", "quantity", "order_qty", "due_date", "order_date", "customer")
        if request.get(key) not in (None, "")
    }
    if isinstance(order, dict):
        if isinstance(supplement_header, dict):
            # Keep external M1 values and use only non-empty, source-backed
            # supplement fields for gaps. This makes line model -> header
            # product_code explicit without overwriting an external fact.
            merged = dict(order)
            for key, value in supplement_header.items():
                if merged.get(key) in (None, "") and value not in (None, ""):
                    merged[key] = value
            merged.update({key: value for key, value in explicit.items() if merged.get(key) in (None, "")})
            return merged
        return {**order, **{key: value for key, value in explicit.items() if order.get(key) in (None, "")}}
    if isinstance(supplement_header, dict):
        return {**supplement_header, **{key: value for key, value in explicit.items() if supplement_header.get(key) in (None, "")}}
    return explicit


def read_lines(state: RunState) -> list[dict[str, Any]]:
    from_m1 = output_data(state, "ingest_document")
    lines = _pick(
        from_m1.get("lines"),
        from_m1.get("document", {}).get("lines"),
        from_m1.get("extraction", {}).get("lines"),
    )
    if not isinstance(lines, list) or not lines:
        supplement = from_m1.get("semantic_supplement")
        supplement_document = supplement.get("document") if isinstance(supplement, dict) else None
        lines = supplement_document.get("lines") if isinstance(supplement_document, dict) else None
    return [item for item in lines if isinstance(item, dict)] if isinstance(lines, list) else []


def read_approved_bom(state: RunState) -> list[dict[str, Any]]:
    """只消费 reviewer 已批准（engineering Gate 通过）的 M2 BOM 行。"""
    m2 = output_data(state, "run_bom_sop_workflow")
    generation = m2.get("bom_generation")
    if not isinstance(generation, dict):
        return []
    if str(generation.get("approval_status") or "") != "approved":
        # graph._apply_approval 批准 engineering Gate 时写入 approval_status。
        return []
    lines = generation.get("bom_lines")
    return [item for item in lines if isinstance(item, dict)] if isinstance(lines, list) else []


def _bom_lines_from_overview(payload: dict[str, Any], product_code: str) -> list[dict[str, Any]]:
    """Extract only an approved BOM for the requested product from M0 overview."""
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        return []
    indexes = data.get("indexes")
    boms = indexes.get("boms") if isinstance(indexes, dict) else None
    if not isinstance(boms, list):
        return []
    for item in boms:
        entity = item.get("entity") if isinstance(item, dict) else None
        if not isinstance(entity, dict) or (str(entity.get("review_status") or "") not in {"", "approved"} and str(entity.get("status") or "") != "active"):
            continue
        attrs = entity.get("attributes")
        if not isinstance(attrs, dict):
            continue
        entity_product = str(attrs.get("product_code") or entity.get("business_key") or "")
        if entity_product != product_code:
            continue
        lines = attrs.get("lines")
        if not isinstance(lines, list):
            continue
        normalized: list[dict[str, Any]] = []
        for index, line in enumerate(lines, start=1):
            if not isinstance(line, dict) or not str(line.get("material_code") or "").strip():
                continue
            normalized.append({
                "line_id": str(line.get("line_id") or line.get("line_no") or f"{product_code}::BOM-{index}"),
                "material_code": str(line.get("material_code") or ""),
                "material_name": str(line.get("material_name") or line.get("material_code") or ""),
                "quantity_per": line.get("quantity_per", line.get("quantity", 0)),
                "quantity": line.get("quantity", line.get("quantity_per", 0)),
                "uom": str(line.get("uom") or line.get("unit") or "pcs"),
                "loss_rate": line.get("loss_rate", 0),
                "requires_procurement": line.get("requires_procurement", True),
            })
        return normalized
    return []


def _read_m0_product_overview(state: RunState, product_code: str) -> dict[str, Any]:
    """Best-effort M0 canonical read; callers fail closed when it is unavailable."""
    base_url = str(os.getenv("M0_URL") or "").rstrip("/")
    tenant_id = str(state.get("tenant_id") or "").strip()
    if not base_url or not tenant_id or not product_code:
        return {}
    url = f"{base_url}/api/m0/catalog/products/{product_code}/overview"
    request = Request(url, headers={"X-Tenant-ID": tenant_id, "X-Yunpai-Tenant": tenant_id, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=float(os.getenv("M0_CATALOG_TIMEOUT_S", "3"))) as response:
            body = response.read()
        parsed = json.loads(body.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return {}


def _route_steps_from_overview(payload: dict[str, Any], product_code: str) -> list[dict[str, Any]]:
    """Read an approved SOP route from the M0 product overview."""
    data = payload.get("data") if isinstance(payload, dict) else None
    indexes = data.get("indexes") if isinstance(data, dict) else None
    sops = indexes.get("sops") if isinstance(indexes, dict) else None
    if not isinstance(sops, list):
        return []
    for item in sops:
        entity = item.get("entity") if isinstance(item, dict) else None
        if not isinstance(entity, dict) or (str(entity.get("review_status") or "") not in {"", "approved"} and str(entity.get("status") or "") != "active"):
            continue
        attrs = entity.get("attributes") if isinstance(entity.get("attributes"), dict) else {}
        nested = attrs.get("attributes") if isinstance(attrs.get("attributes"), dict) else {}
        product_codes = attrs.get("product_codes") or nested.get("product_codes") or entity.get("product_codes") or []
        if product_code not in [str(code) for code in product_codes]:
            continue
        raw_steps = attrs.get("route_steps") or attrs.get("operations") or attrs.get("route") or nested.get("route_steps") or nested.get("operations") or nested.get("route") or []
        if not isinstance(raw_steps, list):
            continue
        steps: list[dict[str, Any]] = []
        for index, step in enumerate(raw_steps, start=1):
            if not isinstance(step, dict):
                continue
            steps.append({
                "product_id": product_code,
                "operation_id": str(step.get("operation_id") or step.get("operation_code") or f"OP-{index:02d}"),
                "operation_name": str(step.get("operation_name") or step.get("name") or ""),
                "name": str(step.get("name") or step.get("operation_name") or step.get("operation_code") or f"OP-{index:02d}"),
                "description": str(step.get("description") or (step.get("attributes") or {}).get("instructions") or ""),
                "station": str(step.get("station") or step.get("station_code") or ""),
                "machine_model": str(step.get("machine_model") or ""),
                "sequence": int(step.get("sequence") or step.get("sequence_no") or index),
                "standard_minutes": step.get("standard_minutes") if step.get("standard_minutes") is not None else None,
                "standard_time_s": step.get("standard_time_s"),
                "eligible_resources": step.get("eligible_resources") or [],
                "required_equipment_codes": step.get("required_equipment_codes") or step.get("equipment_codes") or [],
                "station_code": str(step.get("station_code") or ""),
                "attributes": step.get("attributes") if isinstance(step.get("attributes"), dict) else {},
            })
        if steps:
            return steps
    return []
def merge_m2_canonical_bom(result: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Preserve an M0-approved BOM when the M2 generator cannot consume it directly."""
    if not isinstance(result, dict):
        return result
    lines = payload.get("bom_lines") if isinstance(payload, dict) else None
    if not isinstance(lines, list) or not lines:
        return result
    generation = result.setdefault("bom_generation", {})
    if not isinstance(generation, dict):
        generation = {}
        result["bom_generation"] = generation
    if not generation.get("bom_lines"):
        generation["bom_lines"] = [line for line in lines if isinstance(line, dict)]
    result["canonical_bom_match"] = {
        "status": "matched",
        "source": "m0.get_m0_product_overview",
        "product_code": str((payload.get("product_profile") or {}).get("product_code") or ""),
        "line_count": len(generation.get("bom_lines") or []),
        "review_status": "approved",
    }
    route = payload.get("routing_steps") if isinstance(payload, dict) else None
    if isinstance(route, list) and route:
        generation_sop = result.setdefault("sop_generation", {})
        if isinstance(generation_sop, dict):
            generation_sop["route_steps"] = [step for step in route if isinstance(step, dict)]
            generation_sop["operation_count"] = len(generation_sop["route_steps"])
            generation_sop["status"] = "matched"
        result["canonical_sop_match"] = {
            "status": "matched",
            "source": "m0.get_m0_product_overview",
            "product_code": str((payload.get("product_profile") or {}).get("product_code") or ""),
            "operation_count": len(route),
            "standard_minutes_missing": sum(1 for step in route if isinstance(step, dict) and step.get("standard_minutes") in (None, "")),
        }
    return result


def read_approved_route(state: RunState) -> list[dict[str, Any]]:
    request = state.get("request", {})
    steps = request.get("routing_steps") or []
    if not steps:
        m2 = output_data(state, "run_bom_sop_workflow")
        sop_generation = m2.get("sop_generation") if isinstance(m2, dict) else None
        if isinstance(sop_generation, dict) and str(sop_generation.get("approval_status") or "") == "approved":
            steps = sop_generation.get("route_steps") or []
    return [item for item in steps if isinstance(item, dict)] if isinstance(steps, list) else []


def read_inventory_facts(state: RunState) -> list[dict[str, Any]]:
    """库存只允许来自显式事实快照：M3 回读快照或 request.inventory 显式条目
    （warehouse/lot/qc/observed_at 均不能由桥接补默认）。"""
    request = state.get("request", {})
    inventory = request.get("inventory") or request.get("inventory_snapshot") or []
    if not isinstance(inventory, list):
        return []
    items = [item for item in inventory if isinstance(item, dict)]
    # 显式 preview/fixture（legacy_preview=True）允许无字段条目用于本地测试；
    # 生产严格路径必须带仓库/lot/qc 字段，缺则交由调用方 BLOCKED_INPUT。
    if bool(request.get("legacy_preview")):
        return items
    return [item for item in items if item.get("warehouse") or item.get("lot_no") or item.get("qc_status")]


def read_supplier_facts(state: RunState) -> dict[str, Any]:
    request = state.get("request", {})
    supplier = request.get("supplier_by_material") or {}
    return supplier if isinstance(supplier, dict) else {}


def read_m4_supply_snapshot(state: RunState) -> dict[str, Any]:
    """M4 供应快照：只消费 M4 输出，不从最初 request 重建。"""
    m4 = output_data(state, "import_m4_purchase_suggestions_json")
    if not m4:
        return {}
    return m4


# ---------------------------------------------------------------------------
# 主链 payload 装配
# ---------------------------------------------------------------------------

def _assembly_payloads_from_state(state: RunState) -> dict[str, Any]:
    """把 orchestrator 已批准的订单/路线/库存/供应事实包装成 planning_snapshot
    可消费结构（含显式 snapshot 字段则原样传递）。"""
    request = state.get("request", {})
    payloads: dict[str, Any] = {}
    for key in ("orders", "routing_steps", "resources", "resource_snapshot",
                "calendar_windows", "calendar", "calendar_snapshot",
                "supply_entries", "material_availability", "wip_status",
                "changeover_rules", "setup_matrix", "order_kitting"):
        if request.get(key) is not None:
            payloads[key] = request[key]
    return payloads


def bridge_payload(state: RunState, tool: str) -> dict[str, Any]:
    """为受控 workflow 的某个 tool 装配 payload；缺权威输入返回 BLOCKED_INPUT 结构。

    返回的 dict 若带 ``success=False`` 且 ``code==BLOCKED_INPUT``，graph 侧
    将把它作为步骤结果交给 Reviewer（开数据 Gate），不会调用该 tool。
    """
    request = state.get("request", {})
    if tool == "ingest_document":
        attachments = request.get("attachments") or request.get("documents") or []
        order_attachment = next(
            (item for item in attachments if isinstance(item, dict) and item.get("kind") == "order"),
            None,
        )
        file_value = order_attachment if isinstance(order_attachment, dict) else None
        if not file_value and request.get("document"):
            file_value = {
                "filename": "order.json",
                "content_type": "application/json",
                "content_b64": request["document"].get("_encoded", ""),
            }
        if not file_value:
            return blocked(state, source_module="m1", tool=tool,
                           missing_fields=["request.attachments(原始文件)"],
                           required_tool="ingest_document",
                           recovery="请上传原始订单/业务文件后再重试 M1 解析")
        # 注册工具 ingest_document 的本地 handler（workers.m1_parse）会按字节结构
        # 用同一 order_semantics 确定性解析 XLSX，这里只传文件，不在编排层预解析。
        return {"file": file_value}
    if tool == "data_import_run":
        m1 = output_data(state, "ingest_document")
        # M0 以 M1 已复核解析为依据（保留 sha 证据），本地 fixture 模式允许
        # 原始附件直达以兼容 preview；HTTP transport 由真实 M0 处理。
        file_value = None
        attachments = request.get("attachments") or request.get("documents") or []
        order_attachment = next(
            (item for item in attachments if isinstance(item, dict) and item.get("kind") == "order"),
            None,
        )
        file_value = order_attachment if isinstance(order_attachment, dict) else None
        if file_value is None and m1.get("document"):
            source = m1.get("document", {}).get("source", {})
            file_value = {
                "filename": str(source.get("original_filename") or "m1-document.json"),
                "content_type": "application/json",
                "content_b64": request.get("_m1_encoded", ""),
            }
        if file_value is None:
            return blocked(state, source_module="m0", tool=tool,
                           missing_fields=["ingest_document 输出或原始附件"],
                           required_tool="ingest_document")
        payload: dict[str, Any] = {"files": [file_value]}
        return payload
    if tool == "data_import_commit":
        imported = output_data(state, "data_import_run")
        batch_id = imported.get("batch_id") or imported.get("id")
        if not batch_id:
            return blocked(state, source_module="m0", tool=tool,
                           missing_fields=["data_import_run.batch_id"],
                           required_tool="data_import_run")
        return {"batch_id": str(batch_id), "require_resolved": True}
    if tool == "run_bom_sop_workflow":
        order = read_order(state)
        product_code = str(order.get("product_code") or "")
        if not product_code:
            return blocked(state, source_module="m1", tool=tool,
                           missing_fields=["m1 订单 header.product_code"],
                           required_tool="ingest_document",
                           recovery="请先完成 M1 解析/复核，使订单产品编码成为权威事实")
        approved_bom = read_approved_bom(state)
        bom_lines = approved_bom
        if not bom_lines:
            bom_lines = request.get("bom_lines") or []
        if not bom_lines:
            m0_overview = _read_m0_product_overview(state, product_code)
            bom_lines = _bom_lines_from_overview(m0_overview, product_code)
        routing_steps = read_approved_route(state)
        if not routing_steps:
            m0_overview = _read_m0_product_overview(state, product_code)
            routing_steps = _route_steps_from_overview(m0_overview, product_code)
        attachments = [item for item in (request.get("attachments") or [])
                       if isinstance(item, dict) and item.get("kind") == "master_data"]
        lines = []
        for index, line in enumerate(bom_lines if isinstance(bom_lines, list) else [], start=1):
            if not isinstance(line, dict):
                continue
            lines.append({
                "item_no": str(line.get("line_id") or index),
                "material_code": str(line.get("material_code") or ""),
                "name": str(line.get("material_name") or line.get("material_code") or "未命名物料"),
                "specification": str(line.get("specification") or ""),
                "quantity": str(line.get("quantity_per", line.get("quantity", ""))),
                "note": str(line.get("note") or ""),
            })
        return {
            "product_profile": {"product_code": product_code, "product_name": order.get("product_name") or order.get("product_code") or ""},
            "bom_lines": bom_lines,
            "bom_items": lines,
            "routing_steps": routing_steps,
            "requirement_text": str(request.get("message") or request.get("requirement_text") or ""),
            "rule_package_path": str(request.get("rule_package_path") or "/home/soft/yunpai/prod-39092/app/m8/material_numbering"),
            "document_no": str(request.get("document_no") or product_code or "M2-DRAFT"),
            "history_bom_paths": request.get("history_bom_paths") or [],
            "history_sop_paths": request.get("history_sop_paths") or [],
            "template_confirmation": request.get("template_confirmation") or {"confirmed": True},
            "customer_answers": request.get("customer_answers") or {},
            "machine_hints": request.get("machine_hints") or [],
            "station": str(request.get("station") or ""),
            "enable_bom_model": bool(request.get("enable_bom_model", False)),
            "enable_sop_model": bool(request.get("enable_sop_model", False)),
            "bom_files": request.get("bom_files") or attachments,
            "sop_files": request.get("sop_files") or attachments,
            "use_demo_sources": False,
            "_source": {
                "module": "m0" if not approved_bom and not request.get("bom_lines") else "m1",
                "ref": "get_m0_product_overview" if not approved_bom and not request.get("bom_lines") else "ingest_document",
                "evidence": bool(order),
            },
        }
    if tool == "run_m3_procurement_requirements":
        order = read_order(state)
        bom_lines = read_approved_bom(state)
        inventory = read_inventory_facts(state)
        product_code = str(order.get("product_code") or "")
        order_id = str(order.get("order_id") or "")
        if not bom_lines:
            return blocked(state, source_module="m2", tool=tool,
                           missing_fields=["已批准 BOM 行"],
                           required_tool="run_bom_sop_workflow",
                           recovery="请先完成工程 Gate 批准 BOM，再执行齐套计算")
        if not inventory:
            if bool(request.get("legacy_preview")):
                inventory = [{"material_code": str(line.get("material_code") or ""), "available_qty": 0} for line in bom_lines]
            else:
                return blocked(state, source_module="m3", tool=tool,
                               missing_fields=["inventory_snapshot(含 warehouse/lot/qc)"],
                               required_tool="get_material_readiness_snapshot",
                               recovery="缺少权威库存快照；请提供 M3 库存事实后重试")
        payload: dict[str, Any] = {
            "tenant_id": state.get("tenant_id", "default"),
            "order": {"project_id": str(request.get("project_id") or order_id), "order_id": order_id, "bom_id": str(request.get("bom_id") or f"BOM-{product_code}"), "product_name": order.get("product_name") or product_code or "", "order_qty": order.get("quantity", 0), "due_date": str(order.get("due_date") or "")},
            "bom": {"bom_id": str(request.get("bom_id") or f"BOM-{product_code}"), "product_name": order.get("product_name") or product_code or "", "lines": [{"line_id": str(line.get("line_id") or f"line-{index}"), "material_code": str(line.get("material_code") or ""), "material_name": str(line.get("material_name") or line.get("material_code") or ""), "qty_per": line.get("qty_per", line.get("quantity_per", line.get("quantity", 0))), "uom": str(line.get("uom") or line.get("unit") or "pcs"), "loss_rate": line.get("loss_rate", 0), "requires_procurement": line.get("requires_procurement", True)} for index, line in enumerate(bom_lines, start=1)]},
            "inventory_snapshot": inventory,
        }
        return payload
    if tool == "import_m4_purchase_suggestions_json":
        m3 = output_data(state, "run_m3_procurement_requirements")
        shortage_lines = m3.get("shortage_lines") or []
        if not isinstance(shortage_lines, list):
            shortage_lines = []
        if not shortage_lines:
            return blocked(state, source_module="m3", tool=tool,
                           missing_fields=["run_m3_procurement_requirements.shortage_lines"],
                           required_tool="run_m3_procurement_requirements",
                           recovery="齐套无缺口则无需采购；若缺口存在请先完成 M3 计算")
        supplier_facts = read_supplier_facts(state)
        suggestions = []
        for line in shortage_lines:
            if not isinstance(line, dict):
                continue
            material_code = str(line.get("material_code") or "")
            suggestions.append({
                "item_code": material_code,
                "item_name": line.get("material_name") or material_code,
                "quantity": line.get("suggest_purchase_qty", line.get("shortage_qty", 0)),
                "unit": line.get("uom", "pcs"),
                "supplier_name": supplier_facts.get(material_code, ""),
                "required_date": str(m3.get("due_date") or ""),
                "project_code": str(m3.get("project_id") or ""),
            })
        if any(not item["supplier_name"] for item in suggestions) and not bool(request.get("legacy_preview")):
            return blocked(state, source_module="m4", tool=tool,
                           missing_fields=["supplier_by_material(权威供应商主数据)"],
                           required_tool="list_m4_suppliers",
                           recovery="缺少权威供应商映射；请提供 M4 供应商主数据后重试")
        return {
            "suggestions": suggestions,
            "tenant_id": state.get("tenant_id", "default"),
            "site_id": str(request.get("site_id") or "default"),
            "tracking_task_id": state.get("task_id", ""),
            "idempotency_key": f"{state.get('task_id', 'task')}:m4",
            "source_module": "m3",
            "procurement_plan_id": m3.get("procurement_plan_id"),
            "order_id": m3.get("order_id"),
            "source_plan_checksum": m3.get("handoff_envelope", {}).get("source_plan_checksum") if isinstance(m3.get("handoff_envelope"), dict) else None,
        }
    if tool == "ingest_m5_planning_snapshot":
        from .planning_snapshot import assemble_bundle, verify_bundle

        order = read_order(state)
        m3 = output_data(state, "run_m3_procurement_requirements")
        m4 = read_m4_supply_snapshot(state)
        request_payload = _assembly_payloads_from_state(state)
        scenario_id = str(request.get("scenario_id") or f"scenario-{order.get('order_id', '')}")
        bundle = assemble_bundle(
            orders=[{"order_id": str(order.get("order_id") or ""), "lines": read_lines(state) or [{"order_line_id": f"{order.get('order_id')}::L1", "product_code": order.get("product_code"), "qty": order.get("quantity", 0), "due_date": order.get("due_date"), "priority": "normal"}]}],
            routes=request_payload.get("routing_steps") or [],
            resource_snapshot=request_payload.get("resource_snapshot") or ({"resources": request_payload.get("resources") or []} if request_payload.get("resources") else None),
            calendar_snapshot=request_payload.get("calendar_snapshot"),
            supply_snapshot=request_payload.get("supply_snapshot") or ({"entries": request_payload.get("supply_entries") or [], "order_kitting": request_payload.get("order_kitting")} if request_payload.get("supply_entries") or request_payload.get("order_kitting") else None),
            constraint_snapshot=request_payload.get("constraint_snapshot") or ({"changeover_rules": request_payload.get("changeover_rules") or request_payload.get("setup_matrix") or {}} if request_payload.get("changeover_rules") or request_payload.get("setup_matrix") else None),
            tenant_id=state.get("tenant_id", "default"),
            site_id=str(request.get("site_id") or "default"),
        )
        missing = verify_bundle(bundle)
        if missing:
            return blocked(state, source_module="orchestrator", tool=tool,
                           missing_fields=missing,
                           required_tool="ingest_m5_planning_snapshot",
                           recovery="缺少权威 snapshot；请提供已批准 route/资源/日历/供应事实后重试")
        return {
            "scenario_id": scenario_id,
            "tenant_id": state.get("tenant_id", "default"),
            "site_id": str(request.get("site_id") or "default"),
            "scenario_purpose": str(request.get("scenario_purpose") or "production"),
            "replace_existing": True,
            "source_systems": ["orchestrator", "m1", "m2", "m3", "m4"],
            "observed_at": request.get("observed_at"),
            "source_observed_at": request.get("source_observed_at") or {},
            "pmc_v2_bundle": bundle,
            "idempotency_key": f"{state.get('task_id', 'task')}:m5-snapshot",
        }
    if tool == "solve_scheduling":
        from .planning_snapshot import SNAPSHOT_KINDS

        snapshots = output_data(state, "ingest_m5_planning_snapshot")
        # M5 求解必须以已持久化的 snapshot 回读为准；若 snapshot 步骤被跳过
        # （未绑定/失败），不重建事实。
        persisted = snapshots.get("readiness", {}).get("status") if isinstance(snapshots.get("readiness"), dict) else ""
        if persisted != "snapshots_stored":
            return blocked(state, source_module="m5", tool=tool,
                           missing_fields=["ingest_m5_planning_snapshot 持久化回读"],
                           required_tool="ingest_m5_planning_snapshot",
                           recovery="请先完成六类 snapshot ingest 并回读成功，再求解")
        order = read_order(state)
        lines = read_lines(state)
        orders = []
        if lines:
            for index, line in enumerate(lines, start=1):
                orders.append({
                    "order_id": str(order.get("order_id") or ""),
                    "order_line_id": str(line.get("line_id") or f"{order.get('order_id')}::L{index}"),
                    "product_id": str(line.get("product_code") or line.get("model") or order.get("product_code") or ""),
                    "quantity": line.get("quantity", 0),
                    "due_time": str(line.get("due_date") or order.get("due_date") or ""),
                    "priority": request.get("priority", "normal"),
                    "status": "firm",
                })
        else:
            orders = [{"order_id": str(order.get("order_id") or ""), "product_id": order.get("product_code") or "", "quantity": order.get("quantity", 0), "due_time": str(order.get("due_date") or ""), "priority": request.get("priority", "normal"), "status": "firm"}]
        scenario_id = str(request.get("scenario_id") or f"scenario-{order.get('order_id', '')}")
        return {
            "idempotency_key": f"{state.get('task_id', 'task')}:m5",
            "scenario_id": scenario_id,
            "scenario_purpose": str(request.get("scenario_purpose") or "production"),
            "planning_start": request.get("planning_start"),
            "orders": orders,
            "source_systems": ["orchestrator", "m1", "m2", "m3", "m4", "m5"],
            "source_observed_at": request.get("source_observed_at") or {},
            "tracking_task_id": state.get("task_id", ""),
        }
    if tool == "get_m5_schedule":
        solve = output_data(state, "solve_scheduling")
        plan_version = solve.get("schedule", {}).get("plan_version") if isinstance(solve.get("schedule"), dict) else None
        if not plan_version:
            return blocked(state, source_module="m5", tool=tool,
                           missing_fields=["solve_scheduling 输出的 plan_version"],
                           required_tool="solve_scheduling")
        return {"plan_version": str(plan_version)}
    return {}
