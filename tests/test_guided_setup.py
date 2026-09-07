"""引导AI（F-015）单元测试：确定性推荐、纯函数不落库、LLM 合并与回退。"""
from __future__ import annotations

import pytest

from yunpai_langgraph.guided_setup import (
    SKILL_ROLE_HINTS,
    build_guidance_plan,
    catalog_payload,
    enrich_plan_with_llm,
    suggest_bindings,
)
from yunpai_langgraph.identity import IdentityStore, plan_org_from_workers

WORKERS = [
    {"worker_code": "W-1", "worker_name": "张三", "shift": "仓储部", "skill": "仓管"},
    {"worker_code": "W-2", "worker_name": "李四", "shift": "押出部", "skill": "押出组长"},
    {"worker_code": "W-3", "worker_name": "王五", "shift": "品质部", "skill": "品保工程师"},
    {"worker_code": "W-4", "worker_name": "赵六", "shift": "生产部", "skill": "厂长"},
    {"worker_code": "W-5", "worker_name": "钱七", "shift": "工程部", "skill": "工艺工程师"},
    {"worker_code": "W-6", "worker_name": "孙八", "shift": "计划部", "skill": "计划员"},
    {"worker_code": "W-7", "worker_name": "周九", "shift": "组装部", "skill": "装配工"},
    {"worker_code": "W-8", "worker_name": "吴十", "shift": "行政部", "skill": ""},
]


def test_catalog_payload_shape():
    payload = catalog_payload()
    codes = {p["code"] for p in payload["permissions"]}
    assert "worker.view" in codes and "identity.admin" in codes
    role_codes = {r["role_code"] for r in payload["roles"]}
    assert "factory-director" in role_codes and "worker" in role_codes


def test_suggest_bindings_deterministic_rules():
    suggestions = {item["user_id"]: item for item in suggest_bindings(WORKERS)}
    assert suggestions["W-1"]["suggested_roles"] == ["worker"]
    assert suggestions["W-2"]["suggested_roles"] == ["team-leader"]
    assert suggestions["W-3"]["suggested_roles"] == ["quality-assurance"]  # 品保关键词先于工程
    assert suggestions["W-4"]["suggested_roles"] == ["factory-director"]
    assert suggestions["W-4"]["needs_review"] is False
    assert suggestions["W-7"]["suggested_roles"] == ["worker"] and suggestions["W-7"]["needs_review"] is True
    assert suggestions["W-8"]["needs_review"] is True  # 空岗位


def test_skill_rule_order_quality_before_engineering():
    """规则序断言：品保类关键词必须排在工程类之前（「品保工程师」应给 quality-assurance）。"""
    quality = next(h for h in SKILL_ROLE_HINTS if h["roles"] == ["quality-assurance"])
    engineering = next(h for h in SKILL_ROLE_HINTS if h["roles"] == ["engineer"])
    assert SKILL_ROLE_HINTS.index(quality) < SKILL_ROLE_HINTS.index(engineering)


def test_build_guidance_plan_is_pure(tmp_path):
    """红线：build_guidance_plan 纯函数——不接触 store，无任何库写入。"""
    store = IdentityStore(str(tmp_path / "identity.sqlite"))
    preview = plan_org_from_workers(WORKERS, existing_nodes=store.org_tree(tenant_id="t1"))
    plan = build_guidance_plan(tenant_id="t1", workers=WORKERS, derive_result=preview)
    assert plan["status"] == "draft"
    assert plan["summary"]["workers"] == len(WORKERS)
    assert plan["summary"]["departments"] > 0
    assert plan["summary"]["role_counts"]["worker"] >= 2
    # 未落库
    assert store.org_tree(tenant_id="t1") == []
    assert store.list_bindings(tenant_id="t1") == []


def test_plan_org_preview_matches_derive_result(tmp_path):
    """只读预览与落库派生一致性：departments/roster 相同。"""
    store = IdentityStore(str(tmp_path / "identity.sqlite"))
    preview = plan_org_from_workers(WORKERS, existing_nodes=store.org_tree(tenant_id="t1"))
    derived = store.derive_org_from_workers(WORKERS, tenant_id="t1")
    assert preview["departments"] == derived["departments"]
    assert preview["roster"] == derived["roster"]


class _FakeRouter:
    def __init__(self, result):
        self._result = result
        self.calls = []

    async def guide_suggest(self, roster, permissions, roles):
        self.calls.append(roster)
        return self._result


async def test_enrich_plan_with_llm_merges_valid_suggestions():
    plan = build_guidance_plan(tenant_id="t1", workers=WORKERS)
    router = _FakeRouter({"ok": True, "suggestions": [
        {"user_id": "W-1", "suggested_roles": ["team-leader"], "needs_review": False, "reason": "仓库负责人"},
        {"user_id": "W-2", "suggested_roles": ["not-a-role"], "needs_review": False},  # 非法角色被忽略
    ]})
    enriched = await enrich_plan_with_llm(plan, router)
    assert enriched["llm"] == "merged:1"
    by_user = {item["user_id"]: item for item in enriched["suggestions"]}
    assert by_user["W-1"]["suggested_roles"] == ["team-leader"]
    assert by_user["W-1"]["source"] == "llm"
    assert by_user["W-2"]["source"] == "rule"  # 非法建议整条忽略，保留确定性结果


async def test_enrich_plan_with_llm_falls_back_on_error():
    plan = build_guidance_plan(tenant_id="t1", workers=WORKERS)
    router = _FakeRouter({"ok": False, "error": "qwen down"})
    enriched = await enrich_plan_with_llm(plan, router)
    assert enriched["llm"] == "unavailable"
    assert all(item["source"] == "rule" for item in enriched["suggestions"])
    # router 为 None → skipped
    skipped = await enrich_plan_with_llm(build_guidance_plan(tenant_id="t1", workers=WORKERS), None)
    assert skipped["llm"] == "skipped"
