"""引导 AI 对话版（F-015 重设计 v2：判断交给本地大模型，不写死规则）。

原则（用户裁定）：凡是能交给 AI 做的判断就交给 AI。因此本模块**不内置**
岗位→角色映射、部门模板、意图正则——这些判断一律由 ``QwenRouter.guide_chat``
（本地模型，QWEN_MODEL/QWEN_BASE_URL 指向本地 27b/35b 等）根据花名册与
当前方案做出；本模块只保留三样机械职责：

1. 首开给「大/中/小规模」三个选项（产品交互契约，非业务判断）；
2. 校验模型输出的动作（角色 code 合法、部门名/姓名非空）并维护内存方案；
3. 模型判定用户「确认落地」时，才把方案写库（人工确认 Gate）。

模型不可用时 fail-loud（明确报错），绝不静默回退到写死规则。
"""
from __future__ import annotations

from typing import Any

from .identity import (
    DEFAULT_ROLE_SEEDS,
    PERMISSION_CATALOG,
    IdentityStore,
    normalize_dept_name,
)

#: 规模三选一（产品交互契约：复杂度随规模递增，具体部门/角色由模型生成）。
SCALE_OPTIONS: tuple[dict[str, str], ...] = (
    {"value": "small", "label": "小规模（30 人以内，老板直接管）"},
    {"value": "medium", "label": "中规模（30 ~ 200 人）"},
    {"value": "large", "label": "大规模（200 人以上，分工较细）"},
)

_ROLE_CODES = {role["role_code"] for role in DEFAULT_ROLE_SEEDS}
_ROLE_NAME = {role["role_code"]: role["name"] for role in DEFAULT_ROLE_SEEDS}


def _dept_org_id(name: str) -> str:
    return f"dept:{normalize_dept_name(name)}"


def _roster_view(roster: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """花名册压缩成模型可读视图（姓名/岗位/部门；不含敏感字段）。"""
    return [
        {"name": w.get("worker_name") or "", "skill": w.get("skill") or "",
         "dept": w.get("shift") or w.get("dept") or ""}
        for w in roster if isinstance(w, dict)
    ]


def _apply_actions(departments: list[str], assignments: list[dict[str, Any]],
                   actions: list[Any]) -> list[str]:
    """把模型提出的动作应用到内存方案（校验；返回被忽略动作的说明）。"""
    errors: list[str] = []
    known_ids = {_dept_org_id(d) for d in departments}
    for action in actions:
        if not isinstance(action, dict):
            errors.append(f"非法动作 {action!r}")
            continue
        op = str(action.get("op") or "")
        if op == "add_dept":
            name = str(action.get("name") or "").strip()
            if not name:
                errors.append("add_dept 缺 name")
                continue
            if _dept_org_id(name) not in known_ids:
                departments.append(name)
                known_ids.add(_dept_org_id(name))
        elif op == "del_dept":
            name = str(action.get("name") or "").strip()
            departments[:] = [d for d in departments if _dept_org_id(d) != _dept_org_id(name)]
        elif op == "assign":
            user = str(action.get("user") or "").strip()
            roles = [str(r) for r in (action.get("roles") or []) if str(r) in _ROLE_CODES]
            if not user or not roles:
                errors.append(f"assign 缺 user 或合法角色：{action!r}")
                continue
            existing = next((a for a in assignments if a["name"] == user), None)
            if existing:
                for role in roles:
                    if role not in existing["roles"]:
                        existing["roles"].append(role)
            else:
                assignments.append({"name": user, "roles": roles})
        elif op == "unassign":
            user = str(action.get("user") or "").strip()
            assignments[:] = [a for a in assignments if a["name"] != user]
        else:
            errors.append(f"未知 op：{op}")
    return errors


def _resolve_user_id(roster: list[dict[str, Any]], name: str) -> tuple[str, dict[str, Any] | None]:
    """人名 → user_id：命中花名册用 worker_code，否则用名字当账号。"""
    for entry in roster:
        if isinstance(entry, dict) and entry.get("worker_name") == name:
            return str(entry.get("worker_code") or name), entry
    return name, None


def _plan_summary(departments: list[str], assignments: list[dict[str, Any]]) -> str:
    lines = [f"部门（{len(departments)}）：" + ("、".join(departments) if departments else "（暂无）")]
    if assignments:
        lines.append("账号分配：" + "；".join(
            f"{a['name']} → {'/'.join(_ROLE_NAME.get(r, r) for r in a['roles'])}"
            for a in assignments))
    else:
        lines.append("账号分配：（尚未分配）")
    return "\n".join(lines)


def _greeting(state: dict[str, Any]) -> dict[str, Any]:
    state = dict(state)
    state["started"] = True
    return {
        "reply": "先选一下公司规模，我来给你配一套合适的组织架构（规模不同，复杂程度不一样）：\n"
                 "1️⃣ 小规模（30 人以内，老板直接管）\n"
                 "2️⃣ 中规模（30~200 人）\n"
                 "3️⃣ 大规模（200 人以上，分工较细）\n"
                 "回复 1/2/3 或 小/中/大。",
        "options": [dict(o) for o in SCALE_OPTIONS],
        "plan": None, "state": state, "done": False, "applied": None,
    }


def _model_unavailable(state: dict[str, Any], detail: str) -> dict[str, Any]:
    return {
        "reply": f"本地引导模型不可用，请先启动并配置 QWEN_BASE_URL / QWEN_MODEL / QWEN_API_KEY"
                 f"（{detail}）。模型就绪后重试即可，当前方案未改变。",
        "options": [], "plan": None, "state": state, "done": False, "applied": None,
    }


async def handle_message(store: IdentityStore, *, tenant_id: str, user_id: str,
                         message: str, roster: list[dict[str, Any]] | None = None,
                         state: dict[str, Any] | None = None,
                         router: Any = None) -> dict[str, Any]:
    """对话引导主入口（LLM 驱动）。router 为 ``QwenRouter`` 实例或测试替身。

    返回 {reply, options, plan, state, done, applied}；落库只在模型判定
    confirm=true（用户明确「就这样/确认」）时发生。
    """
    roster = roster or []
    state = dict(state) if state else {}
    msg = str(message or "").strip()

    # 首开（尚无规模且无输入）：给三选一契约，不调模型。
    if not msg and not state.get("scale"):
        return _greeting(state)

    if router is None or not hasattr(router, "guide_chat"):
        return _model_unavailable(state, "未注入引导模型 router")

    decision = await router.guide_chat(
        scale=state.get("scale"),
        departments=list(state.get("departments") or []),
        assignments=[dict(a) for a in (state.get("assignments") or [])],
        roster=_roster_view(roster),
        message=msg,
        roles=[{"role_code": r["role_code"], "name": r["name"],
                "permissions": r["permissions"]} for r in DEFAULT_ROLE_SEEDS],
        permissions=[{"code": p["code"], "label": p["label"]} for p in PERMISSION_CATALOG],
    )
    if not decision.get("ok"):
        return _model_unavailable(state, decision.get("error") or decision.get("status") or "unknown")

    if decision.get("scale") in {"small", "medium", "large"}:
        state["scale"] = decision["scale"]

    departments = list(state.get("departments") or [])
    assignments = [dict(a) for a in (state.get("assignments") or [])]
    ignored = _apply_actions(departments, assignments, decision.get("actions") or [])
    state["departments"] = departments
    state["assignments"] = assignments

    reply = str(decision.get("reply") or "")
    if ignored:
        reply += "\n（部分动作未能识别，已忽略：%s）" % "；".join(ignored)

    # 模型认为还需先选规模（例如用户没选规模就说别的）
    if decision.get("needs_scale"):
        return {"reply": reply, "options": [dict(o) for o in SCALE_OPTIONS],
                "plan": None, "state": state, "done": False, "applied": None}

    # 人工确认 Gate：模型判定用户明确要落地 → 才写库
    if decision.get("confirm"):
        applied = _apply(store, tenant_id=tenant_id, user_id=user_id,
                         roster=roster, departments=departments, assignments=assignments)
        return {"reply": reply, "options": [], "plan": None, "state": None,
                "done": True, "applied": applied}

    plan = {"departments": departments,
            "roles": [r["role_code"] for r in DEFAULT_ROLE_SEEDS],
            "assignments": [dict(a) for a in assignments]}
    return {
        "reply": f"{reply}\n\n{_plan_summary(departments, assignments)}",
        "options": [{"value": "就这样", "label": "就这样，落地"}],
        "plan": plan, "state": state, "done": False, "applied": None,
    }


def _apply(store: IdentityStore, *, tenant_id: str, user_id: str,
           roster: list[dict[str, Any]], departments: list[str],
           assignments: list[dict[str, Any]]) -> dict[str, Any]:
    """人工确认 Gate：写组织树 + 账号绑定（引导建的结构标 manual，派生不覆盖）。"""
    store.upsert_org(tenant_id=tenant_id, org_id="company", name="公司",
                     org_type="company", source="manual")
    for dept in departments:
        store.upsert_org(tenant_id=tenant_id, org_id=_dept_org_id(dept), name=dept,
                         parent_id="company", org_type="dept", source="manual")
    bindings: list[dict[str, Any]] = []
    for item in assignments:
        user_code, entry = _resolve_user_id(roster, item["name"])
        bindings.append({"user_id": user_code, "role_codes": item["roles"],
                         "skill": (entry or {}).get("skill")})
    if bindings:
        store.bind_users_bulk(tenant_id=tenant_id, bindings=bindings)
    return {"departments": len(departments), "bindings": len(bindings),
            "departments_list": departments,
            "assignments": [{"user_id": b["user_id"], "role_codes": b["role_codes"]}
                            for b in bindings]}
