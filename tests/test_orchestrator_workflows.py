"""M1-M5 Orchestrator 任务定向测试：新 workflow、Planner 路由与绑定 Gate。

覆盖任务书：
- T1: m1_m5_document_to_plan / canonical_to_m5 两个版本化 workflow 注册与打包一致
- Planner 对显式 workflow / 原始文件 / canonical refs 选择正确工作流
- T0: workflow 必需工具未绑定时返回 CAPABILITY_UNAVAILABLE（不执行中途 500）
"""
from hashlib import sha256
from pathlib import Path

import pytest

from yunpai_langgraph.agents import PlannerAgent
from yunpai_langgraph.graph import YunpaiGraph
from yunpai_langgraph.models import new_state
from yunpai_langgraph.registry import ToolRegistry, build_default_registry
from yunpai_langgraph.workflow_registry import KNOWN_WORKFLOWS, load_workflow, required_capabilities

NEW_WORKFLOWS = ("m1_m5_document_to_plan", "canonical_to_m5")


def test_new_workflows_are_versioned_ordered_and_packaged():
    for workflow_id in NEW_WORKFLOWS:
        workflow = load_workflow(workflow_id)
        assert workflow["workflow_id"] == workflow_id
        assert workflow["version"].count(".") == 2
        depends: set[str] = set()
        for step in workflow["steps"]:
            for dep in step.get("depends_on", []):
                assert dep in depends, f"{workflow_id}: step {step['id']} 依赖未排序的 {dep}"
            depends.add(step["id"])
        packaged = Path(f"src/yunpai_langgraph/workflows/{workflow_id}.json").read_bytes()
        documented = Path(f"workflows/{workflow_id}.json").read_bytes()
        assert sha256(packaged).digest() == sha256(documented).digest()


def test_new_workflows_reference_only_registered_tools():
    registry = build_default_registry()
    for workflow_id in NEW_WORKFLOWS:
        workflow = load_workflow(workflow_id)
        for step in workflow["steps"]:
            assert step["tool"] in registry.specs, (
                f"{workflow_id}/{step['id']} 引用未注册工具 {step['tool']}"
            )


def test_known_workflows_include_legacy_and_new_entries():
    assert "m0_m5" in KNOWN_WORKFLOWS
    assert set(NEW_WORKFLOWS) <= set(KNOWN_WORKFLOWS)


@pytest.mark.asyncio
async def test_planner_selects_explicit_document_to_plan_workflow():
    registry = build_default_registry()
    planner = PlannerAgent(skills=None)
    decision = planner.plan({"message": "从订单文件生成排程", "workflow": "m1_m5_document_to_plan"}, registry)
    assert decision["route"] == "workflow"
    assert decision["workflow_id"] == "m1_m5_document_to_plan"
    assert [step["tool"] for step in decision["steps"]] == [
        "ingest_document", "data_import_run", "data_import_commit",
        "run_bom_sop_workflow", "run_m3_procurement_requirements",
        "import_m4_purchase_suggestions_json", "ingest_m5_planning_snapshot",
        "solve_scheduling", "get_m5_schedule",
    ]


def test_explicit_workflow_wins_over_master_data_attachment_skill():
    registry = build_default_registry()
    planner = PlannerAgent()
    decision = planner.plan(
        {
            "workflow": "m1_m5_document_to_plan",
            "message": "用订单、BOM、SOP资料跑完 M1 到 M5",
            "attachments": [
                {"kind": "order", "filename": "order.xlsx", "content_b64": "eA=="},
                {"kind": "master_data", "filename": "bom.xlsx", "content_b64": "eA=="},
                {"kind": "master_data", "filename": "sop.docx", "content_b64": "eA=="},
            ],
        },
        registry,
    )
    assert decision["route"] == "workflow"
    assert decision["workflow_id"] == "m1_m5_document_to_plan"
    assert decision["steps"][0]["tool"] == "ingest_document"


@pytest.mark.asyncio
async def test_planner_selects_explicit_canonical_to_m5_workflow():
    registry = build_default_registry()
    planner = PlannerAgent(skills=None)
    decision = planner.plan({"message": "按 canonical 恢复执行", "workflow": "canonical_to_m5"}, registry)
    assert decision["route"] == "workflow"
    assert decision["workflow_id"] == "canonical_to_m5"
    assert decision["steps"][0]["tool"] == "data_import_status"


def test_planner_rejects_unknown_workflow_id_via_explicit_field():
    registry = build_default_registry()
    planner = PlannerAgent(skills=None)
    decision = planner.plan({"message": "x", "workflow": "does-not-exist"}, registry)
    # 未知 workflow 不触发受控链：落到 free/chat 而非伪造的 workflow。
    assert decision["route"] in {"free", "chat"}


def test_workflow_capability_gap_lists_missing_module_tool():
    registry = build_default_registry()
    # 构造缺绑定的运行时 registry：把 workflow 第一步工具从 handlers 移除。
    registry.handlers.pop("ingest_document", None)
    graph = YunpaiGraph(registry)
    state = new_state({"workflow": "m1_m5_document_to_plan", "message": "从订单文件生成排程"})
    asyncio = pytest.importorskip("asyncio")
    result = asyncio.run(graph.run(state))
    assert result["status"] == "failed"
    error = result["errors"][0]
    assert error["code"] == "CAPABILITY_UNAVAILABLE"
    assert {"module": "m1", "tool": "ingest_document"} in error["missing"]


def test_required_capabilities_are_ordered_workflow_tools():
    caps = required_capabilities("m1_m5_document_to_plan")
    assert caps[0] == {"module": "m1", "tool": "ingest_document"}
    assert caps[-1] == {"module": "m5", "tool": "get_m5_schedule"}


def test_health_reports_per_module_spec_and_bound():
    """T0.4：/health 输出各模块 spec/bound；主链必需工具逐模块 bound，
    不只验证总数。"""
    from fastapi.testclient import TestClient
    from yunpai_langgraph.api import create_app
    from yunpai_langgraph.repository import InMemoryRunRepository

    client = TestClient(create_app(repository=InMemoryRunRepository()))
    modules = client.get("/health").json()["modules"]
    # 合并后真实绑定（m0 5, m1 17, m2 1, m3 16, m4 24, m5 18 = 81）
    assert modules["m0"]["spec"] == 27 and modules["m0"]["bound"] == 5
    assert modules["m1"]["spec"] == 17 and modules["m1"]["bound"] == 17
    assert modules["m5"]["spec"] == 20 and modules["m5"]["bound"] == 18
    # 主链每个 workflow 步骤工具逐模块已 bound
    from yunpai_langgraph.registry import build_default_registry
    registry = build_default_registry()
    for workflow_id in ("m0_m5", "m1_m5_document_to_plan", "canonical_to_m5"):
        for step in load_workflow(workflow_id)["steps"]:
            assert step["tool"] in registry.handlers, (
                f"{workflow_id}/{step['id']} 的 {step['tool']} 未绑定")
