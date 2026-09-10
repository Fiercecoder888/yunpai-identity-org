"""LLM 主导的工具参数补全（slot filling）。

给「对话里一句话建账号/分配账号」这类请求用：**由模型理解意图、抽取工具参数**，
代码只做三件确定性的事——合并 partial、按 required 重算 missing、生成兜底追问。

接线契约（agents.py / graph.py 按此调用）::

    result = await fill_tool_args(router, tool="create_identity_user",
                                  input_schema=spec.input_schema, message=message,
                                  history=history, partial=partial)
    # result == {"args": dict, "missing": list[str], "question": str, "source": "llm" | "unavailable"}

约定：
- ``required`` 只取 ``input_schema["required"]``（缺省 ``[]``）；
- 参数值只来自用户原话或历史，模型不得编造；
- 模型自报的 missing 不可信，最终 missing 一律由代码按 ``required - args 的键`` 重算；
- 全部 required 齐了 → ``missing == []``、``question == ""``；
- router 不可用 / 模型返回 None / 任何异常 → ``source == "unavailable"``，
  ``args`` 保留 partial，``missing`` 是剩余 required，``question`` 是中文追问；
- **本函数永不抛异常**（调用方可以直接 await，无需 try）。
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger("yunpai.agent")

# 常见字段的中文名：只影响追问文案，不影响任何抽取逻辑（没有写死的意图词表）。
_FIELD_LABELS: dict[str, str] = {
    "user_id": "账号（登录名，例如 worker101）",
    "display_name": "姓名",
    "name": "姓名",
    "people": "人员名单（每人姓名，可多人）",
    "role_codes": "角色（例如 worker 工人）",
    "role_code": "角色（例如 worker 工人）",
    "org_name": "所属组织/班组",
    "org_id": "所属组织/班组",
    "password": "初始密码",
    "tenant_id": "租户",
    "phone": "手机号",
    "email": "邮箱",
    "user_id_prefix": "账号前缀",
}

# 追问示例：让反问更自然、可照抄。
_TOOL_EXAMPLES: dict[str, str] = {
    "create_identity_user": "给张二申请一个工人账号 worker101",
    "assign_identity_account": "把 worker101 调到装配班组，让他当组长",
}


def _system_prompt() -> str:
    return (
        "你是云湃制造系统的参数抽取器。你只负责从用户原话和历史对话里抽取工具调用参数，"
        "不执行工具、不解释系统、不闲聊。\n"
        "只输出一个 JSON 对象，不要 Markdown、不要思维过程，字段固定为：\n"
        '{"args": {参数名: 值}, "missing": ["还缺的必填参数名"], "question": "一句中文追问（没有缺失时为空字符串）", "off_topic": false}\n'
        "规则：\n"
        "1) 参数只能来自用户原话或历史对话，绝不编造、绝不猜测、绝不自行补全；用户没提到的一律不要放进 args。\n"
        "2) required 里的必填参数如果用户没提供，就把参数名放进 missing，并在 question 里写一句自然、"
        "礼貌、带示例的中文追问，例如「要给谁建账号？请告诉我姓名和想要的账号，"
        "例如「给张二申请一个工人账号 worker101」」；一次把所有缺失项问清，不要拆成多轮。\n"
        "3) already_known 里的参数已经确定，不要重复追问、不要改写，只需补上还缺的部分。\n"
        "4) args 的键必须是 input_schema.properties 里出现过的参数名；值要照抄用户原话里的内容"
        "（账号、姓名、组织名原样保留），角色请用 input_schema 里给定的英文角色码。\n"
        "5) 全部 required 都已齐 → 返回 {\"args\": {...}, \"missing\": [], \"question\": \"\"}。\n"
        "6) 只依据用户原话和历史判断，拿不准就放进 missing 用 question 反问，不要静默失败。\n"
        "7) 如果 history 里有上一轮的追问、而 user_message 明显不是在补充该工具的参数"
        "（例如换了个话题、问别的、让你做别的事），把 off_topic 设为 true，并让 args 保持 already_known 不变。\n"
        "8) input_schema 里的 anyOf 表示「多选一」：满足任意一组 required 就算齐了，不要要求全部组都提供。"
    )


def _user_prompt(*, tool: str, required: list[str], input_schema: dict, partial: dict,
                 message: str, history: list[dict] | None) -> str:
    return json.dumps({
        "tool": tool,
        "required": required,
        "input_schema": input_schema if isinstance(input_schema, dict) else {},
        "already_known": partial or {},
        "user_message": message,
        "history": history or [],
    }, ensure_ascii=False)


def _schema_hint(required: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "args": {"type": "object", "description": "已从用户原话抽取到的参数，键只能是 input_schema 里的参数名"},
            "missing": {"type": "array", "items": {"type": "string"}, "description": f"还缺的必填参数，候选：{required}"},
            "question": {"type": "string", "description": "一句自然礼貌的中文追问，全部齐了则为空字符串"},
            "off_topic": {"type": "boolean", "description": "用户这条消息不是在补充本工具的参数（换话题）时为 true"},
        },
        "required": ["args", "missing", "question"],
    }


def _required_fields(input_schema: Any) -> list[str]:
    if not isinstance(input_schema, dict):
        return []
    raw = input_schema.get("required")
    if not isinstance(raw, list):
        return []
    fields: list[str] = []
    for item in raw:
        name = str(item)
        if name and name not in fields:
            fields.append(name)
    return fields


def _as_args(value: Any) -> dict:
    return dict(value) if isinstance(value, dict) else {}


def _is_filled(value: Any) -> bool:
    """键存在且值不是 None/空串，就算已填（空数组/空对象仍视为已给出）。"""
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    return True


def _missing_of(required: list[str], args: dict) -> list[str]:
    return [field for field in required if not _is_filled(args.get(field))]


def _field_label(field: str) -> str:
    return _FIELD_LABELS.get(field, field)


def field_labels(fields: list[str]) -> str:
    """把字段名翻成中文（给反问文案用），如 ["user_id"] → "账号（登录名，例如 worker101）"。"""
    return "、".join(_field_label(str(field)) for field in fields if str(field))


def _question(missing: list[str], tool: str) -> str:
    if not missing:
        return ""
    question = f"我需要更多信息才能继续：请补充 {field_labels(missing)}。"
    example = _TOOL_EXAMPLES.get(tool)
    if example:
        question += f"例如「{example}」。"
    return question


def _unavailable(partial: dict, required: list[str], tool: str) -> dict:
    missing = _missing_of(required, partial)
    return {
        "args": dict(partial),
        "missing": missing,
        "question": _question(missing, tool),
        "source": "unavailable",
    }


async def _ask_model(router: Any, *, tool: str, input_schema: dict, message: str,
                     history: list[dict] | None, partial: dict, required: list[str]) -> dict | None:
    """调用 router.complete_json；router 不可用或模型没给出对象时返回 None。"""
    complete = getattr(router, "complete_json", None)
    if not callable(complete):
        return None
    decision = await complete(
        _system_prompt(),
        _user_prompt(tool=tool, required=required, input_schema=input_schema,
                     partial=partial, message=message, history=history),
        schema_hint=_schema_hint(required),
    )
    return decision if isinstance(decision, dict) else None


async def fill_tool_args(router: Any, *, tool: str, input_schema: dict, message: str,
                         history: list[dict] | None = None,
                         partial: dict | None = None,
                         required_hint: list[str] | None = None) -> dict:
    """让模型补齐工具入参，并确定性重算 missing / question。

    返回 ``{"args": dict, "missing": list[str], "question": str,
    "source": "llm" | "unavailable", "off_topic": bool}``。合并规则：模型值优先、
    ``partial`` 兜底（模型给出空值时不覆盖 partial 里已有的值）。**永不抛异常。**

    ``required_hint``：调用方按 schema（含 anyOf）算出的「当前还缺什么」，仅用于
    指导模型抽取与追问；``input_schema.required`` 存在时以它为准。
    """
    known = _as_args(partial)
    required = _required_fields(input_schema) or [str(item) for item in (required_hint or []) if str(item)]
    try:
        decision = await _ask_model(router, tool=tool, input_schema=input_schema, message=message,
                                    history=history, partial=known, required=required)
    except Exception as exc:  # 网络/模型/解析任何异常都降级，绝不向上抛
        logger.warning("slot_filling.llm_error tool=%s error=%s", tool, f"{type(exc).__name__}: {exc}")
        decision = None

    if decision is None:
        logger.info("slot_filling.unavailable tool=%s missing=%s", tool, _missing_of(required, known))
        return _unavailable(known, required, tool)

    model_args = _as_args(decision.get("args"))
    merged = dict(known)
    for key, value in model_args.items():
        if key in merged and not _is_filled(value) and _is_filled(merged[key]):
            continue  # 模型给了空值 → 保留 partial 兜底
        merged[key] = value

    missing = _missing_of(required, merged)
    question = str(decision.get("question") or "").strip()
    if missing and not question:
        question = _question(missing, tool)
    if not missing:
        question = ""
    off_topic = bool(decision.get("off_topic"))
    logger.info("slot_filling.filled tool=%s source=llm missing=%s off_topic=%s", tool, missing, off_topic)
    return {"args": merged, "missing": missing, "question": question, "source": "llm",
            "off_topic": off_topic}
