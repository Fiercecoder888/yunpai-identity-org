"""slot_filling.fill_tool_args + QwenRouter.complete_json 的回归测试（不联网）。

覆盖：模型给全参数 / 只给部分 / 返回 None / 抛异常 / 额外键 / partial 兜底，
以及 complete_json 的 JSON 解析与「永不抛异常」契约。
"""

from __future__ import annotations

import json

import pytest

from yunpai_langgraph.llm import QwenConfig, QwenRouter
from yunpai_langgraph.slot_filling import fill_tool_args

TOOL = "create_identity_user"
IDENTITY_SCHEMA = {
    "type": "object",
    "properties": {
        "user_id": {"type": "string"},
        "display_name": {"type": "string"},
        "role_codes": {"type": "array", "items": {"type": "string"}},
        "org_name": {"type": "string"},
    },
    "required": ["display_name", "user_id", "role_codes"],
}


class FakeRouter:
    """记录调用并按需返回结果 / 抛异常的最小 router 替身。"""

    def __init__(self, result=None, error: Exception | None = None):
        self.result = result
        self.error = error
        self.calls: list[dict] = []

    async def complete_json(self, system, user, *, schema_hint=None):
        self.calls.append({"system": system, "user": user, "schema_hint": schema_hint})
        if self.error is not None:
            raise self.error
        return self.result


# --------------------------------------------------------------------------- #
# fill_tool_args
# --------------------------------------------------------------------------- #

@pytest.mark.asyncio
async def test_fill_tool_args_complete_returns_no_missing():
    router = FakeRouter({"args": {"display_name": "张二", "user_id": "worker101", "role_codes": ["worker"]},
                         "missing": [], "question": ""})
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA,
                                  message="给张二申请一个工人账号 worker101")
    assert result["source"] == "llm"
    assert result["missing"] == []
    assert result["question"] == ""
    assert result["args"] == {"display_name": "张二", "user_id": "worker101", "role_codes": ["worker"]}


@pytest.mark.asyncio
async def test_fill_tool_args_partial_model_args_recomputes_missing():
    router = FakeRouter({"args": {"display_name": "张二"}, "missing": [], "question": "请补充账号和角色"})
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA, message="给张二建个账号")
    assert result["source"] == "llm"
    # 模型自报 missing=[] 不可信，由代码重算
    assert result["missing"] == ["user_id", "role_codes"]
    assert result["question"].strip()
    assert result["args"] == {"display_name": "张二"}


@pytest.mark.asyncio
async def test_fill_tool_args_missing_question_generated_when_model_silent():
    router = FakeRouter({"args": {"display_name": "张二"}, "missing": [], "question": ""})
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA, message="给张二建个账号")
    assert result["missing"] == ["user_id", "role_codes"]
    assert result["question"].startswith("我需要更多信息才能继续：请补充 ")
    assert "账号" in result["question"]


#: create_identity_user 的真实 schema：没有 required，只有 anyOf 三选一
ANYOF_SCHEMA = {
    "type": "object",
    "anyOf": [{"required": ["user_id"]}, {"required": ["display_name"]}, {"required": ["people"]}],
    "properties": {
        "user_id": {"type": "string"},
        "display_name": {"type": "string"},
        "people": {"type": "array"},
        "role_codes": {"type": "array"},
    },
}


@pytest.mark.asyncio
async def test_required_hint_guides_anyof_schema_and_drives_missing():
    """anyOf schema 没有 required 时，用调用方给的 required_hint 告诉模型缺什么。

    注意：hint 只是「当前还缺什么」的提示，模型抽到的参数照常保留；真正的 anyOf
    判定由调用方（agents._tool_payload_missing）在合并后再算一次。
    """
    router = FakeRouter({"args": {"display_name": "张二"}, "missing": [], "question": "还要账号吗？"})
    result = await fill_tool_args(router, tool=TOOL, input_schema=ANYOF_SCHEMA,
                                  message="给张二建个账号", required_hint=["user_id"])
    assert result["args"] == {"display_name": "张二"}
    assert '"required": ["user_id"]' in router.calls[0]["user"]
    assert result["missing"] == ["user_id"]


@pytest.mark.asyncio
async def test_required_hint_keeps_asking_when_model_extracts_nothing():
    router = FakeRouter({"args": {}, "missing": ["user_id"], "question": "要给谁建账号？"})
    result = await fill_tool_args(router, tool=TOOL, input_schema=ANYOF_SCHEMA,
                                  message="帮我建几个工人账号", required_hint=["user_id"])
    assert result["missing"] == ["user_id"]
    assert result["question"] == "要给谁建账号？"


ANYTHING_SCHEMA = {"type": "object", "properties": {"user_id": {"type": "string"}}}


@pytest.mark.asyncio
async def test_off_topic_flag_is_propagated():
    """用户换了话题时模型可以举手，调用方据此放弃上一轮追问。"""
    router = FakeRouter({"args": {}, "missing": [], "question": "", "off_topic": True})
    result = await fill_tool_args(router, tool=TOOL, input_schema=ANYTHING_SCHEMA,
                                  message="现在有哪些账号", required_hint=["user_id"])
    assert result["off_topic"] is True


@pytest.mark.asyncio
async def test_off_topic_defaults_false():
    router = FakeRouter({"args": {"user_id": "worker101"}, "missing": [], "question": ""})
    result = await fill_tool_args(router, tool=TOOL, input_schema=ANYOF_SCHEMA,
                                  message="给张二申请一个工人账号 worker101", required_hint=["user_id"])
    assert result["off_topic"] is False


def test_field_labels_are_chinese():
    from yunpai_langgraph.slot_filling import field_labels

    labels = field_labels(["user_id", "display_name", "unknown_field"])
    assert "账号" in labels and "姓名" in labels and "unknown_field" in labels
    assert field_labels([]) == ""


@pytest.mark.asyncio
async def test_fill_tool_args_none_result_is_unavailable_and_keeps_partial():
    router = FakeRouter(None)
    partial = {"display_name": "张二"}
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA,
                                  message="给张二建个账号", partial=partial)
    assert result["source"] == "unavailable"
    assert result["args"] == {"display_name": "张二"}
    assert result["missing"] == ["user_id", "role_codes"]
    assert result["question"].strip()
    # 不污染调用方传入的 dict
    assert partial == {"display_name": "张二"}


@pytest.mark.asyncio
async def test_fill_tool_args_router_exception_is_swallowed():
    router = FakeRouter(error=RuntimeError("connection reset"))
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA,
                                  message="给张二建个账号", partial={"user_id": "worker101"})
    assert result["source"] == "unavailable"
    assert result["args"] == {"user_id": "worker101"}
    assert result["missing"] == ["display_name", "role_codes"]
    assert result["question"].strip()


@pytest.mark.asyncio
async def test_fill_tool_args_router_without_complete_json_is_unavailable():
    class Bare:
        pass

    result = await fill_tool_args(Bare(), tool=TOOL, input_schema=IDENTITY_SCHEMA, message="建个账号")
    assert result["source"] == "unavailable"
    assert result["missing"] == ["display_name", "user_id", "role_codes"]


@pytest.mark.asyncio
async def test_fill_tool_args_keeps_extra_keys_without_affecting_missing():
    router = FakeRouter({"args": {"display_name": "张二", "user_id": "worker101", "role_codes": ["worker"],
                                  "org_name": "装配班组", "nickname": "二子", "confident": True},
                         "missing": ["nickname"], "question": "还要补充吗？"})
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA, message="给张二建号")
    assert result["source"] == "llm"
    assert result["missing"] == []
    assert result["question"] == ""
    assert result["args"]["org_name"] == "装配班组"
    assert result["args"]["nickname"] == "二子"          # required 之外的键保留
    assert result["args"]["confident"] is True


@pytest.mark.asyncio
async def test_fill_tool_args_model_value_wins_and_partial_is_fallback():
    router = FakeRouter({"args": {"display_name": "张二", "user_id": "worker202"},
                         "missing": [], "question": ""})
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA, message="给张二建号",
                                  partial={"display_name": "张二", "user_id": "worker101", "org_name": "装配班组"})
    assert result["args"]["user_id"] == "worker202"      # 模型值优先
    assert result["args"]["org_name"] == "装配班组"       # partial 兜底（模型没给）
    assert result["missing"] == ["role_codes"]


@pytest.mark.asyncio
async def test_fill_tool_args_blank_model_value_does_not_clobber_partial():
    router = FakeRouter({"args": {"user_id": "  ", "display_name": None, "role_codes": ["worker"]},
                         "missing": [], "question": ""})
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA, message="给张二建号",
                                  partial={"user_id": "worker101", "display_name": "张二"})
    assert result["args"]["user_id"] == "worker101"
    assert result["args"]["display_name"] == "张二"
    assert result["missing"] == []


@pytest.mark.asyncio
async def test_fill_tool_args_blank_required_value_counts_as_missing():
    router = FakeRouter({"args": {"display_name": "  ", "user_id": "worker101", "role_codes": []},
                         "missing": [], "question": ""})
    result = await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA, message="给谁建号？")
    assert result["missing"] == ["display_name"]        # 空白字符串不算已填
    assert result["args"]["role_codes"] == []           # 空数组按「已给出」处理
    assert result["question"].strip()


@pytest.mark.asyncio
async def test_fill_tool_args_prompt_carries_schema_required_and_history():
    router = FakeRouter({"args": {"display_name": "张二", "user_id": "worker101", "role_codes": ["worker"]},
                         "missing": [], "question": ""})
    history = [{"role": "user", "content": "我叫张二"}, {"role": "assistant", "content": "好的"}]
    await fill_tool_args(router, tool=TOOL, input_schema=IDENTITY_SCHEMA, message="帮我建个账号",
                         history=history, partial={"org_name": "装配班组"})
    call = router.calls[0]
    assert "参数抽取器" in call["system"]
    assert "绝不编造" in call["system"]
    assert "question" in call["system"]
    payload = json.loads(call["user"])
    assert payload == {
        "tool": TOOL,
        "required": ["display_name", "user_id", "role_codes"],
        "input_schema": IDENTITY_SCHEMA,
        "already_known": {"org_name": "装配班组"},
        "user_message": "帮我建个账号",
        "history": history,
    }
    assert call["schema_hint"]["required"] == ["args", "missing", "question"]


@pytest.mark.asyncio
async def test_fill_tool_args_empty_schema_never_asks():
    router = FakeRouter({"args": {}, "missing": [], "question": "随便"})
    result = await fill_tool_args(router, tool="list_identity_users", input_schema={}, message="现在有哪些账号")
    assert result["source"] == "llm"
    assert result["missing"] == []
    assert result["question"] == ""


# --------------------------------------------------------------------------- #
# QwenRouter.complete_json（monkeypatch httpx，参照 tests/test_llm.py）
# --------------------------------------------------------------------------- #

def _patch_httpx(monkeypatch, content=None, error: Exception | None = None, captured: dict | None = None):
    class Response:
        def raise_for_status(self):
            if error is not None:
                raise error
            return None

        def json(self):
            return {"choices": [{"message": {"content": content}}]}

    class Client:
        def __init__(self, **kwargs):
            if captured is not None:
                captured["options"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            if captured is not None:
                captured.update(url=url, body=kwargs["json"])
            return Response()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", Client)


@pytest.mark.asyncio
async def test_complete_json_parses_plain_json_object(monkeypatch):
    captured: dict = {}
    _patch_httpx(monkeypatch, content=json.dumps({"args": {"user_id": "worker101"}, "missing": [],
                                                  "question": ""}, ensure_ascii=False), captured=captured)
    result = await QwenRouter(QwenConfig(api_key="test-key")).complete_json("系统提示", "用户输入")
    assert result == {"args": {"user_id": "worker101"}, "missing": [], "question": ""}
    assert captured["url"].endswith("/chat/completions")
    assert captured["body"]["messages"][0]["content"] == "系统提示"
    assert captured["body"]["chat_template_kwargs"]["enable_thinking"] is False
    assert captured["options"]["trust_env"] is False


@pytest.mark.asyncio
async def test_complete_json_strips_json_code_fence(monkeypatch):
    content = "```json\n" + json.dumps({"args": {"display_name": "张二"}}, ensure_ascii=False) + "\n```"
    _patch_httpx(monkeypatch, content=content)
    result = await QwenRouter(QwenConfig(api_key="test-key")).complete_json("系统", "用户")
    assert result == {"args": {"display_name": "张二"}}


@pytest.mark.asyncio
async def test_complete_json_extracts_first_object_from_noisy_text(monkeypatch):
    _patch_httpx(monkeypatch, content='好的，结果如下：{"args": {"user_id": "worker101"}} 请确认。')
    result = await QwenRouter(QwenConfig(api_key="test-key")).complete_json("系统", "用户")
    assert result == {"args": {"user_id": "worker101"}}


@pytest.mark.asyncio
async def test_complete_json_non_json_text_returns_none(monkeypatch):
    _patch_httpx(monkeypatch, content="抱歉，我无法处理这个请求。")
    assert await QwenRouter(QwenConfig(api_key="test-key")).complete_json("系统", "用户") is None


@pytest.mark.asyncio
async def test_complete_json_unconfigured_key_returns_none_without_calling_http(monkeypatch):
    def boom(**kwargs):
        raise AssertionError("未配置 key 时不应发起 HTTP 请求")

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", boom)
    assert await QwenRouter(QwenConfig(api_key="")).complete_json("系统", "用户") is None
    assert await QwenRouter(QwenConfig(enabled=False, api_key="test-key")).complete_json("系统", "用户") is None


@pytest.mark.asyncio
async def test_complete_json_http_error_returns_none(monkeypatch):
    _patch_httpx(monkeypatch, content="{}", error=RuntimeError("connect timeout"))
    assert await QwenRouter(QwenConfig(api_key="test-key")).complete_json("系统", "用户") is None


@pytest.mark.asyncio
async def test_complete_json_passes_schema_hint_to_model(monkeypatch):
    captured: dict = {}
    _patch_httpx(monkeypatch, content='{"args": {}}', captured=captured)
    await QwenRouter(QwenConfig(api_key="test-key")).complete_json(
        "系统", "用户", schema_hint={"type": "object", "required": ["args"]})
    assert "输出结构提示" in captured["body"]["messages"][1]["content"]
    assert '"required"' in captured["body"]["messages"][1]["content"]
