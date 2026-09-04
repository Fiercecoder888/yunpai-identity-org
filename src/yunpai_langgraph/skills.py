from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from .business_catalog import ingest_tree


SkillHandler = Callable[[dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class SkillSpec:
    name: str
    description: str
    handler: SkillHandler
    tags: tuple[str, ...] = field(default_factory=tuple)
    tools: tuple[str, ...] = field(default_factory=tuple)
    version: str = "1.0.0"
    # 与 registry 工具/上游 Skill 的契约版本，用于回归兼容与证据引用
    contract_version: str = "yunpai.skill-contract.v1"


class SkillRegistry:
    """总规划 Agent 可见的高阶能力；Skill 内部可以编排多个工具或数据处理步骤。"""

    def __init__(self) -> None:
        self.specs: dict[str, SkillSpec] = {}

    def register(self, spec: SkillSpec) -> None:
        if spec.name in self.specs:
            raise ValueError(f"duplicate skill: {spec.name}")
        self.specs[spec.name] = spec

    def validate_tools(self, available_tools: Any) -> None:
        """Fail fast when a declared Skill mapping drifts from Tool manifests."""
        names = set(available_tools)
        missing = {
            skill.name: sorted(set(skill.tools) - names)
            for skill in self.specs.values()
            if set(skill.tools) - names
        }
        if missing:
            raise ValueError(f"skill tool mappings are not registered: {missing}")

    async def call(self, name: str, payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        if name not in self.specs:
            raise KeyError(f"unknown skill: {name}")
        spec = self.specs[name]
        result = await spec.handler(payload, context)
        if isinstance(result, dict):
            result = {
                **result,
                "skill": name,
                "skill_version": spec.version,
                "skill_contract": spec.contract_version,
                "evidence": [
                    *([item for item in result.get("evidence", [])] if isinstance(result.get("evidence"), list) else []),
                    {"module": "orchestrator", "source_ref": name, "evidence_ref": f"skill:{name}@{spec.version}", "detail": f"Skill 调用 {name}@{spec.version} 已执行"},
                ],
            }
        return result

    def catalog(self) -> list[dict[str, Any]]:
        return [
            {
                "name": spec.name,
                "skill_id": f"{spec.name}@{spec.version}",
                "version": spec.version,
                "contract_version": spec.contract_version,
                "description": spec.description,
                "tags": list(spec.tags),
                "tools": list(spec.tools),
            }
            for spec in self.specs.values()
        ]


def _safe_name(filename: str) -> str:
    name = Path(filename).name
    return name if name and name not in {".", ".."} else "upload.bin"


async def identify_business_data(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """识别外部资料或上传文件，并写入可审核候选库。

    上传文件逐个返回状态（accepted/needs_review/unsupported/parse_failed/
    skipped），缺失 content_b64 的文件标记 skipped 而不是静默 continue；
    没有任何 accepted 文件时返回失败而非 candidate_created 空批次。
    """
    from .uploads import UPLOAD_MODES, UploadSummary, require_content_b64, to_attachment_record, validate_mode

    db_path = payload.get("db_path") or "runtime/yunpai-business-catalog.sqlite"
    root_path = payload.get("root_path") or payload.get("business_data_root")
    mode = validate_mode(payload.get("mode") or "master_data")
    summary = UploadSummary(mode=mode)
    if root_path:
        result = ingest_tree(root_path, db_path, batch_id=f"batch-{context.get('task_id', 'skill')}")
        total = int(result.get("file_count") or 0)
        for item in result.get("errors", []):
            summary.add(to_attachment_record(
                {"filename": str(item.get("path") or "upload")}, mode=mode,
                status="parse_failed", reason=str(item.get("error") or "ingest error"),
            ))
        summary.accepted = max(0, total - summary.parse_failed)
        summary.total = max(summary.total, total)
        batch_result = result
    else:
        files = payload.get("files") or []
        if not isinstance(files, list) or not files:
            raise ValueError("业务资料 Skill 需要 root_path 或 files")
        staging = Path(payload.get("staging_dir") or "runtime/business-upload-staging") / str(context.get("task_id", "skill"))
        staging.mkdir(parents=True, exist_ok=True)
        accepted = 0
        for index, item in enumerate(files, start=1):
            filename = str(item.get("filename") or "upload.bin") if isinstance(item, dict) else "upload.bin"
            try:
                raw = require_content_b64(item, filename=filename)
            except ValueError as exc:
                summary.add(to_attachment_record(
                    item if isinstance(item, dict) else {}, mode=mode,
                    status="skipped", reason=str(exc),
                ))
                continue
            digest = hashlib.sha256(raw).hexdigest()
            # Include the upload index so same-name/same-content files do not
            # overwrite one another in the staging batch.
            (staging / f"{digest[:16]}-{index:03d}-{_safe_name(filename)}").write_bytes(raw)
            summary.add(to_attachment_record(
                {**(item if isinstance(item, dict) else {}), "sha256": digest},
                mode=mode, status="accepted",
            ))
            accepted += 1
        if accepted == 0:
            return {
                "skill": "business-data-identification",
                "status": "failed",
                "code": "NO_ACCEPTED_FILES",
                "message": "上传批次中没有可识别文件；缺失 content_b64、格式不支持或超限文件已逐文件跳过",
                "schema_version": "yunpai.business-catalog.v2",
                "upload_summary": summary.as_dict(),
                "evidence": [{"module": "orchestrator", "source_ref": "files", "evidence_ref": f"business-catalog:{context.get('task_id', 'skill')}", "detail": "无 accepted 文件，未创建候选"}],
            }
        batch_result = ingest_tree(staging, db_path, batch_id=f"batch-{context.get('task_id', 'skill')}", parse_xlsx=True, deep_limit_bytes=12_000_000)
        for item in batch_result.get("errors", []):
            summary.add(to_attachment_record(
                {"filename": str(item.get("path") or "upload")}, mode=mode,
                status="parse_failed", reason=str(item.get("error") or "ingest error"),
            ))
    return {
        "skill": "business-data-identification",
        "skill_mode": mode,
        "status": "candidate_created",
        "schema_version": "yunpai.business-catalog.v2",
        "upload_summary": summary.as_dict(),
        "batch": batch_result,
        "evidence": [{"module": "orchestrator", "source_ref": batch_result["root_path"], "evidence_ref": f"business-catalog:{batch_result['batch_id']}", "detail": "文件哈希、分类和字段观察已写入候选库"}],
    }


async def _dispatch_registered_tool(
    skill_name: str,
    payload: dict[str, Any],
    context: dict[str, Any],
    operation_map: dict[str, str],
) -> dict[str, Any]:
    """Dispatch a high-level Skill through the same validated ToolRegistry.

    The registry is injected by WorkerAgent and removed before a module handler
    receives context, so Skill routing cannot bypass Tool contracts or HTTP
    adapters. ``tool_payload`` is explicit; remaining fields are a convenience
    for direct Skill calls and are filtered only for Skill control fields.
    """
    registry = context.get("_tool_registry")
    if registry is None:
        raise RuntimeError("skill execution requires a ToolRegistry")
    operation = str(payload.get("operation") or "default")
    tool = str(payload.get("tool") or operation_map.get(operation) or "")
    allowed = set(operation_map.values())
    if tool not in allowed:
        raise ValueError(f"skill operation is not allowed: {skill_name}/{operation}")
    tool_payload = payload.get("tool_payload")
    if not isinstance(tool_payload, dict):
        tool_payload = {
            key: value
            for key, value in payload.items()
            if key not in {"operation", "tool", "tool_payload"}
        }
    tool_context = {key: value for key, value in context.items() if key != "_tool_registry"}
    result = await registry.call(tool, tool_payload, tool_context)
    if isinstance(result, dict):
        output = dict(result)
    else:
        output = {"result": result}
    output.update({"skill": skill_name, "skill_operation": operation, "invoked_tool": tool})
    return output


async def m0_governance(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return await _dispatch_registered_tool(
        "yunpai-m0-data-foundation", payload, context,
        {"default": "data_import_run", "ingest": "data_import_run", "preview": "data_import_preview", "resolve": "data_import_resolve", "commit": "data_import_commit"},
    )


async def m1_document_intelligence(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return await _dispatch_registered_tool(
        "yunpai-m1-document-parser", payload, context,
        {"default": "ingest_document", "parse": "ingest_document", "review": "submit_m1_review", "report": "generate_m1_report"},
    )


async def m2_engineering_control(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return await _dispatch_registered_tool(
        "yunpai-m2-bom-sop", payload, context,
        {"default": "run_bom_sop_workflow", "generate": "run_bom_sop_workflow", "history": "search_m2_bom_history", "bom": "generate_m2_bom_controlled", "sop": "generate_m2_sop", "run": "get_m2_run"},
    )


async def m3_material_planning(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return await _dispatch_registered_tool(
        "yunpai-m3-material-planning", payload, context,
        {"default": "run_m3_procurement_requirements", "mrp": "run_m3_procurement_requirements", "readiness": "get_material_readiness_snapshot", "readiness_summary": "get_material_readiness", "plan": "get_m3_procurement_plan", "handoff": "export_m3_procurement_suggestions"},
    )


async def m4_procurement_control(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return await _dispatch_registered_tool(
        "yunpai-m4-procurement", payload, context,
        {"default": "import_m4_purchase_suggestions_json", "import": "import_m4_purchase_suggestions_json", "orders": "list_m4_purchase_orders", "tracking": "list_m4_tracking", "alerts": "list_m4_purchase_alerts", "supply": "query_m4_material_supply_snapshot", "supplier_reply": "parse_m4_supplier_reply"},
    )


async def m5_pmc_control(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return await _dispatch_registered_tool(
        "yunpai-m5-pmc", payload, context,
        {"default": "solve_scheduling", "solve": "solve_scheduling", "schedule": "get_m5_schedule", "progress": "get_m5_pmc_progress", "versions": "list_m5_schedules", "readiness": "get_m5_material_readiness", "replan": "replan_m5_schedule", "advise": "advise_m5_schedule", "intelligent": "run_m5_intelligent_schedule", "dispatch": "dispatch_m5_schedule", "execution": "get_m5_execution_summary", "snapshot": "ingest_m5_planning_snapshot", "procurement": "generate_m5_material_procurement_plan", "report_workload": "report_workload", "bind_worker": "bind_worker_to_order"},
    )


async def m5_lifecycle_control(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    return await _dispatch_registered_tool(
        "yunpai-m5-pmc-lifecycle", payload, context,
        {"default": "get_m5_schedule", "schedule": "get_m5_schedule", "versions": "list_m5_schedules", "replan": "replan_m5_schedule", "dispatch": "dispatch_m5_schedule", "execution": "get_m5_execution_summary", "progress": "get_m5_pmc_progress"},
    )


def build_default_skill_registry() -> SkillRegistry:
    registry = SkillRegistry()
    registry.register(SkillSpec(
        name="business-data-identification",
        description="识别云湃业务资料，抽取订单/BOM/工程文档字段，保留文件哈希和字段级证据，并写入可审核候选库。",
        handler=identify_business_data,
        tags=("upload", "m0", "m1", "evidence", "catalog"),
    ))
    registry.register(SkillSpec(
        name="yunpai-m0-data-foundation",
        description="治理 M0 导入、候选审核、canonical 发布、版本和证据；缺事实时停在可恢复 Gate。",
        handler=m0_governance,
        tags=("m0", "canonical", "evidence", "governance"),
        tools=("data_import_run", "data_import_preview", "data_import_resolve", "data_import_commit"),
    ))
    registry.register(SkillSpec(
        name="yunpai-m1-document-parser",
        description="解析订单、图纸、表格和归档，保留字段级证据并将低置信度结果送人工复核。",
        handler=m1_document_intelligence,
        tags=("m1", "ocr", "document", "review"),
        tools=("ingest_document", "submit_m1_review", "generate_m1_report"),
    ))
    registry.register(SkillSpec(
        name="yunpai-m2-bom-sop",
        description="生成和审查版本化 BOM/SOP 草稿，连接历史检索、工程审核和工艺制品查询。",
        handler=m2_engineering_control,
        tags=("m2", "bom", "sop", "engineering"),
        tools=("run_bom_sop_workflow", "search_m2_bom_history", "generate_m2_bom_controlled", "generate_m2_sop", "get_m2_run"),
    ))
    registry.register(SkillSpec(
        name="yunpai-m3-material-planning",
        description="计算 MRP、物料缺口和齐套快照，输出可审计的 M3→M4 采购需求，不预占库存。",
        handler=m3_material_planning,
        tags=("m3", "mrp", "material", "readiness"),
        tools=("run_m3_procurement_requirements", "get_material_readiness_snapshot", "get_material_readiness", "get_m3_procurement_plan", "export_m3_procurement_suggestions"),
    ))
    registry.register(SkillSpec(
        name="yunpai-m4-procurement",
        description="管理采购建议、采购单审核、供应商回复、供应快照、ETA 跟踪和预警；副作用仍需人工授权。",
        handler=m4_procurement_control,
        tags=("m4", "procurement", "supplier", "tracking"),
        tools=("import_m4_purchase_suggestions_json", "list_m4_purchase_orders", "list_m4_tracking", "list_m4_purchase_alerts", "query_m4_material_supply_snapshot", "parse_m4_supplier_reply"),
    ))
    registry.register(SkillSpec(
        name="yunpai-m5-pmc",
        description="统一 M5 PMC 求解、WIP/资源检查、计划版本、重排、派工、报工和执行摘要；生产发布必须通过 Gate。",
        handler=m5_pmc_control,
        tags=("m5", "pmc", "wip", "schedule", "execution"),
        tools=("solve_scheduling", "get_m5_schedule", "get_m5_pmc_progress", "list_m5_schedules", "get_m5_material_readiness", "replan_m5_schedule", "advise_m5_schedule", "run_m5_intelligent_schedule", "dispatch_m5_schedule", "get_m5_execution_summary", "ingest_m5_planning_snapshot", "generate_m5_material_procurement_plan", "report_workload", "bind_worker_to_order"),
    ))
    registry.register(SkillSpec(
        name="yunpai-m5-pmc-lifecycle",
        description="面向 39085 M5 Flow Board 的版本历史、重排、派工和执行回传操作；只调用已注册 M5 Tool，不伪造生产状态。",
        handler=m5_lifecycle_control,
        tags=("m5", "lifecycle", "flow-board", "dispatch", "execution"),
        tools=("get_m5_schedule", "list_m5_schedules", "replan_m5_schedule", "dispatch_m5_schedule", "get_m5_execution_summary", "get_m5_pmc_progress"),
    ))
    return registry
