"""对话建账号 / 分配账号：工具注册、权限闸、真实落库与路由。

用户流程：厂长注册 → 组织推荐（可跳过）→ 会话页 → 在对话里给员工注册账号、分配账号。
本文件覆盖后端这层的三件事：
1. 三个身份工具已注册且本地绑定，权限映射为 identity.admin（漏配即启动失败）；
2. 厂长（identity.admin）能建号/调岗，工人（order.view@self）被 ToolRegistry 硬闸拒绝；
3. 确定性路由能按中文意图选中对应工具（模型不可用时的兜底）。
"""
import pytest

from yunpai_langgraph.agents import PlannerAgent
from yunpai_langgraph.auth import verify_password
from yunpai_langgraph.identity import IdentityStore
from yunpai_langgraph.llm import QwenConfig, QwenRouter
from yunpai_langgraph.registry import ToolForbiddenError, build_default_registry
from yunpai_langgraph.tool_permissions import assert_full_coverage, permission_for_tool

IDENTITY_TOOLS = ("list_identity_users", "create_identity_user", "assign_identity_account")


@pytest.fixture()
def identity_env(tmp_path, monkeypatch):
    db = tmp_path / "identity.sqlite"
    monkeypatch.setenv("YUNPAI_IDENTITY_DB", str(db))
    monkeypatch.setenv("YUNPAI_TOOL_AUTHZ", "enforce")
    store = IdentityStore(str(db))
    store.upsert_org(tenant_id="default", org_id="company", name="测试工厂", org_type="company")
    store.upsert_org(tenant_id="default", org_id="team-asm", name="装配班组",
                     parent_id="company", org_type="team")
    return store


def _context(permissions, scopes=None):
    return {
        "tenant_id": "default",
        "task_id": "task-identity",
        "run_id": "run-identity",
        "principal": {"actor": "boss", "tenant_id": "default"},
        "principal_permissions": list(permissions),
        "principal_scopes": dict(scopes or {}),
    }


def test_identity_tools_registered_bound_and_mapped():
    registry = build_default_registry()
    for name in IDENTITY_TOOLS:
        assert name in registry.specs, name
        assert name in registry.handlers, name
        assert registry.specs[name].module == "identity"
        assert permission_for_tool(name, "identity") == "identity.admin"
    assert_full_coverage(registry.specs)


@pytest.mark.asyncio
async def test_boss_can_create_and_assign_account(identity_env):
    registry = build_default_registry()
    boss = _context(["identity.admin", "order.view"], {"identity.admin": "tenant", "order.view": "tenant"})

    created = await registry.call(
        "create_identity_user",
        {"user_id": "worker900", "display_name": "张伟", "role_codes": ["worker"],
         "org_id": "team-asm", "skill": "装配工"},
        boss,
    )
    assert created["user_id"] == "worker900"
    assert created["org_id"] == "team-asm"
    assert created["role_codes"] == ["worker"]
    assert created["must_change_password"] is True
    assert len(created["initial_password"]) >= 8
    user = identity_env.get_user(tenant_id="default", user_id="worker900")
    assert user["display_name"] == "张伟"
    assert verify_password(created["initial_password"], user["password_hash"])

    assigned = await registry.call(
        "assign_identity_account",
        {"user_id": "worker900", "org_id": "team-asm", "role_codes": ["team-leader"]},
        boss,
    )
    assert assigned["role_codes"] == ["team-leader"]
    bindings = identity_env.list_bindings(tenant_id="default", user_id="worker900")
    assert bindings[0]["role_codes"] == ["team-leader"]

    listed = await registry.call("list_identity_users", {"role": "team-leader"}, boss)
    assert [item["user_id"] for item in listed["users"]] == ["worker900"]


@pytest.mark.asyncio
async def test_duplicate_account_is_rejected(identity_env):
    from yunpai_langgraph.registry import ToolHTTPError

    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    await registry.call("create_identity_user", {"user_id": "worker901"}, boss)
    with pytest.raises(ToolHTTPError) as exc:
        await registry.call("create_identity_user", {"user_id": "worker901"}, boss)
    assert "USER_EXISTS" in str(exc.value)


@pytest.mark.asyncio
async def test_worker_cannot_call_identity_tools(identity_env):
    registry = build_default_registry()
    worker = _context(["order.view"], {"order.view": "self"})
    with pytest.raises(ToolForbiddenError) as exc:
        await registry.call("create_identity_user", {"user_id": "worker902"}, worker)
    assert exc.value.required == "identity.admin"
    assert exc.value.code == "TOOL_FORBIDDEN"
    assert identity_env.get_user(tenant_id="default", user_id="worker902") is None


@pytest.mark.asyncio
async def test_worker_tool_list_excludes_identity_tools(identity_env):
    registry = build_default_registry()
    from yunpai_langgraph.tool_permissions import tool_allowed

    visible = [
        spec.name for spec in registry.specs.values()
        if tool_allowed(spec.name, spec.module, ["order.view"], {"order.view": "tenant"})
    ]
    assert visible, "工人至少应看到只读工具"
    assert not set(IDENTITY_TOOLS) & set(visible)


def test_identity_intent_args_extraction():
    from yunpai_langgraph.agents import identity_intent_args, identity_intent_tool

    args = identity_intent_args("create_identity_user", "帮我给张伟建个工人账号 worker100，放在装配班组")
    assert args == {"user_id": "worker100", "display_name": "张伟",
                    "role_codes": ["worker"], "org_name": "装配班组"}
    assign = identity_intent_args("assign_identity_account", "把 worker778 调到装配班组，让他当组长")
    assert assign["user_id"] == "worker778"
    assert assign["role_codes"] == ["team-leader"]
    assert assign["org_name"] == "装配班组"
    assert "display_name" not in assign
    # 抽不到就不编造
    assert identity_intent_args("create_identity_user", "给工人建个账号") == {"role_codes": ["worker"]}

    # 「申请」也要认；账号与姓名都要抽到
    assert identity_intent_tool("给张一申请一个工人账号 worker100") == "create_identity_user"
    applied = identity_intent_args("create_identity_user", "给张一申请一个工人账号 worker100")
    assert applied == {"user_id": "worker100", "display_name": "张一", "role_codes": ["worker"]}

    # 多人：「他们分别是赵一 李二 王三 孙四 高五」→ people 数组
    batch_text = "帮我给5个工人分配一下账号 他们分别是赵一 李二 王三 孙四 高五"
    assert identity_intent_tool(batch_text) == "create_identity_user"
    batch = identity_intent_args("create_identity_user", batch_text)
    assert [item["display_name"] for item in batch["people"]] == ["赵一", "李二", "王三", "孙四", "高五"]
    assert batch["role_codes"] == ["worker"]
    # 「把 X 分配到 Y」仍然是调岗，不是建号
    assert identity_intent_tool("把 worker001 分配到装配班组") == "assign_identity_account"


@pytest.mark.asyncio
async def test_batch_create_accounts(identity_env):
    """一次给 5 个人建号：账号自动生成，返回 5 条一次性密码。"""
    from yunpai_langgraph.registry import build_default_registry

    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    result = await registry.call("create_identity_user", {
        "people": [{"display_name": name} for name in ("赵一", "李二", "王三", "孙四", "高五")],
        "role_codes": ["worker"], "org_id": "team-asm",
    }, boss)
    assert result["count"] == 5
    assert [item["user_id"] for item in result["created"]] == [
        "worker001", "worker002", "worker003", "worker004", "worker005"]
    assert all(len(item["initial_password"]) >= 8 for item in result["created"])
    users = identity_env.list_users(tenant_id="default")
    assert len(users) == 5
    assert all(user["org_id"] == "team-asm" for user in users)


@pytest.mark.asyncio
async def test_single_create_accepts_name_only(identity_env):
    """只给姓名也能建号（账号按前缀自动生成）。"""
    from yunpai_langgraph.registry import build_default_registry

    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    result = await registry.call("create_identity_user", {"display_name": "张一"}, boss)
    assert result["user_id"] == "worker001"
    assert result["display_name"] == "张一"
    assert result["initial_password"]


@pytest.mark.asyncio
async def test_model_tool_args_land_in_request_payloads():
    """模型给的 args 必须落到 request.payloads，供 graph._payload_for 取用。"""
    from yunpai_langgraph.registry import build_default_registry

    class ArgsRouter:
        async def classify(self, request, registry):
            return {
                "ok": True, "status": "ok",
                "decision": {"intent": "建账号", "route": "free", "tools": ["create_identity_user"],
                             "args": {"create_identity_user": {"user_id": "worker903", "org_name": "装配班组"}},
                             "confidence": 0.9, "reason": "身份管理"},
                "model": {"provider": "qwen", "status": "ok"},
            }

    request = {"message": "给张伟建个工人账号 worker903"}
    plan = await PlannerAgent(ArgsRouter()).aplan(request, build_default_registry())
    assert plan["route"] == "free"
    assert plan["steps"][0]["tool"] == "create_identity_user"
    payload = request["payloads"]["create_identity_user"]
    assert payload["user_id"] == "worker903"
    assert payload["org_name"] == "装配班组"
    # 词表不再抢着补参数（AI 主导）；role_codes 缺省由工具按 worker 兜底
    assert "role_codes" not in payload


@pytest.mark.asyncio
async def test_word_list_only_fallbacks_when_model_unavailable():
    """词表只在模型不可用时兜底；模型可用时一律由 AI 主导（不抢它的决定）。"""
    from yunpai_langgraph.registry import build_default_registry

    class DownRouter:
        async def classify(self, request, registry):
            return {"ok": False, "status": "not_configured", "error": "no api key"}

    plan = await PlannerAgent(DownRouter()).aplan(
        {"message": "现在有哪些账号", "tools": []}, build_default_registry())
    assert plan["route"] == "free"
    assert plan["steps"][0]["tool"] == "list_identity_users"
    assert plan["route_decision"]["source"] in {"identity_intent", "deterministic_fallback"}


def test_account_word_variants_and_model_args_fallback():
    """「账户/帐号」也要认；模型只给工具名时用中文抽取补参数。"""
    from yunpai_langgraph.agents import identity_intent_args, identity_intent_tool, merge_identity_args

    message = "给张二申请一个工人账户worker101"
    assert identity_intent_tool(message) == "create_identity_user"
    assert identity_intent_args("create_identity_user", message) == {
        "user_id": "worker101", "display_name": "张二", "role_codes": ["worker"]}

    request = {"message": message}
    plan = {"route": "free", "steps": [{"tool": "create_identity_user", "module": "identity"}]}
    merge_identity_args(request, plan)
    assert request["payloads"]["create_identity_user"]["user_id"] == "worker101"

    # 模型给的参数优先，缺失字段由兜底补齐
    request2 = {"message": message, "payloads": {"create_identity_user": {"user_id": "worker999"}}}
    merge_identity_args(request2, plan)
    payload = request2["payloads"]["create_identity_user"]
    assert payload["user_id"] == "worker999"
    assert payload["display_name"] == "张二"


def test_finalize_response_turns_tool_result_into_human_reply():
    from yunpai_langgraph.graph import YunpaiGraph

    created = {"tenant_id": "default", "count": 1, "created": [{
        "user_id": "worker101", "display_name": "张二", "role_codes": ["worker"],
        "initial_password": "Abc12345xy"}]}
    text = YunpaiGraph._finalize_response(
        {"status": "completed", "response": "", "outputs": {"create_identity_user": created}, "trace": []})
    assert "worker101" in text and "张二" in text and "Abc12345xy" in text

    batch = {"tenant_id": "default", "count": 2, "created": [
        {"user_id": "worker001", "display_name": "赵一", "initial_password": "p1"},
        {"user_id": "worker002", "display_name": "李二", "initial_password": "p2"}]}
    text = YunpaiGraph._finalize_response(
        {"status": "completed", "response": "", "outputs": {"create_identity_user": batch}, "trace": []})
    assert "已创建 2 个账号" in text and "worker001（赵一）" in text

    failed = YunpaiGraph._finalize_response({
        "status": "failed", "response": "", "outputs": {}, "trace": [],
        "errors": [{"code": "TOOL_ERROR", "message": "create_identity_user: MISSING_USER_ID: 需要给出账号"}]})
    assert failed.startswith("执行失败：") and "姓名或账号" in failed

    # 失败时即使已有 reviewer 通用回复，也要换成可操作的人话
    failed_with_reviewer_text = YunpaiGraph._finalize_response({
        "status": "failed", "outputs": {}, "trace": [],
        "response": "计划内工具已执行并通过审查；所有正式副作用均受 Gate 和模块合同约束。",
        "errors": [{"code": "TOOL_ERROR", "message": "USER_EXISTS: 账号已存在"}]})
    assert failed_with_reviewer_text.startswith("执行失败：") and "换一个账号名" in failed_with_reviewer_text

    # 工具总结要覆盖 reviewer 的通用套话
    state = {"status": "completed", "trace": [],
             "response": "计划内工具已执行并通过审查；所有正式副作用均受 Gate 和模块合同约束。",
             "outputs": {"list_identity_users": {"users": [
                 {"user_id": "worker001", "display_name": "赵一"},
                 {"user_id": "worker002", "display_name": "李二"}]}}}
    text = YunpaiGraph._finalize_response(state)
    assert "本租户当前有 2 个账号" in text and "worker001（赵一）" in text
    assert state["response"] == text

    assigned = YunpaiGraph._finalize_response({
        "status": "completed", "response": "", "trace": [],
        "outputs": {"assign_identity_account": {"user_id": "worker001", "org_id": "team-asm",
                                                "role_codes": ["team-leader"]}}})
    assert "worker001" in assigned and "team-asm" in assigned and "组长" in assigned


@pytest.mark.asyncio
async def test_missing_args_asks_back_instead_of_failing(monkeypatch):
    """信息不全时由 AI 反问用户，而不是报错（AI 主导，不靠写死词表）。"""
    from yunpai_langgraph import slot_filling

    async def fake_fill(router, *, tool, input_schema, message, history=None, partial=None, **kwargs):
        return {"args": {}, "missing": ["user_id"], "question": "要给谁建账号？请告诉我姓名和账号。",
                "source": "llm"}

    monkeypatch.setattr(slot_filling, "fill_tool_args", fake_fill)

    class Router:
        async def classify(self, request, registry):
            return {"ok": True, "status": "ok",
                    "decision": {"intent": "建账号", "route": "free", "tools": ["create_identity_user"],
                                 "confidence": 0.9, "reason": "身份管理"},
                    "model": {"provider": "qwen", "status": "ok"}}

    plan = await PlannerAgent(Router()).aplan({"message": "帮我给几个人建个账号", "tools": []},
                                              build_default_registry())
    assert plan["route"] == "chat"
    assert "要给谁建账号" in plan["response"]
    assert plan["pending_intent"]["tool"] == "create_identity_user"
    assert plan["pending_intent"]["missing"] == ["user_id"]


@pytest.mark.asyncio
async def test_pending_intent_resumes_and_executes(monkeypatch):
    """用户补充信息后，上一轮意图继续执行（不再重复反问）。"""
    from yunpai_langgraph import slot_filling

    async def fake_fill(router, *, tool, input_schema, message, history=None, partial=None, **kwargs):
        assert history and "要给谁建账号" in history[0]["content"]
        return {"args": {"people": [{"display_name": "钱七"}, {"display_name": "周八"}]},
                "missing": [], "question": "", "source": "llm"}

    monkeypatch.setattr(slot_filling, "fill_tool_args", fake_fill)
    request = {"message": "钱七 周八", "tools": [],
               "pending_intent": {"tool": "create_identity_user", "args": {}, "missing": ["user_id"],
                                  "question": "要给谁建账号？请告诉我姓名和账号。"}}
    plan = await PlannerAgent(QwenRouter(QwenConfig(enabled=False))).aplan(request, build_default_registry())
    assert plan["route"] == "free"
    assert plan["pending_resolved"] is True
    assert plan["steps"][0]["tool"] == "create_identity_user"
    assert request["payloads"]["create_identity_user"]["people"][0]["display_name"] == "钱七"


@pytest.mark.asyncio
async def test_pending_intent_asks_again_when_still_incomplete(monkeypatch):
    from yunpai_langgraph import slot_filling

    async def fake_fill(router, *, tool, input_schema, message, history=None, partial=None, **kwargs):
        return {"args": {}, "missing": ["user_id"], "question": "还是没听清，请给出账号，例如 worker101。",
                "source": "llm"}

    monkeypatch.setattr(slot_filling, "fill_tool_args", fake_fill)
    plan = await PlannerAgent(QwenRouter(QwenConfig(enabled=False))).aplan(
        {"message": "随便吧", "tools": [],
         "pending_intent": {"tool": "create_identity_user", "args": {}, "missing": ["user_id"],
                            "question": "要给谁建账号？"}},
        build_default_registry())
    assert plan["route"] == "chat"
    assert "worker101" in plan["response"]
    assert plan["pending_intent"]["missing"] == ["user_id"]


def test_deterministic_router_picks_identity_tools():
    registry = build_default_registry()
    planner = PlannerAgent(QwenRouter(QwenConfig(enabled=False)))
    cases = {
        "给张伟建个账号": "create_identity_user",
        "帮我注册几个工人账号": "create_identity_user",
        "给张二申请一个工人账户worker101": "create_identity_user",
        "帮我给3个工人分配账号 他们分别是钱七 周八 吴九": "create_identity_user",
        "把 worker001 调到装配班组": "assign_identity_account",
        "把赵一 李二 调到装配班组": "assign_identity_account",
        "现在有哪些账号": "list_identity_users",
    }
    for message, expected in cases.items():
        plan = planner.plan({"message": message}, registry)
        assert plan["route"] == "free", (message, plan)
        assert plan["steps"][0]["tool"] == expected, (message, plan)


# --------------------------------------------------------------------------- #
# 参数噪声清洗（模型与词表共用）
# --------------------------------------------------------------------------- #

def test_step_progress_text_is_human():
    from yunpai_langgraph.graph import YunpaiGraph

    assert YunpaiGraph._step_progress_text({"module": "identity", "tool": "create_identity_user"}) == "正在建账号…"
    assert YunpaiGraph._step_progress_text({"module": "identity", "tool": "assign_identity_account"}) == "正在调整账号…"
    assert YunpaiGraph._step_progress_text({"module": "identity", "tool": "list_identity_users"}) == "正在查账号…"
    assert "M1" in YunpaiGraph._step_progress_text({"module": "m1", "tool": "ingest_document"})


def test_sanitize_identity_args_drops_non_name_values():
    from yunpai_langgraph.agents import sanitize_identity_args

    assert sanitize_identity_args("create_identity_user", {"display_name": "几个人"}) == {}
    assert sanitize_identity_args("create_identity_user", {"display_name": "多少工人"}) == {}
    assert sanitize_identity_args("create_identity_user",
                                  {"people": [{"display_name": "几个"}, {"display_name": "张一"}]}) == {
        "people": [{"display_name": "张一"}]}
    # 合法姓名（含「建」这类字）不能被误删
    assert sanitize_identity_args("create_identity_user", {"display_name": "王建国"}) == {"display_name": "王建国"}
    assert sanitize_identity_args("create_identity_user", {"user_id": "worker101"}) == {"user_id": "worker101"}
    assert sanitize_identity_args("assign_identity_account", {"user_id": "worker101", "org_name": "装配班组"}) == {
        "user_id": "worker101", "org_name": "装配班组"}


@pytest.mark.asyncio
async def test_model_garbage_display_name_triggers_ask_back(monkeypatch):
    """模型把「几个人」当姓名时，清洗后仍缺人 → 反问，不能建出垃圾账号。"""
    from yunpai_langgraph import slot_filling

    async def fake_fill(router, *, tool, input_schema, message, history=None, partial=None, **kwargs):
        return {"args": {}, "missing": ["display_name"], "question": "要给谁建账号？请告诉我姓名。",
                "source": "llm"}

    monkeypatch.setattr(slot_filling, "fill_tool_args", fake_fill)

    class Router:
        async def classify(self, request, registry):
            return {"ok": True, "status": "ok",
                    "decision": {"intent": "建账号", "route": "free", "tools": ["create_identity_user"],
                                 "args": {"create_identity_user": {"display_name": "几个人"}},
                                 "confidence": 0.9, "reason": "身份管理"},
                    "model": {"provider": "qwen", "status": "ok"}}

    request = {"message": "帮我建几个工人账号", "tools": []}
    plan = await PlannerAgent(Router()).aplan(request, build_default_registry())
    assert plan["route"] == "chat"
    assert "姓名" in plan["response"]
    assert "display_name" not in (request.get("payloads", {}).get("create_identity_user") or {})


# --------------------------------------------------------------------------- #
# 角色名归一化（模型直接给中文角色名也要落到角色 code）
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_chinese_role_label_is_normalized_on_create(identity_env):
    """「让他当组长」这类中文角色名要落到 team-leader，不能原样写进绑定。"""
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})

    created = await registry.call(
        "create_identity_user",
        {"display_name": "王组长", "role_codes": ["组长"]},
        boss,
    )
    assert created["role_codes"] == ["team-leader"], created
    assert identity_env.list_bindings(tenant_id="default", user_id=created["user_id"])[0]["role_codes"] == ["team-leader"]


@pytest.mark.asyncio
async def test_chinese_role_label_is_normalized_on_assign_and_list_reflects_org(identity_env):
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    created = await registry.call(
        "create_identity_user",
        {"user_id": "worker901", "display_name": "李四", "role_codes": ["worker"]},
        boss,
    )
    assert created["role_codes"] == ["worker"]

    assigned = await registry.call(
        "assign_identity_account",
        {"user_id": "worker901", "org_name": "装配班组", "role_codes": ["组长"]},
        boss,
    )
    assert assigned["role_codes"] == ["team-leader"], assigned
    assert assigned["org_id"] == "team-asm"

    listed = await registry.call("list_identity_users", {}, boss)
    row = next(item for item in listed["users"] if item["user_id"] == "worker901")
    # 调岗写的是 user_bindings.org_id，列表要能读到新组织（COALESCE 绑定优先）
    assert row["org_id"] == "team-asm", row


@pytest.mark.asyncio
async def test_assign_accepts_display_name_in_user_id(identity_env):
    """模型常把姓名填进 user_id（「把张伟分到1班组」）→ 按姓名唯一匹配回账号。"""
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    await registry.call("create_identity_user",
                        {"user_id": "worker905", "display_name": "张伟",
                         "role_codes": ["worker"], "org_id": "company"}, boss)

    assigned = await registry.call("assign_identity_account",
                                   {"user_id": "张伟", "org_name": "装配班组"}, boss)
    assert assigned["user_id"] == "worker905", assigned
    assert assigned["org_id"] == "team-asm"
    assert assigned["display_name"] == "张伟"


@pytest.mark.asyncio
async def test_assign_ambiguous_name_is_reported(identity_env):
    """两个同名员工 → 报 AMBIGUOUS_USER_NAME，不能瞎挑一个。"""
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    for uid in ("worker906", "worker907"):
        await registry.call("create_identity_user",
                            {"user_id": uid, "display_name": "李雷", "role_codes": ["worker"]}, boss)

    with pytest.raises(Exception) as exc:
        await registry.call("assign_identity_account",
                            {"user_id": "李雷", "org_name": "装配班组"}, boss)
    assert "AMBIGUOUS_USER_NAME" in str(exc.value)


@pytest.mark.asyncio
async def test_assign_roles_only_keeps_existing_org(identity_env):
    """「让他当组长」没提组织 → 保留原班组，不能把组织清空。"""
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    await registry.call("create_identity_user",
                        {"user_id": "worker903", "display_name": "周七",
                         "role_codes": ["worker"], "org_id": "team-asm"}, boss)

    assigned = await registry.call("assign_identity_account",
                                   {"user_id": "worker903", "role_codes": ["组长"]}, boss)
    assert assigned["role_codes"] == ["team-leader"]
    assert assigned["org_id"] == "team-asm", assigned

    listed = await registry.call("list_identity_users", {}, boss)
    row = next(item for item in listed["users"] if item["user_id"] == "worker903")
    assert row["org_id"] == "team-asm" and row["role_codes"] == ["team-leader"]


@pytest.mark.asyncio
async def test_assign_role_mode_add_keeps_existing_roles(identity_env):
    """「加上品保角色」→ 追加而不是替换。"""
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    await registry.call("create_identity_user",
                        {"user_id": "worker904", "display_name": "吴八",
                         "role_codes": ["组长"], "org_id": "team-asm"}, boss)

    assigned = await registry.call("assign_identity_account",
                                   {"user_id": "worker904", "role_codes": ["品保"],
                                    "role_mode": "add"}, boss)
    assert assigned["role_codes"] == ["team-leader", "quality-assurance"], assigned
    assert assigned["org_id"] == "team-asm"


@pytest.mark.asyncio
async def test_unknown_role_still_fails_with_friendly_hint(identity_env):
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    with pytest.raises(Exception) as exc:
        await registry.call("create_identity_user",
                            {"user_id": "worker902", "display_name": "赵五", "role_codes": ["宇宙管理员"]}, boss)
    assert "未注册角色" in str(exc.value)

    from yunpai_langgraph.graph import YunpaiGraph

    hint = YunpaiGraph._friendly_error("assign_identity_account: INVALID_BINDING: 未注册角色: 宇宙管理员")
    assert "角色" in hint and "组长" in hint


# --------------------------------------------------------------------------- #
# 按姓名匹配 / 同名 / 重复建号
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_assign_by_display_name_resolves_user(identity_env):
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    await registry.call("create_identity_user",
                        {"user_id": "workerA", "display_name": "钱七", "role_codes": ["worker"]}, boss)

    assigned = await registry.call(
        "assign_identity_account",
        {"display_name": "钱七", "org_name": "装配班组", "role_codes": ["组长"]}, boss)
    assert assigned["user_id"] == "workerA"
    assert assigned["role_codes"] == ["team-leader"]
    assert assigned["org_id"] == "team-asm"


@pytest.mark.asyncio
async def test_assign_by_name_ambiguous_asks_for_account(identity_env):
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    await registry.call("create_identity_user",
                        {"user_id": "workerA", "display_name": "张伟", "role_codes": ["worker"]}, boss)
    await registry.call("create_identity_user",
                        {"user_id": "workerB", "display_name": "张伟", "role_codes": ["worker"]}, boss)

    with pytest.raises(Exception) as exc:
        await registry.call("assign_identity_account", {"display_name": "张伟", "role_codes": ["组长"]}, boss)
    err = str(exc.value)
    assert "AMBIGUOUS_USER_NAME" in err and "workerA" in err and "workerB" in err


@pytest.mark.asyncio
async def test_create_by_name_reports_existing_instead_of_duplicate(identity_env):
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})
    await registry.call("create_identity_user",
                        {"user_id": "workerA", "display_name": "李四", "role_codes": ["worker"]}, boss)

    with pytest.raises(Exception) as exc:
        await registry.call("create_identity_user", {"display_name": "李四", "role_codes": ["品保"]}, boss)
    assert "NAME_EXISTS" in str(exc.value) and "workerA" in str(exc.value)
    listed = await registry.call("list_identity_users", {}, boss)
    same = [u for u in listed["users"] if u["display_name"] == "李四"]
    assert len(same) == 1


def test_parse_decision_preserves_args():
    from yunpai_langgraph.llm import QwenRouter

    decision = QwenRouter._parse_decision('{"intent":"建组织","route":"free",'
                                          '"tools":["create_org_node"],"confidence":0.9,"reason":"x",'
                                          '"args":{"create_org_node":{"name":"1班组","org_type":"team"}}}')
    assert decision["args"] == {"create_org_node": {"name": "1班组", "org_type": "team"}}
    assert QwenRouter._parse_decision('{"route":"free","tools":["create_org_node"]}')["args"] == {}


# --------------------------------------------------------------------------- #
# 同一工具一句话排两次 → 提醒拆成两句（而不是执行出怪错）
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_duplicate_tool_in_one_sentence_asks_to_split():
    class Router:
        async def classify(self, request, registry):
            return {"ok": True, "status": "ok",
                    "decision": {"intent": "建两个组织", "route": "free",
                                 "tools": ["create_org_node", "create_org_node"],
                                 "args": {"create_org_node": {"name": "出货检验组", "parent_name": "品质部"}},
                                 "confidence": 0.9, "reason": "两次建组织"},
                    "model": {"provider": "qwen", "status": "ok"}}

    plan = await PlannerAgent(Router()).aplan(
        {"message": "新建品质部，然后在里面建个出货检验组", "tools": []}, build_default_registry())
    assert plan["route"] == "chat"
    assert plan["steps"] == []
    assert "一次只能" in plan["response"] or "分两步" in plan["response"]
    assert plan["route_decision"]["source"] == "duplicate_tool_guard"


def test_system_prompt_forbids_duplicate_tools():
    from yunpai_langgraph.llm import QwenRouter

    prompt = QwenRouter._system_prompt()
    assert "同一个工具在一句话里只能用一次" in prompt
    assert "分两步" in prompt


# --------------------------------------------------------------------------- #
# 角色英文/口语别名（模型把「品保」写成 qa/qc 也要落到 quality-assurance）
# --------------------------------------------------------------------------- #

def test_normalize_roles_accepts_english_and_slang_aliases(identity_env):
    """别名归一化：大小写不敏感，中文名/别名/code 都能落到角色 code。"""
    from yunpai_langgraph.workers import _normalize_roles

    cases = {
        # 品保：模型最容易写成 qa/qc
        "qa": "quality-assurance", "QA": "quality-assurance", "qc": "quality-assurance",
        "quality": "quality-assurance", "quality assurance": "quality-assurance",
        "Quality Assurance": "quality-assurance", "qa/qc": "quality-assurance",
        "品保": "quality-assurance", "质检": "quality-assurance",
        "品控": "quality-assurance", "品保监督": "quality-assurance",
        # 组长 / 工人 / 计划 / 工程
        "leader": "team-leader", "team lead": "team-leader", "foreman": "team-leader",
        "组长": "team-leader", "班长": "team-leader",
        "worker": "worker", "操作工": "worker", "工人": "worker",
        "员工": "worker", "装配工": "worker",
        "planner": "planner", "计划员": "planner", "计划": "planner",
        "engineer": "engineer", "工程师": "engineer",
        # 主数据 / 发布 / 管理员 / 厂长
        "steward": "data-steward", "data steward": "data-steward",
        "主数据": "data-steward", "资料员": "data-steward",
        "release": "release-manager", "release manager": "release-manager",
        "发布负责人": "release-manager",
        "admin": "org-admin", "org admin": "org-admin",
        "组织管理员": "org-admin", "管理员": "org-admin",
        "director": "factory-director", "factory director": "factory-director",
        "厂长": "factory-director",
        # 合法 code 原样保留（大小写不敏感）
        "quality-assurance": "quality-assurance", "TEAM-LEADER": "team-leader",
    }
    for token, expected in cases.items():
        assert _normalize_roles(identity_env, "default", [token]) == [expected], token
    # 乱写的角色原样返回，交给下游报「未注册角色」
    assert _normalize_roles(identity_env, "default", ["宇宙管理员"]) == ["宇宙管理员"]
    # 批量保序、空值丢弃
    assert _normalize_roles(identity_env, "default", ["qa", "", "  ", "leader"]) == [
        "quality-assurance", "team-leader"]


@pytest.mark.asyncio
async def test_english_role_alias_lands_on_code_end_to_end(identity_env):
    """端到端：模型给 role_codes:["qa"] → 建号/调岗都落到 quality-assurance。"""
    registry = build_default_registry()
    boss = _context(["identity.admin"], {"identity.admin": "tenant"})

    created = await registry.call(
        "create_identity_user", {"display_name": "李四", "role_codes": ["qa"]}, boss)
    assert created["role_codes"] == ["quality-assurance"], created
    binding = identity_env.list_bindings(tenant_id="default", user_id=created["user_id"])[0]
    assert binding["role_codes"] == ["quality-assurance"]

    assigned = await registry.call(
        "assign_identity_account",
        {"user_id": created["user_id"], "role_codes": ["qa"], "role_mode": "set"}, boss)
    assert assigned["role_codes"] == ["quality-assurance"], assigned

    # 追加语义同样归一化
    added = await registry.call(
        "assign_identity_account",
        {"user_id": created["user_id"], "role_codes": ["leader"], "role_mode": "add"}, boss)
    assert added["role_codes"] == ["quality-assurance", "team-leader"], added

    listed = await registry.call("list_identity_users", {"role": "quality-assurance"}, boss)
    assert [item["user_id"] for item in listed["users"]] == [created["user_id"]]


def test_invalid_user_and_user_not_found_hints_are_actionable():
    """INVALID_USER 给「角色没认出来」人话；USER_NOT_FOUND 提示可以顺手建号。"""
    from yunpai_langgraph.graph import YunpaiGraph

    hint = YunpaiGraph._friendly_error(
        "create_identity_user: INVALID_USER: 未注册角色: qa（租户 default）")
    assert "角色没认出来" in hint and "品保" in hint and "qa" in hint
    # 前缀不串台：INVALID_USER_ID 仍走账号格式提示
    assert "账号格式" in YunpaiGraph._friendly_error(
        "create_identity_user: INVALID_USER_ID: 账号只允许字母/数字/_ . @ -")
    # 账号不存在 → 提示可以给新员工建号
    not_found = YunpaiGraph._friendly_error(
        "assign_identity_account: USER_NOT_FOUND: 账号不存在: worker999")
    assert "建一个工人账号" in not_found
    assert "现在有哪些账号" in not_found
