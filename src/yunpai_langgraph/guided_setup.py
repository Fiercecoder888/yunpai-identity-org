"""引导 AI（F-015，R-002）：把本系统作为标准系统，列出全部权限并引导分配。

四子能力对应交接包阶段①④：
- 权限清单（catalog）：见 ``identity.PERMISSION_CATALOG`` / ``catalog_payload()``；
- 引导对话/组织推荐（``suggest_bindings``）：确定性规则内核（skill 岗位 →
  角色推荐，花名册数据不经 LLM 也能出方案），可选 Qwen 增强
  （``llm.py QwenRouter.guide_suggest``，失败静默回退确定性结果）；
- 分配方案生成（``build_guidance_plan``）：纯函数，只产出建议对象；
- 落地（``IdentityStore.save_guidance_plan`` → ``apply_guidance_plan``）：
  draft 方案入库 ≠ 生效，必须人工确认 Gate（confirm=true + confirmed_by）
  才写 user_bindings——「AI 不经确认不生效」〔原话红线〕。
"""
from __future__ import annotations

from typing import Any

from .identity import (
    DEFAULT_ROLE_SEEDS,
    PERMISSION_CATALOG,
    split_dept_field,
)

#: 岗位关键词 → 角色推荐（有序，首个命中生效；均保守：拿不准标 needs_review）。
#: 角色语义见 DEFAULT_ROLE_SEEDS；厂长为事实 admin 但不含 identity.admin
#: （管理权归 org-admin，交接包接缝 2）。
SKILL_ROLE_HINTS: tuple[dict[str, Any], ...] = (
    {"keywords": ("厂长", "总经理",), "roles": ["factory-director"], "needs_review": False},
    {"keywords": ("经理", "总监", "厂长助理"), "roles": ["factory-director"], "needs_review": True},
    {"keywords": ("品保", "质检", "质量", "qc", "qa", "iqc"), "roles": ["quality-assurance"], "needs_review": False},
    {"keywords": ("工程", "工艺", "研发", "技术", "ie"), "roles": ["engineer"], "needs_review": False},
    {"keywords": ("计划", "pmc", "物控", "生管", "排程"), "roles": ["planner"], "needs_review": False},
    {"keywords": ("采购", "供应链"), "roles": ["planner"], "needs_review": True},
    {"keywords": ("组长", "班长", "拉长", "线长", "主管", "领班"), "roles": ["team-leader"], "needs_review": False},
    {"keywords": ("仓管", "仓储", "库管"), "roles": ["worker"], "needs_review": False},
    {"keywords": ("文员", "办公", "人事", "行政", "财务", "会计", "资料员"),
     "roles": ["data-steward"], "needs_review": True},
)

_SEED_ROLE_CODES = {role["role_code"] for role in DEFAULT_ROLE_SEEDS}


def catalog_payload() -> dict[str, Any]:
    """权限清单 + 种子角色（引导AI 与前端共用；静态只读，不涉敏感数据）。"""
    return {
        "permissions": [dict(item) for item in PERMISSION_CATALOG],
        "roles": [dict(role) for role in DEFAULT_ROLE_SEEDS],
        "note": "查看类权限（order.view/report.view/worker.view）附数据范围 self|dept|tenant；"
                "v1 执行层按 tenant 隔离，dept 过滤待组织树链路稳定后启用",
    }


def _match_skill(skill: str) -> tuple[list[str], bool, str]:
    text = str(skill or "").strip().lower()
    if not text:
        return [], True, "花名册无岗位信息，默认工人角色，待人工确认"
    for hint in SKILL_ROLE_HINTS:
        for keyword in hint["keywords"]:
            if keyword in text:
                note = f"岗位「{skill}」命中关键词「{keyword}」"
                return list(hint["roles"]), bool(hint["needs_review"]), note
    return ["worker"], True, f"岗位「{skill}」无确定映射，默认工人角色，待人工确认"


def suggest_bindings(workers: list[dict[str, Any]],
                     derive_result: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """花名册 → 角色绑定建议（纯函数，不落库）。

    workers 元素即 canonical worker 记录（worker_code/worker_name/skill/shift）；
    derive_result 取 ``IdentityStore.derive_org_from_workers`` 返回值，用于
    user_id 与主部门 org_id 对齐。
    """
    roster = (derive_result or {}).get("roster") or []
    primary_by_code = {
        entry.get("worker_code"): entry.get("primary_dept")
        for entry in roster if isinstance(entry, dict)
    }
    skill_by_code = {
        entry.get("worker_code"): entry.get("skill")
        for entry in roster if isinstance(entry, dict)
    }
    suggestions: list[dict[str, Any]] = []
    for worker in workers:
        if not isinstance(worker, dict):
            continue
        code = str(worker.get("worker_code") or "").strip()
        name = str(worker.get("worker_name") or "").strip()
        if not code and not name:
            continue
        skill = str(worker.get("skill") or skill_by_code.get(code) or "")
        roles, needs_review, reason = _match_skill(skill)
        suggestions.append({
            "user_id": code or name,
            "display_name": name,
            "skill": skill,
            "primary_dept": primary_by_code.get(code),
            "depts": split_dept_field(worker.get("shift") or worker.get("dept")),
            "suggested_roles": roles,
            "needs_review": needs_review,
            "reason": reason,
            "source": "rule",
        })
    return suggestions


def build_guidance_plan(*, tenant_id: str, workers: list[dict[str, Any]],
                        derive_result: dict[str, Any] | None = None) -> dict[str, Any]:
    """生成完整引导方案（纯函数）：组织树建议 + 逐人角色建议 + 覆盖统计。

    产出仅供人工审阅；落库走 store.save_guidance_plan → apply_guidance_plan
    （人工确认 Gate）。本函数不接触任何 store。
    """
    suggestions = suggest_bindings(workers, derive_result)
    departments = (derive_result or {}).get("departments") or []
    review_count = sum(1 for item in suggestions if item.get("needs_review"))
    role_counts: dict[str, int] = {}
    for item in suggestions:
        for role in item.get("suggested_roles") or []:
            role_counts[role] = role_counts.get(role, 0) + 1
    return {
        "tenant_id": tenant_id,
        "kind": "identity-guidance",
        "summary": {
            "workers": len(suggestions),
            "departments": len(departments),
            "needs_review": review_count,
            "role_counts": role_counts,
        },
        "departments": departments,
        "suggestions": suggestions,
        "status": "draft",
    }


async def enrich_plan_with_llm(plan: dict[str, Any], router: Any) -> dict[str, Any]:
    """用 Qwen 增强建议（可选路径）：LLM 不可用/输出不合法时静默回退。

    只覆盖 suggested_roles/needs_review/reason，user_id/部门归属仍以确定性
    结果为准；LLM 建议的角色必须存在于种子角色集，否则忽略该条建议。
    """
    suggestions = plan.get("suggestions") or []
    if not suggestions or router is None:
        plan["llm"] = "skipped"
        return plan
    result = await router.guide_suggest(
        [
            {"user_id": item.get("user_id"), "display_name": item.get("display_name"),
             "skill": item.get("skill"), "depts": item.get("depts")}
            for item in suggestions
        ],
        catalog_payload()["permissions"],
        catalog_payload()["roles"],
    )
    if not result.get("ok"):
        plan["llm"] = "unavailable"
        return plan
    llm_items = result.get("suggestions") or []
    by_user: dict[str, dict[str, Any]] = {
        str(item.get("user_id") or ""): item for item in llm_items if isinstance(item, dict)
    }
    merged = 0
    for item in suggestions:
        entry = by_user.get(str(item.get("user_id") or ""))
        if not entry:
            continue
        roles = [str(r) for r in (entry.get("suggested_roles") or []) if str(r) in _SEED_ROLE_CODES]
        if not roles:
            continue
        item["suggested_roles"] = roles
        item["needs_review"] = bool(entry.get("needs_review", True))
        if entry.get("reason"):
            item["reason"] = str(entry["reason"])
        item["source"] = "llm"
        merged += 1
    plan["llm"] = f"merged:{merged}"
    return plan
