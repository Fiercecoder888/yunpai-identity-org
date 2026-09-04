from __future__ import annotations

import re
from typing import Any

from .models import RunState, summarize
from .registry import ToolRegistry
from .workflow_registry import load_workflow
from .llm import QwenRouter
from .skills import SkillRegistry, build_default_skill_registry


INTENT_TO_TOOL = (
    (("导入", "入库", "基础数据"), "data_import_run"),
    (("识别", "解析", "ocr", "图纸"), "ingest_document"),
    (("bom", "sop", "工艺"), "run_bom_sop_workflow"),
    (("mrp", "缺料", "物料需求", "齐套"), "run_m3_procurement_requirements"),
    (("采购单", "采购建议", "供应商"), "import_m4_purchase_suggestions_json"),
    (("排程", "pmc", "计划"), "solve_scheduling"),
)

BUSINESS_DATA_SKILL = "business-data-identification"

# 任务书 5.1 的使用顺序：高阶 Skill 多步提案必须满足此偏序。
SKILL_USAGE_ORDER = (
    "business-data-identification",
    "yunpai-m1-document-parser",
    "yunpai-m0-data-foundation",
    "yunpai-m2-bom-sop",
    "yunpai-m3-material-planning",
    "yunpai-m4-procurement",
    "yunpai-m5-pmc",
    "yunpai-m5-pmc-lifecycle",
)

INTENT_TO_SKILL = (
    (("主数据治理", "canonical", "资料治理"), "yunpai-m0-data-foundation"),
    (("文档智能", "文档审核", "解析报告"), "yunpai-m1-document-parser"),
    (("工程控制", "bom审核", "sop审核"), "yunpai-m2-bom-sop"),
    (("物料齐套", "物料计划", "mrp分析"), "yunpai-m3-material-planning"),
    (("采购跟踪", "供应商跟踪", "采购预警"), "yunpai-m4-procurement"),
    (("排程求解", "智能排程", "排程检查", "排程就绪", "资源负载"), "yunpai-m5-pmc"),
    (("排程生命周期", "排程版本", "生产执行", "派工", "报工", "执行回传", "flow board"), "yunpai-m5-pmc-lifecycle"),
)


class PlannerAgent:
    """总规划 Agent：只做意图、路径和依赖规划，不执行工具。"""

    def __init__(self, router: QwenRouter | None = None, skills: SkillRegistry | None = None) -> None:
        self.router = router or QwenRouter()
        self.skills = skills or build_default_skill_registry()
        # QwenRouter 构建 prompt 时读取同一 Skill catalog（含版本），模型只做提案。
        try:
            self.router.skills = self.skills  # type: ignore[attr-defined]
        except Exception:
            pass

    def plan(self, request: dict[str, Any], registry: ToolRegistry) -> dict[str, Any]:
        return self._deterministic_plan(request, registry, self.skills)

    async def aplan(self, request: dict[str, Any], registry: ToolRegistry) -> dict[str, Any]:
        """Ask Qwen for an intent/route proposal, then validate it against local contracts."""
        fallback = self._deterministic_plan(request, registry, self.skills)
        model_result = await self.router.classify(request, registry)
        if self._business_skill_requested(request):
            decision = model_result.get("decision") if model_result.get("ok") else None
            return {
                **fallback,
                "intent": {"name": (decision or {}).get("intent", "业务资料识别与落库"), "confidence": (decision or {}).get("confidence", 1.0), "source": "qwen_skill_override" if decision else "deterministic_skill"},
                "route_decision": {"source": "qwen_skill_override" if decision else "deterministic_skill", "model_status": model_result.get("status"), "model_proposal": decision, "skill": BUSINESS_DATA_SKILL},
                "model": model_result.get("model", {}),
            }
        explicit = bool(request.get("workflow") or request.get("tool") or isinstance(request.get("tools"), list))
        decision = model_result.get("decision") if model_result.get("ok") else None
        if explicit or not isinstance(decision, dict):
            source = "explicit" if explicit else "deterministic_fallback"
            intent = {"name": fallback.get("route", "chat"), "confidence": 1.0 if explicit else 0.0, "source": source}
            return {**fallback, "intent": intent, "route_decision": {"source": source, "model_status": model_result.get("status"), "model_error": model_result.get("error")}, "model": model_result.get("model", {})}
        has_unparsed_order_attachment = (
            not request.get("document")
            and any(isinstance(item, dict) and item.get("kind") == "order" for item in request.get("attachments", []))
        )
        if decision.get("route") == "free" and has_unparsed_order_attachment and any(
            tool in {"data_import_preview", "data_import_resolve"} for tool in decision.get("tools", [])
        ):
            return {
                **fallback,
                "intent": {"name": decision.get("intent", "订单解析"), "confidence": decision.get("confidence", 0.0), "source": "qwen_rejected"},
                "route_decision": {
                    "source": "deterministic_fallback",
                    "model_status": "invalid_attachment_plan",
                    "model_proposal": decision,
                    "fallback_reason": "订单附件尚未生成 M0 batch，无法调用 preview/resolve",
                },
                "model": model_result.get("model", {}),
            }
        proposed = self._model_plan(decision, registry, self.skills)
        if isinstance(proposed, dict) and proposed.get("_invalid_reason"):
            invalid_reason = str(proposed["_invalid_reason"])
            return {**fallback, "intent": {"name": decision.get("intent", "unknown"), "confidence": decision.get("confidence", 0.0), "source": "qwen_rejected"}, "route_decision": {"source": "deterministic_fallback", "model_status": "invalid_decision", "model_proposal": decision, "reject_reason": invalid_reason}, "model": model_result.get("model", {})}
        if proposed is None:
            return {**fallback, "intent": {"name": decision.get("intent", "unknown"), "confidence": decision.get("confidence", 0.0), "source": "qwen_rejected"}, "route_decision": {"source": "deterministic_fallback", "model_status": "invalid_decision", "model_proposal": decision}, "model": model_result.get("model", {})}
        if proposed.get("route") == "chat" and not proposed.get("response"):
            proposed["response"] = self._chat_fallback(str(request.get("message") or request.get("task") or "").lower())
        return {**proposed, "intent": {"name": decision["intent"], "confidence": decision["confidence"], "source": "qwen"}, "route_decision": {"source": "qwen", "model_status": model_result.get("status"), "model_proposal": decision}, "model": model_result.get("model", {})}

    @staticmethod
    def _model_plan(decision: dict[str, Any], registry: ToolRegistry, skills: SkillRegistry | None = None) -> dict[str, Any] | None:
        route = decision.get("route")
        if route == "chat":
            return {"route": "chat", "steps": [], "reason": decision.get("reason") or "Qwen 判定为解释性对话", "response": decision.get("answer") or ""}
        if route == "workflow":
            workflow = load_workflow("m0_m5")
            return {"route": "workflow", "steps": [{**step, "mode": "workflow"} for step in workflow["steps"]], "workflow_id": workflow["workflow_id"], "workflow_version": workflow["version"], "reason": decision.get("reason") or "Qwen 判定为 M0→M5 受控业务目标"}
        if route == "free":
            requested_tools = [str(name) for name in decision.get("tools", [])]
            requested_skills = [str(name) for name in decision.get("skills", [])] if skills else []
            invalid_tools = [name for name in requested_tools if name not in registry.specs]
            invalid_skills = [name for name in requested_skills if skills is None or name not in skills.specs]
            if invalid_tools or invalid_skills:
                return {"_invalid_reason": f"模型提案含未注册工具或 Skill: tools={invalid_tools} skills={invalid_skills}"}
            tools = [name for name in requested_tools if name in registry.handlers]
            if any(name not in registry.handlers for name in requested_tools):
                return {"_invalid_reason": "模型提案包含未绑定 handler 的工具，拒绝执行"}
            skill_names = [name for name in requested_skills if skills and name in skills.specs]
            if not tools and not skill_names:
                return None
            if not PlannerAgent._respects_skill_order(skill_names):
                return {"_invalid_reason": f"Skill 提案违反任务书使用顺序: {skill_names}"}
            steps = [{"id": f"free-{index}", "module": registry.specs[name].module, "tool": name, "mode": "free", "http_method": registry.specs[name].method} for index, name in enumerate(tools)]
            steps.extend({"id": f"skill-{index}", "module": "orchestrator", "tool": name, "kind": "skill", "mode": "free"} for index, name in enumerate(skill_names, start=len(steps)))
            return {"route": "free", "steps": steps, "reason": decision.get("reason") or "Qwen 路由到自由工具/Skill 路径"}
        return None

    @staticmethod
    def _respects_skill_order(skill_names: list[str]) -> bool:
        """多个高阶 Skill 提案必须满足 SKILL_USAGE_ORDER 偏序；单 Skill 恒通过。"""
        if len(skill_names) <= 1:
            return True
        positions = [SKILL_USAGE_ORDER.index(name) for name in skill_names if name in SKILL_USAGE_ORDER]
        return positions == sorted(positions)

    def _deterministic_plan(self, request: dict[str, Any], registry: ToolRegistry, skills: SkillRegistry | None = None) -> dict[str, Any]:
        text = str(request.get("message") or request.get("task") or "").lower()
        if self._business_skill_requested(request) and skills and BUSINESS_DATA_SKILL in skills.specs:
            return {"route": "free", "steps": [{"id": "skill-0", "module": "orchestrator", "tool": BUSINESS_DATA_SKILL, "kind": "skill", "mode": "free"}], "reason": "识别为业务资料识别与候选入库请求"}
        requested_skill = request.get("skill")
        if requested_skill:
            if not skills or requested_skill not in skills.specs:
                raise ValueError(f"未注册 Skill: {requested_skill}")
            return {"route": "free", "steps": [{"id": "skill-0", "module": "orchestrator", "tool": str(requested_skill), "kind": "skill", "mode": "free"}], "reason": f"显式选择已注册 Skill: {requested_skill}"}
        if skills:
            upload_mode = str(request.get("upload_mode") or request.get("business_data_mode") or "")
            if upload_mode in {"master_data", "directory"} and BUSINESS_DATA_SKILL in skills.specs:
                return {"route": "free", "steps": [{"id": "skill-0", "module": "orchestrator", "tool": BUSINESS_DATA_SKILL, "kind": "skill", "mode": "free"}], "reason": f"显式上传模式 {upload_mode} 绑定业务资料识别 Skill"}
            for keywords, skill_name in INTENT_TO_SKILL:
                if skill_name in skills.specs and any(keyword in text for keyword in keywords):
                    return {"route": "free", "steps": [{"id": "skill-0", "module": "orchestrator", "tool": skill_name, "kind": "skill", "mode": "free"}], "reason": f"语义匹配高阶 Skill: {skill_name}"}
        full = request.get("workflow") == "m0_m5" or "全链路" in text or all(word in text for word in ("订单", "采购", "排程"))
        if full:
            workflow = load_workflow("m0_m5")
            steps = [{**step, "mode": "workflow"} for step in workflow["steps"]]
            return {"route": "workflow", "steps": steps, "workflow_id": workflow["workflow_id"], "workflow_version": workflow["version"], "reason": "识别为 M0→M5 受控业务目标"}
        upload_mode = str(request.get("upload_mode") or request.get("business_data_mode") or "")
        if upload_mode == "order" and "ingest_document" in registry.specs:
            return {"route": "free", "steps": [{"id": "free-0", "module": registry.specs["ingest_document"].module, "tool": "ingest_document", "mode": "free", "http_method": registry.specs["ingest_document"].method}], "reason": "显式上传模式 order 绑定订单解析工具"}

        requested_tools: list[str] = []
        if isinstance(request.get("tools"), list):
            requested_tools.extend(str(item) for item in request["tools"])
        if request.get("tool"):
            requested_tools.append(str(request["tool"]))
        if not requested_tools:
            exact = re.search(r"\b(" + "|".join(re.escape(name) for name in registry.specs) + r")\b", text)
            if exact:
                requested_tools.append(exact.group(1))
            else:
                for keywords, tool in INTENT_TO_TOOL:
                    if any(keyword in text for keyword in keywords):
                        requested_tools.append(tool)
                        break
        if requested_tools:
            unknown = [name for name in requested_tools if name not in registry.specs]
            if unknown:
                raise ValueError(f"未注册工具: {', '.join(unknown)}")
            return {
                "route": "free",
                "steps": [
                    {
                        "id": f"free-{index}", "module": registry.specs[name].module,
                        "tool": name, "mode": "free", "http_method": registry.specs[name].method,
                    }
                    for index, name in enumerate(requested_tools)
                ],
                "reason": "ReAct 路由到显式或语义匹配工具",
            }
        return {"route": "chat", "steps": [], "reason": "当前消息不需要业务工具", "response": self._chat_fallback(text)}

    @staticmethod
    def _chat_fallback(text: str) -> str:
        if any(word in text for word in ("能做什么", "功能", "怎么用", "帮助")):
            return "我可以协助处理订单、识别业务资料、解析订单字段、生成 BOM/SOP 草稿、计算物料需求、形成采购建议和安排生产排程。涉及数据发布、采购和排程生效时，会先进入人工确认 Gate。"
        if any(word in text for word in ("你好", "您好", "嗨")):
            return "你好，我是云湃制造业务 Agent。你可以直接描述目标，或上传订单、BOM、SOP 和其他业务资料。"
        return "我已收到你的问题。请补充具体的订单、物料、采购、工程或排程事项，我会给出处理建议或进入对应工作流。"

    @staticmethod
    def _business_skill_requested(request: dict[str, Any]) -> bool:
        text = str(request.get("message") or request.get("task") or "").lower()
        if bool(request.get("business_data_root") or request.get("root_path") or request.get("business_data_mode")):
            return True
        # 基础资料/业务资料上传显式绑定 business-data-identification，不依赖文案猜测。
        upload_mode = str(request.get("upload_mode") or "")
        upload_items = list(request.get("documents", [])) + list(request.get("attachments", []))
        has_upload = any(isinstance(item, dict) and item.get("content_b64") for item in upload_items)
        has_order_kind = any(isinstance(item, dict) and item.get("kind") in {"order", "directory"} for item in upload_items)
        has_master_data_kind = any(isinstance(item, dict) and item.get("kind") == "master_data" for item in upload_items)
        if upload_mode in {"master_data", "directory"}:
            return True
        if has_master_data_kind:
            return True
        if has_upload and not has_order_kind and any(keyword in text for keyword in ("基础资料", "业务资料", "业务数据", "资料识别", "识别并落库", "文件落库", "主数据", "设备资料", "人员资料", "库存资料", "供应商资料")):
            return True
        return any(keyword in text for keyword in ("业务资料", "业务数据", "资料识别", "识别并落库", "文件落库"))


class WorkerAgent:
    """Worker Agent：只能调用 ToolRegistry 中已注册并绑定的能力。"""

    def __init__(self, registry: ToolRegistry, skills: SkillRegistry | None = None) -> None:
        self.registry = registry
        self.skills = skills or build_default_skill_registry()
        self.skills.validate_tools(self.registry.specs)

    async def run(self, state: RunState, step: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        tool = step["tool"]
        if step.get("kind") == "skill":
            result = await self.skills.call(tool, payload, {"run_id": state["run_id"], "task_id": state["task_id"], "tenant_id": state.get("tenant_id"), "_tool_registry": self.registry})
            return {"module": "orchestrator", "tool": tool, "result": result, "input_summary": summarize(payload), "output_summary": summarize(result)}
        spec = self.registry.specs[tool]
        result = await self.registry.call(tool, payload, {
            "run_id": state["run_id"], "task_id": state["task_id"],
            "tenant_id": state.get("tenant_id"),
        })
        return {
            "module": spec.module, "tool": tool, "result": result,
            "input_summary": summarize(payload), "output_summary": summarize(result),
        }


def result_data(result: dict[str, Any]) -> dict[str, Any]:
    data = result.get("data")
    return data if isinstance(data, dict) else result


class ReviewerAgent:
    """审查 Agent：执行确定性验证并决定继续、Gate 或失败关闭。"""

    # These tools only stage a candidate/draft and are reviewed immediately after execution.
    _POST_REVIEWED_DRAFT_TOOLS = {
        "data_import_run", "business-data-identification", "ingest_document", "run_bom_sop_workflow", "solve_scheduling",
    }
    _READ_ONLY_SKILL_OPERATIONS = {
        "yunpai-m0-data-foundation": {"preview"},
        "yunpai-m1-document-parser": {"report"},
        "yunpai-m3-material-planning": {"readiness", "readiness_summary", "plan", "handoff"},
        "yunpai-m4-procurement": {"orders", "tracking", "alerts", "supply", "supplier_reply"},
        "yunpai-m5-pmc": {"schedule", "progress", "versions", "readiness", "advise", "intelligent", "execution"},
        "yunpai-m5-pmc-lifecycle": {"default", "schedule", "progress", "versions", "execution"},
    }

    def preflight(self, step: dict[str, Any], state: RunState) -> dict[str, Any] | None:
        if step.get("mode") != "free" or step["id"] in state.get("authorized_steps", []):
            return None
        if step.get("kind") == "skill":
            skill_payload = state.get("request", {}).get("skill_payload")
            operation = str(skill_payload.get("operation") or "default") if isinstance(skill_payload, dict) else "default"
            if operation in self._READ_ONLY_SKILL_OPERATIONS.get(str(step["tool"]), set()):
                return None
        method = str(step.get("http_method") or "POST").upper()
        if method not in {"GET", "HEAD", "OPTIONS"} and step["tool"] not in self._POST_REVIEWED_DRAFT_TOOLS:
            return {
                "type": "authorization", "module": step["module"], "tool": step["tool"],
                "message": "该自由工具可能产生持久化或外部副作用，必须在执行前授权",
                "actions": ["批准执行", "终止"], "pre_execution": True,
            }
        return None

    def review(self, tool: str, module: str, result: dict[str, Any]) -> dict[str, Any]:
        # High-level Skills flatten the underlying Tool result and identify it
        # explicitly so the same deterministic Gate rules still apply.
        effective_tool = str(result.get("invoked_tool") or tool) if isinstance(result, dict) else tool
        effective_module = str(result.get("invoked_module") or module) if isinstance(result, dict) else module
        data = result_data(result)
        errors = result.get("errors") if isinstance(result.get("errors"), list) else []
        if result.get("success") is False or result.get("code") == "BLOCKED_INPUT":
            message = errors[0].get("message") if errors and isinstance(errors[0], dict) else result.get("message", "缺少权威输入")
            return self._gate("data", effective_module, effective_tool, message, ["补充数据", "终止"])
        if effective_tool in {"data_import_run", "business-data-identification"}:
            if result.get("status") == "failed":
                return {"approved": False, "terminal": True, "error": {"code": "IMPORT_FAILED", "message": "M0 未生成可审核候选"}}
            message = "业务资料候选已写入识别库，必须审核后才能进入 M0 canonical 发布" if effective_tool == "business-data-identification" else "M0 候选必须审核后才能发布 canonical 事实"
            return self._gate("candidate", effective_module, effective_tool, message, ["批准候选", "补充裁决", "终止"])
        if effective_tool == "ingest_document" and (result.get("needs_review") or float(result.get("overall_confidence") or 0) < 0.8):
            return self._gate("review", effective_module, effective_tool, "M1 解析置信度不足或存在字段缺口", ["修正并重试", "接受结果", "终止"])
        if effective_tool == "run_bom_sop_workflow":
            if result.get("status") == "human_input_required":
                return self._gate("data", effective_module, effective_tool, "M2 缺少产品/BOM 权威输入", ["补充数据", "终止"])
            if result.get("status") == "draft_created":
                return self._gate("engineering", effective_module, effective_tool, "BOM/SOP 草稿必须由工程人员批准", ["批准 BOM/SOP", "修改后重试", "终止"])
        if effective_tool == "run_m3_procurement_requirements" and not data.get("lines") and not data.get("shortage_lines"):
            return self._gate("data", effective_module, effective_tool, "M3 缺少可计算的 BOM 行", ["补充 BOM 后重试", "终止"])
        if effective_tool == "import_m4_purchase_suggestions_json":
            suggestions = result.get("suggestions") or result.get("items") or []
            missing_supplier = any(not item.get("supplier_name") for item in suggestions if isinstance(item, dict))
            if suggestions and missing_supplier:
                return self._gate("procurement", effective_module, effective_tool, "采购建议缺少权威供应商或交期", ["补充供应商后重试", "保留草稿继续", "终止"])
        if effective_tool == "solve_scheduling" and data.get("lifecycle_status") == "draft":
            return self._gate("apply", effective_module, effective_tool, "排程候选验证通过，但设置 current/发布仍需人工批准", ["发布", "重排", "终止"])
        return {"approved": True, "terminal": False, "gate": None}

    @staticmethod
    def _gate(gate_type: str, module: str, tool: str, message: str, actions: list[str]) -> dict[str, Any]:
        return {"approved": False, "terminal": False, "gate": {"type": gate_type, "module": module, "tool": tool, "message": message, "actions": actions}}
