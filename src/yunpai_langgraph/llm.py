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
    base_url: str = "http://gb10:18085/v1"
    model: str = "qwen3.6-35b-a3b-fp8-gpu0-200k"
    api_key: str = ""
    timeout_s: float = 45.0

    @classmethod
    def from_env(cls) -> "QwenConfig":
        return cls(
            enabled=_env_bool("QWEN_ROUTER_ENABLED", True),
            base_url=os.getenv("QWEN_BASE_URL", "http://gb10:18085/v1").rstrip("/"),
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
            # trust_env=False prevents an HTTP proxy from intercepting the private GB10 address.
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
            "tools 只能从给定 catalog 选择。skill 名称必须与 catalog 中的 name 完全一致，不能自造或拼接版本号。"
            "上传订单文件时优先 workflow 或 ingest_document；上传基础资料/业务资料（BOM、SOP、设备、工位、人员、库存、供应商、财务、目录批量）时必须在 skills 中给出 business-data-identification。"
        )

    @staticmethod
    def _prompt(request: dict[str, Any], catalog: list[dict[str, Any]], skill_catalog: list[dict[str, Any]] | None = None) -> str:
        message = str(request.get("message") or request.get("task") or "")
        file_items = list(request.get("documents", [])) + list(request.get("attachments", []))
        file_names = [str(item.get("filename", "")) for item in file_items if isinstance(item, dict)]
        skill_names = [str(skill) for skill in (request.get("skills") or [])] if isinstance(request.get("skills"), list) else []
        return json.dumps({
            "message": message,
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
        }
