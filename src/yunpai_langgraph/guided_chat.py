"""引导 AI 轻量化对话版（F-015 重设计，2026-09-07）。

设计目标（用户裁定：工作执行就一个标准，尽可能简单）：
- 用户刚打开系统、还不确定组织架构时，AI 直接给**三个规模选项**（大/中/小），
  不同规模配不同复杂度的预设组织架构与角色集；
- 选定规模后给出预设结构，用户在对话里**自然语言增删改**（设角色/加部门/
  删部门/移除角色），最后说「就这样/确认」落地；
- 全程确定性意图解析（不依赖 LLM，测试友好、行为可预测）；自然语言兜底由
  明确提示语引导，而非黑盒模型。

红线保持：任何落库都发生在用户确认之后（「确认/就这样」即人工 Gate）；
确认前只维护内存中的 pending 方案，库里查不到任何部门/绑定写入。
"""
from __future__ import annotations

import re
from typing import Any

from .identity import (
    DEFAULT_ROLE_SEEDS,
    IdentityStore,
    normalize_dept_name,
)

# ---------------------------------------------------------------------------
# 规模预设：不同规模 → 不同复杂度的组织架构 + 角色集（角色都是种子角色的子集）。
# ---------------------------------------------------------------------------

SCALE_PRESETS: dict[str, dict[str, Any]] = {
    "small": {
        "label": "小规模（30 人以内，老板直接管）",
        "departments": ["生产部", "管理部"],
        "roles": ["factory-director", "team-leader", "worker"],
    },
    "medium": {
        "label": "中规模（30 ~ 200 人）",
        "departments": ["生产部", "工程部", "品质部", "计划部", "仓储部"],
        "roles": ["factory-director", "engineer", "planner", "quality-assurance",
                  "team-leader", "worker"],
    },
    "large": {
        "label": "大规模（200 人以上，分工较细）",
        "departments": ["生产部", "工程部", "品质部", "计划部", "仓储部",
                        "采购部", "人事行政部", "财务部"],
        "roles": [role["role_code"] for role in DEFAULT_ROLE_SEEDS],
    },
}

_ROLE_NAME: dict[str, str] = {role["role_code"]: role["name"] for role in DEFAULT_ROLE_SEEDS}

#: 角色别名（用户口语 → role_code）；顺序即优先级，命中即用。
ROLE_ALIASES: tuple[tuple[str, str], ...] = (
    ("组织管理员", "org-admin"), ("系统管理员", "org-admin"), ("管理员", "org-admin"),
    ("厂长", "factory-director"), ("总经理", "factory-director"), ("老板", "factory-director"),
    ("主数据", "data-steward"), ("数据管理员", "data-steward"), ("资料员", "data-steward"), ("文员", "data-steward"),
    ("工程", "engineer"), ("工艺", "engineer"), ("技术", "engineer"),
    ("计划", "planner"), ("排程", "planner"), ("物控", "planner"), ("生管", "planner"), ("pmc", "planner"),
    ("发布", "release-manager"), ("生产经理", "release-manager"),
    ("品保", "quality-assurance"), ("质检", "quality-assurance"), ("品质", "quality-assurance"),
    ("质量", "quality-assurance"), ("qc", "quality-assurance"),
    ("组长", "team-leader"), ("班长", "team-leader"), ("线长", "team-leader"),
    ("拉长", "team-leader"), ("主管", "team-leader"), ("领班", "team-leader"),
    ("工人", "worker"), ("员工", "worker"), ("操作工", "worker"),
)

_SCALE_ALIASES: tuple[tuple[str, str], ...] = (
    ("小", "small"), ("small", "small"), ("小型", "small"), ("小规模", "small"), ("小公司", "small"), ("1", "small"),
    ("中", "medium"), ("medium", "medium"), ("中型", "medium"), ("中规模", "medium"), ("中等", "medium"), ("2", "medium"),
    ("大", "large"), ("large", "large"), ("大型", "large"), ("大规模", "large"), ("大公司", "large"), ("3", "large"),
)


def _resolve_role(phrase: str) -> str | None:
    text = str(phrase or "").lower()
    for keyword, code in ROLE_ALIASES:
        if keyword.lower() in text:
            return code
    return None


def _resolve_scale(phrase: str) -> str | None:
    text = str(phrase or "").strip()
    for keyword, code in _SCALE_ALIASES:
        if text == keyword or keyword in text:
            return code
    return None


def _split_names(text: str) -> list[str]:
    text = re.sub(r"^(把|让|请|给)", "", str(text or "").strip())
    text = re.sub(r"(都|全部|一起)$", "", text)
    return [p.strip() for p in re.split(r"[、，,\s]+", text) if p.strip()]


_CONFIRM_WORDS = ("就这样", "就按", "确认", "确定", "可以", "没问题", "完成", "同意", "开始", "ok", "yes")


def _is_confirm(msg: str) -> bool:
    return any(word in str(msg or "").lower() for word in _CONFIRM_WORDS)


def _parse_assign(msg: str) -> tuple[list[str], str] | None:
    for verb in ("设置为", "设为", "设成", "担任", "负责", "改成", "变更为", "当", "做"):
        if verb not in msg:
            continue
        left, _, right = msg.partition(verb)
        who = _split_names(left)
        role = _resolve_role(right)
        if who and role:
            return who, role
    return None


def _parse_add_dept(msg: str) -> str | None:
    m = re.search(r"(?:新增|增加|添加|加个|加一个|再加)\s*(?:部门|一个部门)?\s*(?P<name>[^\s，。,。]+)", msg)
    if not m:
        return None
    return m.group("name").strip() or None


def _parse_delete_dept(msg: str) -> str | None:
    # 删(除)部门X / 去掉X(部门) / 不要X部门 / 移除X部门
    m = re.search(r"(?:删除|删掉|去掉|移除|不要)\s*(?:部门)?\s*(?P<name>[^\s，。,。]+?)部?$", msg)
    if not m:
        return None
    return m.group("name").strip("部")


def _parse_remove_assign(msg: str) -> list[str] | None:
    m = re.match(r"^(?:把|让|请|给)?(?P<who>[\w\u4e00-\u9fa5、，,\s]+?)(?:不当了|不干了|不负责了|取消|移除|删除|撤掉|去掉)", msg)
    if not m:
        return None
    who = _split_names(m.group("who"))
    return who or None


def _dept_org_id(name: str) -> str:
    return f"dept:{normalize_dept_name(name)}"


def _plan_summary(state: dict[str, Any]) -> str:
    depts = state.get("departments") or []
    assignments = state.get("assignments") or []
    lines = [f"部门（{len(depts)}）：" + ("、".join(depts) if depts else "（暂无）")]
    if assignments:
        lines.append("账号分配：" + "；".join(
            f"{item['name']} → {'/'.join(_ROLE_NAME.get(r, r) for r in item['roles'])}"
            for item in assignments))
    else:
        lines.append("账号分配：（尚未分配，可直接说「张三当厂长」）")
    return "\n".join(lines)


def _resolve_user_id(store: IdentityStore, tenant_id: str, roster: list[dict[str, Any]],
                     name: str) -> tuple[str, dict[str, Any] | None]:
    """把人名解析为 user_id：命中花名册用 worker_code，否则直接用名字当账号。"""
    for entry in roster:
        if entry.get("worker_name") == name:
            return str(entry.get("worker_code") or name), entry
    return name, None


def handle_message(store: IdentityStore, *, tenant_id: str, user_id: str,
                   message: str, roster: list[dict[str, Any]] | None = None,
                   state: dict[str, Any] | None = None) -> dict[str, Any]:
    """对话引导主入口：返回 {reply, options, plan, state, done, applied}。

    纯确定性；落库只发生在用户「确认/就这样」之后。state 是给前端回传的
    不透明 JSON（服务端无会话表，客户端原样带回即可）。
    """
    roster = roster or []
    msg = str(message or "").strip()
    state = dict(state) if state else {}
    stage = state.get("stage", "ask_scale")

    # 1) 首开 / 未选规模：给三个规模选项
    if stage == "ask_scale":
        if not msg:
            return {
                "reply": "先选一下公司规模，我给你配一套合适的组织架构（规模不同，复杂程度不一样）：\n"
                         "1️⃣ 小规模（30 人以内，老板直接管）——2 个部门、3 类角色\n"
                         "2️⃣ 中规模（30~200 人）——5 个部门、6 类角色\n"
                         "3️⃣ 大规模（200 人以上，分工较细）——8 个部门、9 类角色\n"
                         "回复 1/2/3 或 小/中/大。",
                "options": [{"value": code, "label": preset["label"]}
                            for code, preset in SCALE_PRESETS.items()],
                "plan": None, "state": {"stage": "ask_scale"}, "done": False, "applied": None,
            }
        scale = _resolve_scale(msg)
        if scale not in SCALE_PRESETS:
            return {
                "reply": "没太看懂规模，回复 1/2/3 或 小/中/大 即可。",
                "options": [{"value": code, "label": preset["label"]}
                            for code, preset in SCALE_PRESETS.items()],
                "plan": None, "state": {"stage": "ask_scale"}, "done": False, "applied": None,
            }
        preset = SCALE_PRESETS[scale]
        new_state = {
            "stage": "propose",
            "scale": scale,
            "departments": list(preset["departments"]),
            "assignments": [],
        }
        role_names = " / ".join(_ROLE_NAME.get(r, r) for r in preset["roles"])
        return {
            "reply": f"按【{preset['label']}】给你搭了一套：\n"
                     f"部门：{'、'.join(preset['departments'])}\n"
                     f"角色：{role_names}\n\n"
                     "接下来直接告诉我要怎么调整就行，例如：\n"
                     "·「张三设为厂长」「李四、王五当组长」\n"
                     "·「新增部门 品质部」「删除 仓库」\n"
                     "·「张三不当组长了」\n"
                     "或者回复「就这样」按默认落地。",
            "options": [{"value": "confirm", "label": "就这样，按默认落地"}],
            "plan": {"departments": list(preset["departments"]),
                     "roles": preset["roles"], "assignments": []},
            "state": new_state, "done": False, "applied": None,
        }

    # 2) 提议/编辑阶段：确认落地 或 解析增删改意图
    departments: list[str] = list(state.get("departments") or [])
    assignments: list[dict[str, Any]] = list(state.get("assignments") or [])

    if _is_confirm(msg):
        return _apply(store, tenant_id=tenant_id, user_id=user_id, roster=roster,
                      departments=departments, assignments=assignments)

    changed = False
    remove_names = _parse_remove_assign(msg)
    if remove_names:
        before = len(assignments)
        assignments = [a for a in assignments if a["name"] not in remove_names]
        changed = changed or len(assignments) != before
        dropped = [n for n in remove_names if n not in {a["name"] for a in assignments}]
        if dropped:
            return _reply_edit(state, departments, assignments,
                               f"移除账号：{'、'.join(dropped)}。")

    assigned = _parse_assign(msg)
    if assigned:
        names, role = assigned
        for name in names:
            existing = next((a for a in assignments if a["name"] == name), None)
            if existing:
                if role not in existing["roles"]:
                    existing["roles"].append(role)
            else:
                assignments.append({"name": name, "roles": [role]})
        changed = True

    added_dept = _parse_add_dept(msg)
    if added_dept and _dept_org_id(added_dept) not in {_dept_org_id(d) for d in departments}:
        departments.append(added_dept)
        changed = True

    removed_dept = _parse_delete_dept(msg)
    if removed_dept:
        before = len(departments)
        departments = [d for d in departments if _dept_org_id(d) != _dept_org_id(removed_dept)]
        changed = changed or len(departments) != before

    if not changed:
        return _reply_edit(
            state, departments, assignments,
            "我没识别出改动。你可以这样说：\n"
            "·「张三设为厂长」「李四、王五当组长」\n"
            "·「新增部门 品质部」「删除 仓库」\n"
            "·「张三不当组长了」\n"
            "或回复「就这样」落地当前方案。")

    new_state = {"stage": "edit", "scale": state.get("scale"), "departments": departments,
                 "assignments": assignments}
    return _reply_edit(state, departments, assignments,
                       "已记录 ✅ 当前方案如下：", new_state=new_state)


def _reply_edit(state: dict[str, Any], departments: list[str], assignments: list[dict[str, Any]],
                prefix: str, new_state: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "reply": f"{prefix}\n{_plan_summary({'departments': departments, 'assignments': assignments})}\n"
                 "继续调整，或回复「就这样」落地。",
        "options": [{"value": "confirm", "label": "就这样，落地"}],
        "plan": {"departments": departments,
                 "roles": [role["role_code"] for role in DEFAULT_ROLE_SEEDS],
                 "assignments": [{"name": a["name"], "roles": a["roles"]} for a in assignments]},
        "state": new_state if new_state is not None else {
            "stage": "edit", "scale": state.get("scale"),
            "departments": departments, "assignments": assignments,
        },
        "done": False, "applied": None,
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
        user_code, entry = _resolve_user_id(store, tenant_id, roster, item["name"])
        bindings.append({"user_id": user_code, "role_codes": item["roles"],
                         "skill": (entry or {}).get("skill")})
    if bindings:
        store.bind_users_bulk(tenant_id=tenant_id, bindings=bindings)
    return {
        "reply": f"✅ 已落地：{len(departments)} 个部门、{len(bindings)} 个账号分配完成。\n"
                 "以后想改，直接跟我说「新增/删除部门」「谁当什么角色」就行。",
        "options": [],
        "plan": None,
        "state": None,
        "done": True,
        "applied": {"departments": len(departments), "bindings": len(bindings),
                    "departments_list": departments,
                    "assignments": [{"user_id": b["user_id"], "role_codes": b["role_codes"]}
                                    for b in bindings]},
    }
