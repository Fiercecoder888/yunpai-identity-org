from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("yunpai.agent")


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class QwenConfig:
    enabled: bool = True
    base_url: str = "http://127.0.0.1:8088/v1"
    model: str = "qwen3.8-27b"
    api_key: str = ""
    timeout_s: float = 45.0

    @classmethod
    def from_env(cls) -> "QwenConfig":
        return cls(
            enabled=_env_bool("QWEN_ROUTER_ENABLED", True),
            base_url=os.getenv("QWEN_BASE_URL", "http://127.0.0.1:18085/v1").rstrip("/"),
            model=os.getenv("QWEN_MODEL", "qwen3.6-35b-a3b-fp8-gpu0-200k"),
            api_key=os.getenv("QWEN_API_KEY", ""),
            timeout_s=float(os.getenv("QWEN_TIMEOUT_S", "45")),
        )

    def public(self) -> dict[str, Any]:
        return {
            "provider": "qwen",
            "model": self.model,
            "base_url": self.base_url,
            "enabled": self.enabled,
            "configured": bool(self.api_key),
        }


class QwenRouter:
    """OpenAI-compatible Qwen client used only for intent and route proposals."""

    def __init__(self, config: QwenConfig | None = None) -> None:
        self.config = config or QwenConfig.from_env()

    async def classify(self, request: dict[str, Any], registry: Any, skills: Any = None) -> dict[str, Any]:
        started = time.perf_counter()
        metadata = self.config.public()
        if not self.config.enabled:
            return {"ok": False, "status": "disabled", "model": {**metadata, "status": "disabled"}}
        if not self.config.api_key:
            return {"ok": False, "status": "not_configured", "model": {**metadata, "status": "not_configured"}}
        try:
            import httpx

            catalog = [
                {"name": spec.name, "module": spec.module, "method": spec.method, "version": getattr(spec, "version", "")}
                for spec in registry.specs.values()
            ]
            if skills is None:
                skills = getattr(self, "skills", None)
            skill_catalog = skills.catalog() if skills is not None and hasattr(skills, "catalog") else []
            prompt = self._prompt(request, catalog, skill_catalog)
            headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
            body = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": self._system_prompt()},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0,
                "max_tokens": 512,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": False},
                "response_format": {"type": "json_object"},
            }
            # trust_env=False prevents an HTTP proxy from intercepting the private model address.
            async with httpx.AsyncClient(timeout=self.config.timeout_s, trust_env=False) as client:
                response = await client.post(f"{self.config.base_url}/chat/completions", headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
            content = self._content(payload)
            decision = self._parse_decision(content)
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.info("qwen.intent_route status=ok model=%s latency_ms=%s route=%s tools=%s", self.config.model, elapsed, decision.get("route"), decision.get("tools", []))
            return {"ok": True, "status": "ok", "decision": decision, "model": {**metadata, "status": "ok", "latency_ms": elapsed}}
        except Exception as exc:
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.warning("qwen.intent_route status=error model=%s latency_ms=%s error=%s", self.config.model, elapsed, exc)
            return {"ok": False, "status": "error", "error": str(exc), "model": {**metadata, "status": "error", "latency_ms": elapsed}}

    @staticmethod
    def _system_prompt() -> str:
        return (
            "你是云湃制造系统的 Planner 路由器。只负责识别用户意图和选择执行路径，不执行工具。"
            "必须只输出一个 JSON 对象，不要 Markdown 或思维过程。route 必须是字面值 workflow、free、chat，绝对不能使用 production_planning、erp 或其他自定义路由名。"
            "workflow 仅用于完整 M0 到 M5 订单/采购/排程主链；free 用于一个或多个已注册工具或已注册高阶 Skill；chat 用于解释性对话。"
            "JSON 字段必须为 intent、route、tools、confidence、reason；route=chat 时必须额外返回 answer，用中文直接回答用户问题。可选 skills 字段用于选择高阶 Skill，只能从给定 skill catalog 中按 name 精确选择。"
            "route=free 时还要返回 args 对象：{\"工具名\": {该工具的入参}}，参数只能来自用户原话，缺失就留空不要编造。"
            "疑问句不是命令，但要先分清两类："
            "①纯能力/可能性提问——没有点明具体对象（人名/账号/组织名），也没有让你现在就去做的，例如「能创建品保的账号吗？」「可以建班组吗？」「怎么给工人建号？」「能不能给员工建品保账号」→ route=chat、tools=[]，"
            "answer 用中文直接回答（能/不能 + 一句怎么做，缺具体对象就顺口问一句给谁做），绝对不要选工具执行；"
            "②礼貌请求——已经点明具体对象（人名/账号/组织名）并说了要做什么，只是用了「能不能/可以帮我/麻烦你」的语气，例如「能不能帮我把刘福的品保角色加上？」「可以帮我把张伟调到1班组吗？」「麻烦给王五开个工人号」→ 按执行请求处理：route=free，正常选工具并给出 args，和祈使句完全一样，绝对不要回 chat 敷衍。"
            "礼貌请求的 args 示例：「能不能帮我把刘福的品保角色加上？」→ route=free, tools=[\"assign_identity_account\"], "
            "args={\"assign_identity_account\":{\"user_id\":\"刘福\",\"role_codes\":[\"quality-assurance\"],\"role_mode\":\"add\"}}；"
            "「可以帮我把张伟调到1班组吗？」→ route=free, tools=[\"assign_identity_account\"], "
            "args={\"assign_identity_account\":{\"user_id\":\"张伟\",\"org_name\":\"1班组\"}}；"
            "「麻烦给王五开个工人号」→ route=free, tools=[\"create_identity_user\"], "
            "args={\"create_identity_user\":{\"display_name\":\"王五\",\"role_codes\":[\"worker\"]}}。"
            "判断要点一句话：「能不能/可以吗」只影响语气，不影响是否执行；只要句子里点了具体的人/组织/账号并说了要做什么，就照做。"
            "祈使句（「给张伟建号」「把张伟分到1班组」「创建1班组」「给王五安排小组长」）和上面第②类礼貌请求都要 route=free 并选工具。"
            "凡是身份/账号类请求（建号、分配账号、查账号）都必须选对应工具并给出 args，不能只给工具名。示例："
            "「给张伟建个工人账号 worker100，放在装配班组」→ route=free, tools=[\"create_identity_user\"], "
            "args={\"create_identity_user\":{\"user_id\":\"worker100\",\"display_name\":\"张伟\",\"role_codes\":[\"worker\"],\"org_name\":\"装配班组\"}}；"
            "「给张一申请一个工人账户 worker101」→ tools=[\"create_identity_user\"], "
            "args={\"create_identity_user\":{\"user_id\":\"worker101\",\"display_name\":\"张一\",\"role_codes\":[\"worker\"]}}；"
            "「给5个工人分配账号，他们分别是赵一 李二 王三 孙四 高五」→ tools=[\"create_identity_user\"], "
            "args={\"create_identity_user\":{\"people\":[{\"display_name\":\"赵一\"},{\"display_name\":\"李二\"},{\"display_name\":\"王三\"},{\"display_name\":\"孙四\"},{\"display_name\":\"高五\"}],\"role_codes\":[\"worker\"]}}"
            "（人数必须与用户说的一致，不要只建一个人）；"
            "「把 worker100 调到装配班组，让他当组长」→ tools=[\"assign_identity_account\"], "
            "args={\"assign_identity_account\":{\"user_id\":\"worker100\",\"org_name\":\"装配班组\",\"role_codes\":[\"team-leader\"]}}；"
            "「给 worker100 加上品保角色」→ tools=[\"assign_identity_account\"], "
            "args={\"assign_identity_account\":{\"user_id\":\"worker100\",\"role_codes\":[\"quality-assurance\"],\"role_mode\":\"add\"}}"
            "（role_mode=add 表示在原角色上追加；改成/换成某个角色则用默认的 set）；"
            "「现在有哪些账号 / 有哪些工人」→ tools=[\"list_identity_users\"], args={\"list_identity_users\":{}}。"
            "建组织（公司/部门/班组）用 create_org_node，org_type 只能取 company、dept、team；父节点用 parent_name 或 parent_id。示例："
            "「创建1班组」→ route=free, tools=[\"create_org_node\"], args={\"create_org_node\":{\"name\":\"1班组\",\"org_type\":\"team\"}}；"
            "「新建生产部」→ tools=[\"create_org_node\"], args={\"create_org_node\":{\"name\":\"生产部\",\"org_type\":\"dept\"}}；"
            "「在装配班组下面建个2班组」→ tools=[\"create_org_node\"], args={\"create_org_node\":{\"name\":\"2班组\",\"org_type\":\"team\",\"parent_name\":\"装配班组\"}}。"
            "一句话里有多个动作时，tools 必须按执行顺序一次给全（不要只给最后一个），args 里每个工具各给一份。示例："
            "「创建1班组 小组长是王五 把张伟分到1班组里面」→ tools=[\"create_org_node\",\"create_identity_user\",\"assign_identity_account\"], "
            "args={\"create_org_node\":{\"name\":\"1班组\",\"org_type\":\"team\"},\"create_identity_user\":{\"display_name\":\"王五\",\"role_codes\":[\"team-leader\"],\"org_name\":\"1班组\"},"
            "\"assign_identity_account\":{\"user_id\":\"张伟\",\"org_name\":\"1班组\"}}"
            "（先建组织、再建账号、最后把已有的人挂进组织；assign_identity_account 没有账号 id 时就把姓名写进 user_id（如 user_id 写「张伟」，也可以额外带上 display_name），工具会按账号或姓名匹配，匹配不到会给出人话提示，绝对不要瞎编账号 id；"
            "某个参数用户没给就留空，系统会追问）。"
            "role_codes 必须用角色 code，不能写中文：worker、team-leader、quality-assurance、planner、engineer、data-steward、release-manager、org-admin、factory-director；"
            "用户说中文角色也要翻译，例如「品保」→quality-assurance、「组长/小组长」→team-leader、「计划员」→planner、「厂长」→factory-director。"
            "assign_identity_account 支持按名称挂组织（org_name）和 role_mode（set 覆盖 / add 追加）。"
            "区分规则：给了姓名名单或人数＝建号（create_identity_user，多人用 people）；只对已有账号要求换组织/加角色＝调岗（assign_identity_account）；只问现状＝查号（list_identity_users）；"
            "建班组/建部门/建公司＝create_org_node；建组织同时还要建人/挂人＝按上面复合请求一次给全多个工具。"
            "同一个工具在一句话里只能用一次（tools 里不能出现重复的工具名，系统按工具名传参，重复会互相覆盖）。"
            "如果用户一句话要求用同一个工具做两次（例如「新建品质部和品质二部」「建两个班组」「把张伟和李娜都调到1班组」），"
            "**不要重复列该工具，也不要只执行其中第一个动作**：route=chat，用中文提醒用户分两步说，并给出示例，"
            "例如「一次只能建一个组织，请先「新建品质部」，再补一句「在品质部下建个出货检验组」」。"
            "例外：一次给多个人的账号用 create_identity_user 的 people 数组，一次调用即可，不需要拆。"
            "如果用户没说清关键信息（例如只说「帮我建几个工人账号」），仍然要选出最可能的工具、把已知参数放进 args、缺的留空（不要编造），系统会据此向用户追问；"
            "只有当请求与账号管理无关、用户是在做纯能力/可能性提问（见上面第①类疑问句规则）、或完全无法判断该用哪个工具时，才 route=chat，answer 用中文一次把缺的信息问清楚。"
            "tools 只能从给定 catalog 选择。skill 名称必须与 catalog 中的 name 完全一致，不能自造或拼接版本号。"
            "上传订单文件时优先 workflow 或 ingest_document；上传基础资料/业务资料（BOM、SOP、设备、工位、人员、库存、供应商、财务、目录批量）时必须在 skills 中给出 business-data-identification。"
            "route=chat 时 answer 必须是**人能直接看懂的中文**：绝对不要出现工具名、参数名、字段名、JSON、角色 code（写「品保」「组长」「工人」这种中文角色名），"
            "也不要提「工具」「接口」「系统」这类内部说法，就像同事之间说话一样。"
            "请求里的 caller 是**当前登录人**的信息（user_id/display_name/role_names/permissions/org_path）。"
            "用户问「我是谁 / 我的角色是什么 / 我有什么权限 / 我在哪个部门」时，直接用 caller 回答（例如「你是厂长（赵厂长），角色：厂长、组织管理员」），"
            "route=chat、tools=[]，**不要让用户提供账号、也不要调用工具查自己**；caller 为空（无身份）时才说明需要登录。"
        )

    @staticmethod
    def _prompt(request: dict[str, Any], catalog: list[dict[str, Any]], skill_catalog: list[dict[str, Any]] | None = None) -> str:
        message = str(request.get("message") or request.get("task") or "")
        file_items = list(request.get("documents", [])) + list(request.get("attachments", []))
        file_names = [str(item.get("filename", "")) for item in file_items if isinstance(item, dict)]
        skill_names = [str(skill) for skill in (request.get("skills") or [])] if isinstance(request.get("skills"), list) else []
        return json.dumps({
            "message": message,
            "caller": request.get("caller") or None,
            "uploaded_files": file_names,
            "catalog": catalog,
            "skills": skill_catalog or [{"name": "business-data-identification", "description": "识别业务资料并写入可审核候选库；不直接发布 M0 canonical 事实"}],
            "requested_skills": skill_names,
        }, ensure_ascii=False)

    @staticmethod
    def _content(payload: dict[str, Any]) -> str:
        choices = payload.get("choices") or []
        if not choices or not isinstance(choices[0], dict):
            raise ValueError("Qwen response has no choices")
        message = choices[0].get("message") or {}
        content = message.get("content", "") if isinstance(message, dict) else ""
        if isinstance(content, list):
            content = "".join(str(part.get("text", "")) if isinstance(part, dict) else str(part) for part in content)
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Qwen response has empty content")
        return content

    @staticmethod
    def _parse_decision(content: str) -> dict[str, Any]:
        cleaned = content.strip()
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL).strip()
        try:
            value = json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
            if not match:
                raise ValueError("Qwen response is not valid JSON")
            value = json.loads(match.group(0))
        if not isinstance(value, dict):
            raise ValueError("Qwen route decision must be an object")
        route = value.get("route")
        if route not in {"workflow", "free", "chat"}:
            raise ValueError(f"invalid Qwen route: {route}")
        tools = value.get("tools", [])
        if not isinstance(tools, list) or not all(isinstance(tool, str) for tool in tools):
            raise ValueError("Qwen tools must be a string array")
        try:
            confidence = max(0.0, min(1.0, float(value.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0.0
        return {
            "intent": str(value.get("intent") or "unknown"),
            "route": route,
            "tools": tools,
            "skills": [str(skill) for skill in value.get("skills", [])] if isinstance(value.get("skills", []), list) else [],
            "confidence": confidence,
            "reason": str(value.get("reason") or ""),
            "answer": str(value.get("answer") or ""),
            "args": value.get("args") if isinstance(value.get("args"), dict) else {},
        }

    async def map_to_canonical(self, sample: dict[str, Any]) -> dict[str, Any]:
        """把文件样本映射成 canonical 记录（多模态：表格看表头/行，图片/PDF 看图）。

        只做「理解 + 映射 + 分类」，数值从文件照抄；结构由调用方经
        ``canonical_schema.validate_canonical`` 确定性校验。
        """
        started = time.perf_counter()
        metadata = self.config.public()
        if not self.config.enabled:
            return {"ok": False, "status": "disabled", "model": {**metadata, "status": "disabled"}}
        if not self.config.api_key:
            return {"ok": False, "status": "not_configured", "model": {**metadata, "status": "not_configured"}}
        try:
            import httpx

            headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
            body = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": self._canonical_system_prompt()},
                    {"role": "user", "content": self._canonical_prompt(sample)},
                ],
                "temperature": 0,
                "max_tokens": 8192,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": False},
                "response_format": {"type": "json_object"},
            }
            async with httpx.AsyncClient(timeout=self.config.timeout_s, trust_env=False) as client:
                response = await client.post(f"{self.config.base_url}/chat/completions", headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
            decision = self._parse_canonical(self._content(payload))
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.info("qwen.map_to_canonical status=ok model=%s latency_ms=%s entity_type=%s records=%s", self.config.model, elapsed, decision.get("entity_type"), len(decision.get("records", [])))
            return {"ok": True, "status": "ok", "decision": decision, "model": {**metadata, "status": "ok", "latency_ms": elapsed}}
        except Exception as exc:
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.warning("qwen.map_to_canonical status=error model=%s latency_ms=%s error=%s", self.config.model, elapsed, exc)
            return {"ok": False, "status": "error", "error": str(exc), "model": {**metadata, "status": "error", "latency_ms": elapsed}}

    async def guide_chat(self, *, scale: str | None, departments: list[str],
                         assignments: list[dict[str, Any]], roster: list[dict[str, Any]],
                         message: str, roles: list[dict[str, Any]],
                         permissions: list[dict[str, Any]]) -> dict[str, Any]:
        """引导AI 对话判断（F-015：结构与分配判断交给模型，代码只做模板）。

        模型只产出**扁平数据**（部门名单 + 人员分配，人员带所属部门），组织树
        的绘制由前端模板完成；首轮（needs_scale）返回三档规模的建议部门名单。
        返回 ``{ok, reply, scale, needs_scale, confirm, departments, assignments,
        scale_departments}``。确认落地由调用方在 confirm=true 时执行。
        """
        started = time.perf_counter()
        metadata = self.config.public()
        if not self.config.enabled:
            return {"ok": False, "status": "disabled", "model": {**metadata, "status": "disabled"}}
        try:
            import httpx

            prompt = json.dumps({
                "current_scale": scale,
                "current_departments": list(departments or []),
                "current_assignments": list(assignments or []),
                "roster": roster,
                "user_message": message,
                "roles": roles,
                "permissions": permissions,
            }, ensure_ascii=False)
            body = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": (
                        "你是云湃制造系统的组织架构引导助手。你会收到：当前部门名单、当前人员分配（每人含姓名/"
                        "角色/所属部门）、花名册（姓名/岗位/部门）、可分配角色及含义、用户最新一句话。"
                        "判断用户意图，只输出一个 JSON 对象，字段：\n"
                        "reply（给用户的中文回复，简短自然）\n"
                        "scale（用户选定/变更规模时 small|medium|large，否则 null）\n"
                        "needs_scale（还不知道规模、需要先让用户选时 true，否则 false）\n"
                        "confirm（用户明确要落地当前架构，如“就这样/确认/好/可以/落地”时为 true，否则 false）\n"
                        "departments（更新后的部门/组织单元名数组，如 [\"生产部\",\"品质部\"]）\n"
                        "assignments（更新后的人员分配数组，每项 {name:\"张三\", roles:[\"factory-director\"], "
                        "dept:\"生产部\", manager:\"上级姓名或空\"}；manager 是其直接上级（汇报对象）的姓名，"
                        "最高负责人（如厂长）的 manager 为空字符串；尚未分配人员则空数组）\n"
                        "scale_departments（仅当 needs_scale=true 时返回对象 {small:[...], medium:[...], large:[...]}，"
                        "分别是小/中/大规模的建议部门名单）\n\n"
                        "规则：\n"
                        "1) 规模复杂度——small 2~3 个部门、medium 4~6 个、large 6~9 个；"
                        "scale_departments 三档要体现部门数量的复杂度差异。\n"
                        "2) 账号分配 + 汇报关系：按花名册岗位(skill)与部门匹配角色（角色含义见 roles）；"
                        "给出管理层级——最高负责人（厂长）manager 为空；部门负责人/经理 report 给厂长；"
                        "组长 report 给部门负责人；普通员工 report 给组长；拿不准给 worker 并在 reply 提示。\n"
                        "3) 角色 code 只能从 roles 里选，不能自造。\n"
                        "4) 用户的所有增删改（加/删部门、设/撤角色、调动人员/调整上级）都要直接反映到 departments/assignments 里，"
                        "返回更新后的完整名单，并在 reply 说清变化。\n"
                        "5) 只依据花名册与当前方案判断，不编造花名册之外的人员；用户明确提到的新名字可以加入。"
                    )},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0,
                "max_tokens": 4096,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": False},
                "response_format": {"type": "json_object"},
            }
            # 本地模型常无鉴权：api_key 为空时用占位 token（不因此拒绝）。
            token = self.config.api_key or "local"
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            # 引导要一次生成名单，本地 27b 较慢：给更长超时（至少 180s，与 Planner 路由解耦）。
            async with httpx.AsyncClient(timeout=max(self.config.timeout_s, 180.0), trust_env=False) as client:
                response = await client.post(f"{self.config.base_url}/chat/completions", headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
            content = self._content(payload)
            cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE | re.DOTALL).strip()
            decision = json.loads(cleaned)
            if not isinstance(decision, dict):
                raise ValueError("guide_chat response is not an object")
            departments = decision.get("departments") if isinstance(decision.get("departments"), list) else []
            assignments = decision.get("assignments") if isinstance(decision.get("assignments"), list) else []
            scale_departments = decision.get("scale_departments") if isinstance(decision.get("scale_departments"), dict) else {}
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.info("qwen.guide_chat status=ok model=%s latency_ms=%s depts=%s assigns=%s confirm=%s",
                        self.config.model, elapsed, len(departments), len(assignments), bool(decision.get("confirm")))
            return {"ok": True, "status": "ok",
                    "reply": str(decision.get("reply") or ""),
                    "scale": decision.get("scale"),
                    "needs_scale": bool(decision.get("needs_scale")),
                    "confirm": bool(decision.get("confirm")),
                    "departments": departments,
                    "assignments": assignments,
                    "scale_departments": scale_departments,
                    "model": {**metadata, "status": "ok", "latency_ms": elapsed}}
        except Exception as exc:
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.warning("qwen.guide_chat status=error model=%s latency_ms=%s error=%s",
                           self.config.model, elapsed, f"{type(exc).__name__}: {exc}")
            return {"ok": False, "status": "error", "error": f"{type(exc).__name__}: {exc}",
                    "model": {**metadata, "status": "error", "latency_ms": elapsed}}

    async def complete_json(self, system: str, user: str, *, schema_hint: dict | None = None) -> dict | None:
        """让模型输出一个 JSON 对象。**永不抛异常**：失败一律返回 None。

        未启用 / 未配置 api_key / 网络或 HTTP 失败 / 响应非 JSON → None。
        复用本文件既有 httpx 调用模式（``/chat/completions``、``Bearer
        self.config.api_key``、``timeout=self.config.timeout_s``、
        ``trust_env=False``）；解析失败时尝试从 ```json 代码块或首个 ``{...}``
        里抠出 JSON 对象。调用方（如 slot_filling.fill_tool_args）据此走降级分支。
        """
        started = time.perf_counter()
        try:
            if not self.config.enabled or not self.config.api_key:
                return None
            import httpx

            prompt = str(user)
            if schema_hint:
                prompt += "\n输出结构提示（仅供参考，不要原样回显）：" + json.dumps(schema_hint, ensure_ascii=False)
            headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
            body = {
                "model": self.config.model,
                "messages": [
                    {"role": "system", "content": str(system)},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0,
                "max_tokens": 2048,
                "stream": False,
                "chat_template_kwargs": {"enable_thinking": False},
                "response_format": {"type": "json_object"},
            }
            # trust_env=False prevents an HTTP proxy from intercepting the private model address.
            async with httpx.AsyncClient(timeout=self.config.timeout_s, trust_env=False) as client:
                response = await client.post(f"{self.config.base_url}/chat/completions", headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
            value = self._json_object(self._content(payload))
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.info("qwen.complete_json status=ok model=%s latency_ms=%s keys=%s",
                        self.config.model, elapsed, sorted(value.keys()))
            return value
        except Exception as exc:
            elapsed = round((time.perf_counter() - started) * 1000, 1)
            logger.warning("qwen.complete_json status=error model=%s latency_ms=%s error=%s",
                           self.config.model, elapsed, f"{type(exc).__name__}: {exc}")
            return None

    @staticmethod
    def _json_object(content: str) -> dict[str, Any]:
        """从模型文本里抠出一个 JSON 对象；抠不出就抛错（由调用方降级）。"""
        cleaned = content.strip()
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL).strip()
        try:
            value = json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
            if not match:
                raise ValueError("Qwen response is not valid JSON")
            value = json.loads(match.group(0))
        if not isinstance(value, dict):
            raise ValueError("Qwen response must be a JSON object")
        return value

    @staticmethod
    def _canonical_system_prompt() -> str:
        from .canonical_schema import CANONICAL_SCHEMA

        lines = []
        for entity_type, spec in CANONICAL_SCHEMA.items():
            lines.append(f"- {entity_type}: 必填[{','.join(spec['required'])}] 允许[{','.join(spec['fields'])}]")
        schema_text = "\n".join(lines)
        return (
            "你是云湃制造系统的数据映射器。根据给定的文件样本（表格看 headers/sample_rows/sheets 的 raw_rows，图片/PDF 直接看图）"
            "判断业务实体类型，并把内容抽取成我们 canonical 格式的记录。"
            "只输出一个 JSON 对象，字段为 entity_type、records、confidence、needs_review、reason。"
            "entity_type 只能是下列之一；records 每条是对象，字段名只能用该类型「允许」集合内的字段；"
            "数值必须从文件照抄，绝不编造；每条记录可带 _source（sheet/row/col/raw 或 page/image）定位证据。"
            "records 最多输出前 50 条，超出部分省略（不要为了穷举所有行而把 JSON 写超长导致截断）。"
            "对于表格/多 sheet 文件，额外输出 column_mapping（表头名→canonical 字段名），"
            "例如 {\"物料编码\":\"material_code\",\"材料名称\":\"material_name\",\"用量\":\"quantity\",\"单位\":\"unit\"}；"
            "后续会用确定性代码按该映射抽取全量行，所以 column_mapping 的表头名要照抄文件里的实际表头。"
            "confidence 是 0 到 1 浮点；不确定（<0.7）或关键字段缺失时 needs_review=true。reason 一句话说明依据。"
            "特殊结构指引：① 作业指导书(SOP)：每个 sheet 是一道工序，从「制作工站/文件编号/IE工时/作业步骤」抽取"
            "document 的 route_steps 数组，每项为 {operation_code, operation_name, station, standard_minutes}；"
            "operation_code 用 文件编号+序号（如 TX-001-01），standard_minutes 从 IE工时 的秒数除以 60 得到，station 取制作工站。"
            "② 成品成本分析表/BOM 表：从「物料编码/材料名称/用量/单位/单价/供应商」抽取 bom 的 lines，"
            "每行 {material_code, material_name, quantity, unit}，用量照抄数值列。"
            "\ncanonical schema：\n" + schema_text
        )

    @staticmethod
    def _canonical_prompt(sample: dict[str, Any]) -> list[dict[str, Any]]:
        text = json.dumps({
            "filename": str(sample.get("filename") or ""),
            "detected_format": str((sample.get("sniff") or {}).get("detected_format") or ""),
            "headers": list(sample.get("headers") or []),
            "sample_rows": list(sample.get("sample_rows") or []),
            "sheet_names": list(sample.get("sheet_names") or []),
            "sheets": list(sample.get("sheets") or []),
            "row_count": sample.get("row_count"),
        }, ensure_ascii=False)
        parts: list[dict[str, Any]] = [
            {"type": "text", "text": "文件样本：\n" + text + "\n若含多 sheet（sheet_names 是全部 sheet，sheets 是前几个 sheet 的采样），请综合判断整体业务类型并抽取 canonical 记录。"},
        ]
        for image_b64 in (sample.get("images") or []):
            parts.append({"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + str(image_b64)}})
        return parts

    @staticmethod
    def _parse_canonical(content: str) -> dict[str, Any]:
        from .canonical_schema import CANONICAL_SCHEMA

        cleaned = content.strip()
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL).strip()
        try:
            value = json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
            if not match:
                raise ValueError("Qwen canonical response is not valid JSON")
            value = json.loads(match.group(0))
        if not isinstance(value, dict):
            raise ValueError("Qwen canonical decision must be an object")
        entity_type = str(value.get("entity_type") or "")
        if entity_type not in CANONICAL_SCHEMA:
            raise ValueError(f"invalid entity_type: {entity_type}")
        records = value.get("records", [])
        if not isinstance(records, list) or not records or not all(isinstance(record, dict) for record in records):
            raise ValueError("Qwen records must be a non-empty object array")
        try:
            confidence = max(0.0, min(1.0, float(value.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0.0
        column_mapping = value.get("column_mapping")
        if not isinstance(column_mapping, dict):
            column_mapping = {}
        return {
            "entity_type": entity_type,
            "records": records,
            "column_mapping": {str(k): str(v) for k, v in column_mapping.items()},
            "confidence": confidence,
            "needs_review": bool(value.get("needs_review")) or confidence < 0.7,
            "reason": str(value.get("reason") or ""),
        }
