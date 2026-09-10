import json

import pytest

from yunpai_langgraph.agents import PlannerAgent
from yunpai_langgraph.llm import QwenConfig, QwenRouter
from yunpai_langgraph.registry import build_default_registry


@pytest.mark.asyncio
async def test_qwen_router_parses_structured_route(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({
                "intent": "解析订单并排程", "route": "workflow", "tools": [],
                "confidence": 0.93, "reason": "跨越订单、物料和排程",
            }, ensure_ascii=False)}}]}

    class Client:
        def __init__(self, **kwargs):
            captured["options"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            captured.update(url=url, body=kwargs["json"])
            return Response()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    router = QwenRouter(QwenConfig(api_key="test-key"))
    result = await router.classify({"message": "请解析订单并排程"}, build_default_registry())
    assert result["ok"] is True
    assert result["decision"]["route"] == "workflow"
    assert captured["body"]["chat_template_kwargs"]["enable_thinking"] is False
    assert captured["options"]["trust_env"] is False


@pytest.mark.asyncio
async def test_qwen_router_preserves_chat_answer(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None
        def json(self):
            return {"choices": [{"message": {"content": json.dumps({
                "intent": "能力咨询", "route": "chat", "tools": [], "confidence": 0.9,
                "reason": "用户在询问能力", "answer": "可以处理订单和排程。",
            }, ensure_ascii=False)}}]}
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def post(self, url, **kwargs): return Response()
    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    result = await QwenRouter(QwenConfig(api_key="test-key")).classify({"message": "你能做什么"}, build_default_registry())
    assert result["decision"]["answer"] == "可以处理订单和排程。"


@pytest.mark.asyncio
async def test_planner_records_qwen_intent_and_validated_route(monkeypatch):
    class FakeRouter:
        async def classify(self, request, registry):
            return {
                "ok": True,
                "status": "ok",
                "decision": {"intent": "订单解析", "route": "free", "tools": ["ingest_document"], "confidence": 0.88, "reason": "需要解析文件"},
                "model": {"provider": "qwen", "model": "test-qwen", "status": "ok"},
            }

    planner = PlannerAgent(FakeRouter())
    decision = await planner.aplan({"message": "请解析订单"}, build_default_registry())
    assert decision["route"] == "free"
    assert decision["steps"][0]["tool"] == "ingest_document"
    assert decision["intent"] == {"name": "订单解析", "confidence": 0.88, "source": "qwen"}
    assert decision["route_decision"]["source"] == "qwen"


@pytest.mark.asyncio
async def test_qwen_disabled_is_explicit_fallback():
    router = QwenRouter(QwenConfig(enabled=False, api_key="test-key"))
    result = await router.classify({"message": "hello"}, build_default_registry())
    assert result["status"] == "disabled"


@pytest.mark.asyncio
async def test_planner_falls_back_from_preview_chain_for_unparsed_order_attachment():
    class FakeRouter:
        async def classify(self, request, registry):
            return {
                "ok": True,
                "status": "ok",
                "decision": {
                    "intent": "解析订单数据", "route": "free",
                    "tools": ["data_import_preview", "data_import_resolve", "data_import_run"],
                    "confidence": 0.9, "reason": "preview first",
                },
                "model": {"provider": "qwen", "status": "ok"},
            }

    planner = PlannerAgent(FakeRouter())
    decision = await planner.aplan({
        "message": "请解析并校验这份订单",
        "attachments": [{"kind": "order", "filename": "order.xlsx", "content_b64": "AA=="}],
    }, build_default_registry())
    assert decision["route"] == "free"
    assert [step["tool"] for step in decision["steps"]] == ["ingest_document"]
    assert decision["route_decision"]["source"] == "deterministic_fallback"


# --------------------------------------------------------------- 提示词回归（纯离线）

def test_system_prompt_documents_create_org_node_and_compound_request():
    prompt = QwenRouter._system_prompt()
    # 建组织工具必须写进提示词，否则模型只会去建账号
    assert "create_org_node" in prompt
    assert '"name":"1班组","org_type":"team"' in prompt
    assert '"name":"生产部","org_type":"dept"' in prompt
    assert '"name":"2班组","org_type":"team","parent_name":"装配班组"' in prompt
    # 复合请求：按执行顺序一次给全三个工具
    assert 'tools=["create_org_node","create_identity_user","assign_identity_account"]' in prompt
    assert '"assign_identity_account":{"user_id":"张伟","org_name":"1班组"}' in prompt
    assert '"display_name":"王五","role_codes":["team-leader"],"org_name":"1班组"' in prompt
    # 不许瞎编账号 id，没给的参数留空
    assert "不要瞎编账号 id" in prompt
    assert "留空" in prompt


def test_system_prompt_marks_questions_as_chat_and_maps_role_codes():
    prompt = QwenRouter._system_prompt()
    # 疑问句不是命令：询问能力/可能性/怎么做 → chat 直接回答，不选工具
    assert "疑问句不是命令" in prompt
    assert "route=chat" in prompt
    assert "能创建品保的账号吗？" in prompt
    assert "可以建班组吗？" in prompt
    assert "绝对不要选工具执行" in prompt
    # 中文角色名要翻成 code
    for code in ("worker", "team-leader", "quality-assurance", "planner",
                 "engineer", "data-steward", "release-manager", "org-admin", "factory-director"):
        assert code in prompt
    assert "「品保」→quality-assurance" in prompt
    # 原有的「信息不全也要选工具 + 留空，系统追问」规则不能丢
    assert "仍然要选出最可能的工具" in prompt
    assert "系统会据此向用户追问" in prompt


@pytest.mark.asyncio
async def test_qwen_router_sends_org_and_question_rules_to_model(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({
                "intent": "建班组", "route": "free", "tools": ["create_org_node"],
                "args": {"create_org_node": {"name": "1班组", "org_type": "team"}},
                "confidence": 0.9, "reason": "建班组",
            }, ensure_ascii=False)}}]}

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            captured.update(kwargs["json"])
            return Response()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    result = await QwenRouter(QwenConfig(api_key="test-key")).classify(
        {"message": "创建1班组"}, build_default_registry())
    assert result["ok"] is True
    system_prompt = captured["messages"][0]["content"]
    assert captured["messages"][0]["role"] == "system"
    assert "create_org_node" in system_prompt
    assert "疑问句不是命令" in system_prompt
    assert "礼貌请求" in system_prompt
    assert "quality-assurance" in system_prompt
    assert captured["messages"][1]["content"].find("创建1班组") >= 0


# ---------------------------------------- 疑问句过度触发修复：礼貌请求 vs 纯能力提问


def test_system_prompt_separates_pure_question_from_polite_request():
    prompt = QwenRouter._system_prompt()
    # 新规则：礼貌请求（有具体对象 + 明确动作）按执行处理，不能因为「能不能」就回 chat
    assert "礼貌请求" in prompt
    assert "能不能帮我把刘福的品保角色加上" in prompt
    assert "能不能给员工建品保账号" in prompt
    assert "只影响语气，不影响是否执行" in prompt
    # 原有「疑问句不是命令」规则必须仍在（纯能力/可能性提问仍走 chat）
    assert "疑问句不是命令" in prompt
    assert "能创建品保的账号吗？" in prompt
    assert "可以建班组吗？" in prompt
    assert "绝对不要选工具执行" in prompt


def test_system_prompt_examples_land_on_the_right_route():
    prompt = QwenRouter._system_prompt()
    # 礼貌请求示例必须落在「route=free + 选工具 + 给 args」的语境里
    polite = prompt.index("能不能帮我把刘福的品保角色加上")
    polite_window = prompt[max(0, polite - 260):polite + 380]
    assert "route=free" in polite_window
    assert "assign_identity_account" in polite_window
    assert '"role_codes":["quality-assurance"]' in polite_window
    assert '"role_mode":"add"' in polite_window
    # 没点具体对象的纯提问必须落在「route=chat + tools=[]」的语境里
    pure = prompt.index("能不能给员工建品保账号")
    pure_window = prompt[max(0, pure - 220):pure + 260]
    assert "route=chat" in pure_window
    assert "tools=[]" in pure_window
    # 原有规则与角色码映射不能丢
    assert "仍然要选出最可能的工具" in prompt
    assert "系统会据此向用户追问" in prompt
    assert "「品保」→quality-assurance" in prompt
    for code in ("worker", "team-leader", "quality-assurance", "planner",
                 "engineer", "data-steward", "release-manager", "org-admin", "factory-director"):
        assert code in prompt


# ------------------------------------------------------ 身份自述（caller）回归（纯离线）


def test_system_prompt_answers_self_identity_from_caller():
    prompt = QwenRouter._system_prompt()
    # caller（当前登录人）必须被提示词承认，并且「我是谁」类问题直接用 caller 回答
    assert "caller" in prompt
    assert "当前登录人" in prompt
    assert "我是谁" in prompt
    assert "我的角色" in prompt
    # 不许反过来要用户报账号，也不许调工具去查自己
    assert "不要让用户提供账号" in prompt
    assert "不要调用工具查自己" in prompt
    # 自述类问题一律走对话、不带工具
    assert "route=chat" in prompt


def test_prompt_includes_caller_profile():
    request = {
        "message": "我是谁",
        "caller": {
            "user_id": "boss",
            "display_name": "赵厂长",
            "roles": ["factory-director"],
            "role_names": ["厂长"],
            "org_path": ["桐庐云湃电子有限公司"],
            "permissions": ["identity.admin"],
        },
    }
    prompt = QwenRouter._prompt(request, [{"name": "create_org_node", "description": "x"}], None)
    assert "赵厂长" in prompt
    assert "厂长" in prompt
    assert "boss" in prompt
    assert "identity.admin" in prompt
    payload = json.loads(prompt)
    assert payload["caller"]["user_id"] == "boss"
    assert payload["caller"]["display_name"] == "赵厂长"
    assert payload["caller"]["role_names"] == ["厂长"]
    assert payload["caller"]["org_path"] == ["桐庐云湃电子有限公司"]
    assert payload["caller"]["permissions"] == ["identity.admin"]
    # 无身份时必须显式传 null（不省略字段、不塞空串）
    anonymous = json.loads(
        QwenRouter._prompt({"message": "我是谁"}, [{"name": "create_org_node", "description": "x"}], None))
    assert anonymous["caller"] is None
