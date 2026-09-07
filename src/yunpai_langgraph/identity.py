"""身份·组织架构·权限占位模块（F-013/F-014/F-015 骨架，2026-09-07）。

**当前状态：占位实现**——数据模型、存储、解析链路、派生钩子已就位并可运行，
但权限语义等待「组织架构与权限说明」（用户交付）落定后填充 enforcement。
规范未到之前的兼容行为见模块尾部 ``SPEC_INTAKE_POINTS``。

三本账定位：
- F-013 权限隔离与多租户鉴权：``Permission``/``Role``/``UserBinding`` +
  ``resolve()``/``authorize()`` 是用户-租户-权限绑定的最小闭环；
- F-014 组织架构：``OrgNode`` 部门树 + ``derive_org_from_workers()``
  （从人员主数据自动派生的占位算法）；
- F-015 引导 AI：``PERMISSION_CATALOG`` 是「业务语言权限清单」的种子
  （与现有 Gate 语义一一对应，后续对话引导/组织推荐在此之上叠加）。

设计约束（与仓库原则一致）：
- 占位不改变现网行为：无绑定时 fail-closed，但 ``IDENTITY_BOOTSTRAP_ADMIN``
  提供过渡入口（见 ``authorize``）；受信头旧角色走 ``legacy_grant`` 兼容；
- SQLite 底座遵循 ``db_utils`` 约定（WAL/busy_timeout/用后即关）；
- 不引入登录/JWT——那是 F-013 正式实现的范围，本模块只提供身份解析与
  授权判定的事实源。
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .db_utils import connect_sqlite, enable_wal, transactional

# ---------------------------------------------------------------------------
# 业务语言权限清单（F-015 ① 种子）：与现有 Gate/工具副作用一一对应。
# 正式说明到位后可增删改；code 是稳定标识，label 是业务语言。
# ---------------------------------------------------------------------------

PERMISSION_CATALOG: tuple[dict[str, str], ...] = (
    {"code": "order.view", "label": "查看订单", "gate": "-"},
    {"code": "order.ingest", "label": "上传/入库订单与业务资料", "gate": "candidate"},
    {"code": "candidate.approve", "label": "批准业务资料候选进入 M0", "gate": "candidate"},
    {"code": "sensitive.review", "label": "复核敏感资料（工资/人事）", "gate": "sensitive_data"},
    {"code": "order.review", "label": "复核 M1 订单解析结果", "gate": "review"},
    {"code": "engineering.approve", "label": "工程批准 BOM/SOP 路线", "gate": "engineering"},
    {"code": "procurement.supplement", "label": "补充供应商与交期", "gate": "procurement"},
    {"code": "schedule.solve", "label": "发起排程求解", "gate": "-"},
    {"code": "schedule.release", "label": "发布/生效生产排程", "gate": "apply"},
    {"code": "data.steward", "label": "维护主数据（物料/产品/BOM/route）", "gate": "-"},
    {"code": "identity.admin", "label": "管理组织架构与权限分配", "gate": "-"},
)

#: 受信头旧角色 → 权限的过渡映射（F-013 落地前的兼容层，语义等价现状）。
LEGACY_ROLE_GRANTS: dict[str, frozenset[str]] = {
    "admin": frozenset(p["code"] for p in PERMISSION_CATALOG),
    "data-steward": frozenset({"order.view", "order.ingest", "data.steward"}),
    "m0-reviewer": frozenset({"order.view", "candidate.approve", "data.steward"}),
}

DEFAULT_ROLE_SEEDS: tuple[dict[str, Any], ...] = (
    {"role_code": "org-admin", "name": "组织管理员", "permissions": ["identity.admin"]},
    {"role_code": "data-steward", "name": "主数据管理员",
     "permissions": ["order.view", "order.ingest", "data.steward", "candidate.approve"]},
    {"role_code": "engineer", "name": "工程审批",
     "permissions": ["order.view", "engineering.approve"]},
    {"role_code": "planner", "name": "计划员",
     "permissions": ["order.view", "schedule.solve", "procurement.supplement"]},
    {"role_code": "release-manager", "name": "发布负责人",
     "permissions": ["order.view", "schedule.release"]},
)


def _default_db_path() -> str:
    return os.getenv("YUNPAI_IDENTITY_DB", "runtime/yunpai-identity.sqlite")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class IdentityStore:
    """组织架构/角色/用户绑定 的 SQLite 事实源（占位层，WAL + db_utils 约定）。"""

    def __init__(self, db_path: str | None = None):
        self.db_path = str(db_path or _default_db_path())
        parent = os.path.dirname(self.db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = connect_sqlite(self.db_path, foreign_keys=True)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _txn(self) -> Iterator[sqlite3.Connection]:
        db = self._connect()
        try:
            with db:
                yield db
        finally:
            db.close()

    def _init(self) -> None:
        with transactional(self._connect()) as db:
            enable_wal(db)
            db.execute(
                """CREATE TABLE IF NOT EXISTS org_nodes (
                    org_id TEXT PRIMARY KEY,
                    parent_id TEXT,
                    name TEXT NOT NULL,
                    org_type TEXT NOT NULL DEFAULT 'dept',
                    source TEXT NOT NULL DEFAULT 'manual',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(parent_id) REFERENCES org_nodes(org_id)
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS roles (
                    tenant_id TEXT NOT NULL,
                    role_code TEXT NOT NULL,
                    name TEXT NOT NULL,
                    permissions TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(tenant_id, role_code)
                )"""
            )
            db.execute(
                """CREATE TABLE IF NOT EXISTS user_bindings (
                    tenant_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    org_id TEXT,
                    role_codes TEXT NOT NULL DEFAULT '[]',
                    created_at TEXT NOT NULL,
                    PRIMARY KEY(tenant_id, user_id),
                    FOREIGN KEY(org_id) REFERENCES org_nodes(org_id)
                )"""
            )
            db.execute("CREATE INDEX IF NOT EXISTS idx_user_tenant ON user_bindings(tenant_id)")
            # 种子角色（幂等）：租户 default 的开箱角色集；正式说明可覆盖。
            for role in DEFAULT_ROLE_SEEDS:
                db.execute(
                    "INSERT OR IGNORE INTO roles(tenant_id, role_code, name, permissions, created_at) VALUES(?,?,?,?,?)",
                    ("default", role["role_code"], role["name"],
                     _dump(role["permissions"]), _now()),
                )

    # ------------------------------------------------------------- 组织架构

    def upsert_org(self, *, org_id: str, name: str, parent_id: str | None = None,
                   org_type: str = "dept", source: str = "manual") -> dict[str, Any]:
        with self._txn() as db:
            db.execute(
                """INSERT INTO org_nodes(org_id, parent_id, name, org_type, source, created_at)
                   VALUES(?,?,?,?,?,?)
                   ON CONFLICT(org_id) DO UPDATE SET
                     parent_id=excluded.parent_id, name=excluded.name,
                     org_type=excluded.org_type, source=excluded.source""",
                (org_id, parent_id, name, org_type, source, _now()),
            )
        return {"org_id": org_id, "name": name, "parent_id": parent_id, "org_type": org_type, "source": source}

    def org_tree(self) -> list[dict[str, Any]]:
        with self._txn() as db:
            rows = db.execute("SELECT org_id, parent_id, name, org_type, source FROM org_nodes ORDER BY org_id").fetchall()
        return [dict(row) for row in rows]

    def org_path(self, org_id: str) -> list[str]:
        """从根到该节点的 org_id 路径（环防护：最长 16 层）。"""
        by_id = {node["org_id"]: node for node in self.org_tree()}
        path: list[str] = []
        current = org_id
        while current and current in by_id and len(path) < 16:
            path.append(current)
            current = by_id[current].get("parent_id")
        return list(reversed(path))

    def derive_org_from_workers(self, workers: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """F-014 占位派生：按人员记录的部门/产线字段生成两级组织树。

        正式「组织架构说明」到位后，本算法由说明定义的派生规则替换；
        当前规则：公司根节点 ← 部门（dept 字段）← 产线（line 字段，可选）。
        幂等：source='derived'，同名节点不重复建。
        """
        created: list[dict[str, Any]] = []
        existing = {node["org_id"] for node in self.org_tree()}
        if "company" not in existing:
            created.append(self.upsert_org(org_id="company", name="公司", org_type="company", source="derived"))
            existing.add("company")
        for worker in workers:
            if not isinstance(worker, dict):
                continue
            dept = str(worker.get("dept") or worker.get("department") or "").strip()
            if not dept or f"dept:{dept}" in existing:
                continue
            created.append(self.upsert_org(
                org_id=f"dept:{dept}", name=dept, parent_id="company",
                org_type="dept", source="derived"))
            existing.add(f"dept:{dept}")
            line = str(worker.get("line") or "").strip()
            if line and f"line:{dept}:{line}" not in existing:
                created.append(self.upsert_org(
                    org_id=f"line:{dept}:{line}", name=line, parent_id=f"dept:{dept}",
                    org_type="line", source="derived"))
                existing.add(f"line:{dept}:{line}")
        return created

    # ---------------------------------------------------------- 角色/绑定

    def upsert_role(self, *, tenant_id: str, role_code: str, name: str,
                    permissions: list[str]) -> dict[str, Any]:
        known = {p["code"] for p in PERMISSION_CATALOG}
        unknown = [p for p in permissions if p not in known]
        if unknown:
            raise ValueError(f"未知权限 code: {unknown}（合法集合见 PERMISSION_CATALOG）")
        with self._txn() as db:
            db.execute(
                """INSERT INTO roles(tenant_id, role_code, name, permissions, created_at)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(tenant_id, role_code) DO UPDATE SET
                     name=excluded.name, permissions=excluded.permissions""",
                (tenant_id, role_code, name, _dump(permissions), _now()),
            )
        return {"tenant_id": tenant_id, "role_code": role_code, "name": name, "permissions": permissions}

    def bind_user(self, *, tenant_id: str, user_id: str, role_codes: list[str],
                  org_id: str | None = None) -> dict[str, Any]:
        with self._txn() as db:
            for role in role_codes:
                exists = db.execute(
                    "SELECT 1 FROM roles WHERE tenant_id=? AND role_code=?", (tenant_id, role)).fetchone()
                if not exists:
                    raise ValueError(f"未注册角色: {role}（租户 {tenant_id}）")
            db.execute(
                """INSERT INTO user_bindings(tenant_id, user_id, org_id, role_codes, created_at)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(tenant_id, user_id) DO UPDATE SET
                     org_id=excluded.org_id, role_codes=excluded.role_codes""",
                (tenant_id, user_id, org_id, _dump(role_codes), _now()),
            )
        return {"tenant_id": tenant_id, "user_id": user_id, "role_codes": role_codes, "org_id": org_id}

    # -------------------------------------------------------------- 解析

    def resolve(self, *, tenant_id: str, user_id: str) -> dict[str, Any]:
        """用户 → 角色/权限/组织路径 的解析闭环（F-013 最小内核）。

        无绑定时返回空权限（fail-closed）；``authorize`` 再决定过渡期行为。
        """
        with self._txn() as db:
            row = db.execute(
                "SELECT org_id, role_codes FROM user_bindings WHERE tenant_id=? AND user_id=?",
                (tenant_id, user_id)).fetchone()
            role_rows = db.execute(
                "SELECT role_code, name, permissions FROM roles WHERE tenant_id=?",
                (tenant_id,)).fetchall()
        roles_by_code = {r["role_code"]: dict(r) for r in role_rows}
        bound_roles: list[str] = list(_load(row["role_codes"])) if row else []
        permissions: set[str] = set()
        for code in bound_roles:
            permissions.update(_load(roles_by_code.get(code, {}).get("permissions") or "[]"))
        return {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "roles": bound_roles,
            "role_names": [roles_by_code.get(c, {}).get("name", c) for c in bound_roles],
            "permissions": sorted(permissions),
            "org_id": row["org_id"] if row else None,
            "org_path": self.org_path(row["org_id"]) if row and row["org_id"] else [],
        }


def authorize(store: IdentityStore, *, tenant_id: str, user_id: str, permission: str,
              legacy_roles: list[str] | None = None) -> dict[str, Any]:
    """授权判定（占位语义，规范未到前的确定性行为）。

    1. 显式绑定权限优先（resolve 结果含 permission → allow）；
    2. 过渡兼容：受信头旧角色按 ``LEGACY_ROLE_GRANTS`` 授予（与现状等价，
       F-013 正式落地时移除）；
    3. 引导管理员：``IDENTITY_BOOTSTRAP_ADMIN`` 命名用户拿 identity.admin
       （首个组织建立前的运维通道）；
    4. 其余 deny（fail-closed，含绑定用户越权请求）。
    """
    resolved = store.resolve(tenant_id=tenant_id, user_id=user_id)
    if permission in resolved["permissions"]:
        return {"allowed": True, "reason": "binding", "resolved": resolved}
    for legacy in legacy_roles or []:
        if permission in LEGACY_ROLE_GRANTS.get(legacy, frozenset()):
            return {"allowed": True, "reason": f"legacy_role:{legacy}", "resolved": resolved}
    bootstrap = os.getenv("IDENTITY_BOOTSTRAP_ADMIN", "").strip()
    if bootstrap and user_id == bootstrap and permission == "identity.admin":
        return {"allowed": True, "reason": "bootstrap_admin", "resolved": resolved}
    return {"allowed": False, "reason": "fail_closed", "resolved": resolved}


def _dump(value: list[str]) -> str:
    import json
    return json.dumps(value, ensure_ascii=False)


def _load(text: str) -> list[str]:
    import json
    try:
        value = json.loads(text)
        return [str(v) for v in value] if isinstance(value, list) else []
    except ValueError:
        return []


#: 规范落点清单：用户交付「组织架构与权限说明」后，按以下接缝填充正式实现。
SPEC_INTAKE_POINTS: tuple[dict[str, str], ...] = (
    {"point": "PERMISSION_CATALOG", "slot": "业务语言权限清单（增删/分级/资源维度）"},
    {"point": "DEFAULT_ROLE_SEEDS / upsert_role", "slot": "租户→角色/权限集映射与差异化"},
    {"point": "derive_org_from_workers", "slot": "组织架构派生规则（部门树/汇报关系/岗位）"},
    {"point": "authorize（LEGACY_ROLE_GRANTS/bootstrap）", "slot": "enforcement 正式语义与旧角色退役计划"},
    {"point": "api.py principal 头", "slot": "登录/身份签发替换受信头（F-013 范围）"},
)
