"""工具级权限闸（F-013 补充：禁止不同角色调用无权工具）。

设计（用户裁定：不做源码物理删除，改为按角色禁止调用）：

- **单一事实源**：每个工具映射到一个 PR #6 已有的权限 code（`PERMISSION_CATALOG`），
  规则按「模块 + 工具名正则」表达，`TOOL_PERMISSION_OVERRIDES` 做个别修正；
- **执行点**：`ToolRegistry.call()` 是唯一硬闸（Skill 内部调用也走这里）；
- **fail-closed**：`YUNPAI_TOOL_AUTHZ=enforce`（默认）时，未登记映射或权限不足一律拒绝；
  `warn` 只记日志不拦截（本地迁移用）；`off` 关闭；
- **无 principal 不拦截**：内部调用/单测直接 `graph.run()` 时没有身份上下文，
  按 legacy 放行并记 trace；HTTP 入口（api.py）会带上 principal，所以真实用户
  请求一律受闸。
- **启动期校验**：`assert_full_coverage()` 保证 119 个工具全部有映射，漏配即失败
  （否则「漏配 = 默认放行」就是漏洞）。
"""
from __future__ import annotations

import os
import re
from typing import Any, Iterable, Mapping

#: (module, 工具名正则, 需要的权限 code)；按顺序匹配，第一条命中生效。
TOOL_PERMISSION_RULES: tuple[tuple[str, str, str], ...] = (
    # ---- M0 主数据 / canonical：读 → data.steward，发布候选 → candidate.approve ----
    (
        "m0",
        r"^(get_m0_|list_m0_|query_recognized_table$|sample_file$"
        r"|data_import_preview$|data_import_status$|data_import_history$|data_import_quarantine$)",
        "data.steward",
    ),
    ("m0", r"^(data_catalog_.*_publish|data_import_commit$|ingest_canonical$)", "candidate.approve"),
    ("m0", r".*", "order.ingest"),
    # ---- M1 订单解析：入库 → order.ingest，人工复核 → order.review，其余读 → order.view ----
    ("m1", r"^(ingest_document$|ingest_m1_archive$)", "order.ingest"),
    ("m1", r"^submit_m1_review$", "order.review"),
    ("m1", r".*", "order.view"),
    # ---- M2 BOM/SOP：工程确认，读运行记录 → order.view ----
    ("m2", r"^(get_m2_run$|list_m2_runs$)", "order.view"),
    ("m2", r".*", "engineering.approve"),
    # ---- M3 物料计划：读 → order.view，计算/审批 → procurement.supplement ----
    ("m3", r"^(get_|list_|export_)", "order.view"),
    ("m3", r".*", "procurement.supplement"),
    # ---- M4 采购：读 → order.view，其余（生成/审批/发送/供应商事实）→ procurement.supplement ----
    ("m4", r"^(get_|list_)", "order.view"),
    ("m4", r".*", "procurement.supplement"),
    # ---- M5 排程：求解 → schedule.solve，发布派发 → schedule.release，其余 → report.view ----
    (
        "m5",
        r"^(solve_scheduling$|run_m5_intelligent_schedule$|replan_m5_schedule$"
        r"|advise_m5_schedule$|ingest_m5_planning_snapshot$)",
        "schedule.solve",
    ),
    ("m5", r"^dispatch_m5_schedule$", "schedule.release"),
    ("m5", r".*", "report.view"),
)

#: 个别工具的人工修正（优先级高于规则）。
TOOL_PERMISSION_OVERRIDES: dict[str, str] = {
    # 组长派工/工作量台账：组长与厂长可见（report.view），工人不可。
    "report_workload": "report.view",
    "bind_worker_to_order": "report.view",
    # 部门消息与知识沉淀：管理层读报用。
    "prepare_m5_department_message": "report.view",
    "record_m5_knowledge": "report.view",
}

_COMPILED: tuple[tuple[str, re.Pattern[str], str], ...] = tuple(
    (module, re.compile(pattern), code) for module, pattern, code in TOOL_PERMISSION_RULES
)


def authz_mode() -> str:
    """``YUNPAI_TOOL_AUTHZ`` = off | warn | enforce（默认 enforce）。"""
    mode = os.getenv("YUNPAI_TOOL_AUTHZ", "enforce").strip().lower()
    return mode if mode in {"off", "warn", "enforce"} else "enforce"


def permission_for_tool(name: str, module: str = "") -> str | None:
    """工具 → 需要的权限 code；未登记返回 None（调用方按 fail-closed 处理）。"""
    override = TOOL_PERMISSION_OVERRIDES.get(name)
    if override:
        return override
    for rule_module, pattern, code in _COMPILED:
        if module and rule_module != module:
            continue
        if pattern.search(name):
            return code
    return None


def tool_permissions_map(specs: Mapping[str, Any] | Iterable[Any]) -> dict[str, str]:
    """{工具名: 权限 code}；任何工具缺映射都会出现在结果缺失项里。"""
    items = specs.values() if isinstance(specs, Mapping) else specs
    result: dict[str, str] = {}
    for spec in items:
        name = str(getattr(spec, "name", "") or "")
        module = str(getattr(spec, "module", "") or "")
        code = permission_for_tool(name, module)
        if name and code:
            result[name] = code
    return result


def unmapped_tools(specs: Mapping[str, Any] | Iterable[Any]) -> list[str]:
    """没有权限映射的工具名（启动期必须为空）。"""
    items = specs.values() if isinstance(specs, Mapping) else specs
    missing: list[str] = []
    for spec in items:
        name = str(getattr(spec, "name", "") or "")
        module = str(getattr(spec, "module", "") or "")
        if name and permission_for_tool(name, module) is None:
            missing.append(name)
    return sorted(missing)


def assert_full_coverage(specs: Mapping[str, Any] | Iterable[Any]) -> None:
    """启动期校验：所有工具都必须有权限映射，否则抛错（禁止漏配放行）。"""
    missing = unmapped_tools(specs)
    if missing:
        raise RuntimeError(
            "工具权限映射不完整，已拒绝启动（漏配即默认放行）："
            + ", ".join(missing[:20])
            + ("…" if len(missing) > 20 else "")
        )


def tool_allowed(name: str, module: str, permissions: Iterable[str] | None,
                 scopes: Mapping[str, str] | None = None) -> bool:
    """工具是否对给定权限集合可用（用于 /tools 过滤与前端能力展示）。

    ``scopes`` 是查看类权限的数据范围（PR #6 的 ``permission_scopes``）：
    工具映射按租户级登记，因此 `@self`/`@dept` 的窄范围授权**不满足**工具要求
    （否则 `order.view@self` 的工人能读到全租户订单）。范围过滤本身仍列 v2。
    """
    if permissions is None:
        return True
    required = permission_for_tool(name, module)
    if required is None:
        return False
    if required not in set(permissions):
        return False
    return str((scopes or {}).get(required, "tenant")) == "tenant"
