"""组织节点工具 `create_org_node`：建公司/部门/班组、父节点挂载、幂等复用、权限闸。

用户场景：「创建1班组 小组长是王五 把张伟分到1班组里面」——以前系统没有建组织节点的
工具，模型只能去建号并反问。本文件覆盖这层后端能力：

1. 工具已注册、本地绑定，权限映射为 identity.admin（漏配即启动失败）；
2. 建「生产部」→ 建「1班组」（parent_name=生产部）→ 返回 org_id/org_path 且落库；
3. 同名同父重复调用**复用**（org_id 不变、树里只有 1 个）；
4. 父节点找不到 → ORG_PARENT_NOT_FOUND；
5. 没有 identity.admin 权限 → 被 ToolRegistry 硬闸拒绝。
"""
import pytest

from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.registry import ToolForbiddenError, build_default_registry
from yunpai_langgraph.tool_permissions import assert_full_coverage, permission_for_tool


@pytest.fixture()
def org_env(tmp_path, monkeypatch):
    db = tmp_path / "org.sqlite"
    monkeypatch.setenv("YUNPAI_IDENTITY_DB", str(db))
    monkeypatch.setenv("YUNPAI_TOOL_AUTHZ", "enforce")
    return IdentityStore(str(db))


def _context(permissions, scopes=None):
    return {
        "tenant_id": "default",
        "task_id": "task-org",
        "run_id": "run-org",
        "principal": {"actor": "boss", "tenant_id": "default"},
        "principal_permissions": list(permissions),
        "principal_scopes": dict(scopes or {}),
    }


BOSS = ("identity.admin",)


def test_create_org_node_registered_bound_and_mapped():
    registry = build_default_registry()
    assert "create_org_node" in registry.specs
    assert "create_org_node" in registry.handlers
    assert registry.specs["create_org_node"].module == "identity"
    assert registry.specs["create_org_node"].execution == "sync"
    assert registry.specs["create_org_node"].side_effect == "external_write"
    assert registry.specs["create_org_node"].review_gate == "none"
    assert permission_for_tool("create_org_node", "identity") == "identity.admin"
    assert_full_coverage(registry.specs)
    # 输入合同：name 必填（另一个子任务的提示词按这个 schema 引用）
    schema = registry.specs["create_org_node"].input_schema
    assert schema["required"] == ["name"]
    assert schema["properties"]["org_type"]["enum"] == ["company", "dept", "team"]
    assert set(schema["properties"]) == {"name", "org_type", "parent_name", "parent_id"}


@pytest.mark.asyncio
async def test_create_org_node_under_parent_and_reuse(org_env):
    """建「生产部」→ 建「1班组」（父=生产部）→ 重复调用复用同一个节点。"""
    registry = build_default_registry()
    boss = _context(BOSS, {"identity.admin": "tenant"})

    dept = await registry.call("create_org_node", {"name": "生产部"}, boss)
    assert dept["org_id"] and dept["org_type"] == "dept"
    assert dept["parent_id"] is None
    assert dept["org_path"] == [dept["org_id"]]
    assert dept["created"] is True and dept["reused"] is False

    team = await registry.call("create_org_node",
                               {"name": "1班组", "parent_name": "生产部"}, boss)
    assert team["name"] == "1班组"
    assert team["org_type"] == "team"
    assert team["parent_id"] == dept["org_id"]
    assert team["org_path"] == [dept["org_id"], team["org_id"]]
    assert team["org_path_names"] == ["生产部", "1班组"]

    tree = org_env.org_tree(tenant_id="default")
    assert {node["org_id"] for node in tree} == {dept["org_id"], team["org_id"]}
    assert next(node for node in tree if node["org_id"] == team["org_id"])["parent_id"] == dept["org_id"]

    # 同名同父 → 复用：org_id 不变、树里仍然只有 1 个「1班组」
    again = await registry.call("create_org_node",
                                {"name": "1班组", "parent_name": "生产部"}, boss)
    assert again["org_id"] == team["org_id"]
    assert again["reused"] is True and again["created"] is False
    tree = org_env.org_tree(tenant_id="default")
    assert len([node for node in tree if node["name"] == "1班组"]) == 1
    assert len(tree) == 2

    # 同名不同父 → 另建一个（不覆盖）
    other = await registry.call("create_org_node", {"name": "1班组"}, boss)
    assert other["org_id"] != team["org_id"]
    assert len([node for node in org_env.org_tree(tenant_id="default")
                if node["name"] == "1班组"]) == 2


@pytest.mark.asyncio
async def test_create_org_node_infers_type_and_accepts_parent_id(org_env):
    """org_type 按名称推断（公司/部/班组），parent_id 直连也支持。"""
    registry = build_default_registry()
    boss = _context(BOSS, {"identity.admin": "tenant"})

    company = await registry.call("create_org_node", {"name": "桐庐云湃电子有限公司"}, boss)
    assert company["org_type"] == "company"
    dept = await registry.call("create_org_node",
                               {"name": "品保部", "parent_id": company["org_id"]}, boss)
    assert dept["org_type"] == "dept"
    assert dept["parent_id"] == company["org_id"]
    # 兜底 team；显式 org_type 优先于推断
    workshop = await registry.call("create_org_node", {"name": "装配车间", "parent_name": "品保部"}, boss)
    assert workshop["org_type"] == "team"
    explicit = await registry.call("create_org_node",
                                   {"name": "临时机构", "org_type": "dept", "parent_name": "品保部"}, boss)
    assert explicit["org_type"] == "dept"


@pytest.mark.asyncio
async def test_create_org_node_parent_not_found(org_env):
    from yunpai_langgraph.registry import ToolHTTPError

    registry = build_default_registry()
    boss = _context(BOSS, {"identity.admin": "tenant"})
    with pytest.raises(ToolHTTPError) as exc:
        await registry.call("create_org_node", {"name": "1班组", "parent_name": "不存在部"}, boss)
    assert "ORG_PARENT_NOT_FOUND" in str(exc.value)
    assert org_env.org_tree(tenant_id="default") == []

    with pytest.raises(ToolHTTPError) as exc2:
        await registry.call("create_org_node", {"name": "1班组", "parent_id": "dept-nope"}, boss)
    assert "ORG_PARENT_NOT_FOUND" in str(exc2.value)


@pytest.mark.asyncio
async def test_create_org_node_requires_name(org_env):
    registry = build_default_registry()
    boss = _context(BOSS, {"identity.admin": "tenant"})
    with pytest.raises(ValueError) as exc:
        await registry.call("create_org_node", {}, boss)
    assert "invalid input for create_org_node" in str(exc.value)


@pytest.mark.asyncio
async def test_worker_cannot_create_org_node(org_env):
    registry = build_default_registry()
    worker = _context(["order.view"], {"order.view": "self"})
    with pytest.raises(ToolForbiddenError) as exc:
        await registry.call("create_org_node", {"name": "1班组"}, worker)
    assert exc.value.required == "identity.admin"
    assert exc.value.code == "TOOL_FORBIDDEN"
    assert org_env.org_tree(tenant_id="default") == []


def test_create_org_node_human_reply_and_progress():
    from yunpai_langgraph.graph import YunpaiGraph

    created = {"tenant_id": "default", "org_id": "team-1", "name": "1班组",
               "org_type": "team", "parent_id": "dept-prod",
               "org_path": ["dept-prod", "team-1"],
               "org_path_names": ["生产部", "1班组"],
               "created": True, "reused": False}
    text = YunpaiGraph._finalize_response(
        {"status": "completed", "response": "", "trace": [], "outputs": {"create_org_node": created}})
    assert "已创建组织节点" in text and "1班组" in text and "team-1" in text
    assert "生产部 → 1班组" in text

    reused = {**created, "created": False, "reused": True}
    text = YunpaiGraph._finalize_response(
        {"status": "completed", "response": "", "trace": [], "outputs": {"create_org_node": reused}})
    assert "复用" in text

    assert YunpaiGraph._step_progress_text(
        {"module": "identity", "tool": "create_org_node"}) == "正在建组织…"


def test_org_error_hints_are_actionable():
    from yunpai_langgraph.graph import YunpaiGraph

    assert "上级组织" in YunpaiGraph._friendly_error(
        "create_org_node: ORG_PARENT_NOT_FOUND: 父组织不存在: 生产部")
    assert "组织名" in YunpaiGraph._friendly_error(
        "create_org_node: INVALID_ORG_NAME: 需要给出组织节点名称")
