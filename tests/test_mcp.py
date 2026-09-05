import base64
import json
import os
import subprocess
import sys

import pytest

from yunpai_langgraph.mcp import MCPServer


def test_mcp_lists_all_114_tools_with_annotations():
    tools = MCPServer().list_tools()["tools"]
    assert len(tools) == 115
    item = next(tool for tool in tools if tool["name"] == "solve_scheduling")
    assert item["annotations"]["module"] == "m5"
    assert "inputSchema" in item


@pytest.mark.asyncio
async def test_mcp_call_uses_original_contract():
    payload = {"files": [{"filename": "x.txt", "content_b64": base64.b64encode(b"hello").decode()}]}
    response = await MCPServer().call_tool("data_import_run", payload)
    assert response["isError"] is False
    assert response["structuredContent"]["status"] == "awaiting_review"


@pytest.mark.asyncio
async def test_mcp_unbound_tool_returns_protocol_error_result():
    response = await MCPServer().call_tool("list_m4_tracking", {})
    assert response["isError"] is True
    assert response["structuredContent"]["code"] == "TOOL_CALL_FAILED"


def test_mcp_stdio_initialize_round_trip():
    request = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}) + "\n"
    env = {**os.environ, "PYTHONPATH": "src"}
    result = subprocess.run([sys.executable, "-m", "yunpai_langgraph.mcp"], input=request, text=True, capture_output=True, env=env, check=True)
    response = json.loads(result.stdout)
    assert response["id"] == 1
    assert response["result"]["serverInfo"]["name"] == "yunpai-mcp"
