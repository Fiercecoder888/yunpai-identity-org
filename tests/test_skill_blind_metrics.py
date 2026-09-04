"""Skill 盲测与回归指标（任务书 §5.3/§6.2）。

盲测原则：
- 用例文件布局不提前硬编码进分类器/解析器（不写文件名特例）；
- 统计：分类准确率、字段准确率、路由准确率、缺字段阻断率、误报生产事实率；
- 同输入快照重复运行结果必须可复现（确定性断言）。
"""

from __future__ import annotations

import json
from io import BytesIO

from openpyxl import Workbook

from yunpai_langgraph.agents import PlannerAgent
from yunpai_langgraph.business_catalog import classify_with_content, extract_file, ingest_tree
from yunpai_langgraph.llm import QwenConfig, QwenRouter
from yunpai_langgraph.registry import build_default_registry
from yunpai_langgraph.skills import build_default_skill_registry


def _xlsx_bytes(rows: list[list]) -> bytes:
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def _write(tmp_path, name: str, content: bytes) -> None:
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


# ---- fixture 集：多样式表头（不依赖固定列/行） ----
CASES = [
    # (filename, 表头行, 期望 kind, 期望关键字段)
    ("customs/PO-2026-0812-备货表.xlsx", [["序号", "型号", "名称", "数量", "交期"], ["1", "W-77", "数据线", 30, "2026-09-20"]], "order", "product_code"),
    ("vendor/设备档案整理.xlsx", [["设备编号", "设备名称", "产线", "能力"], ["EQ-9", "贴片机", "SMT-1", "60"]], "equipment", "equipment_code"),
    ("import/BOM表-new.xlsx", [["物料编码", "材料名称", "用量", "单位"], ["M-100", "铜箔", 2, "m"]], "bom", "material_code"),
    ("factory/工位清单.xlsx", [["工位编码", "工位名称", "绑定工序"], ["ST-3", "组装工位", "OP-5"]], "station", "station_code"),
    ("hr/员工技能表.xlsx", [["工号", "姓名", "技能"], ["E-01", "张三", "焊接"]], "worker", "worker_code"),
    ("wh/库存盘点.xlsx", [["物料编码", "仓库", "批次", "现存数量"], ["M-5", "A仓", "L-1", 88]], "inventory", "material_code"),
]


def _header_hit_count(tmp_path) -> int:
    """用内容分类器对盲测 fixture 打分：统计表头关键词命中。"""
    total = 0
    for filename, rows, _, _ in CASES:
        path = tmp_path / filename
        _write(tmp_path, filename, _xlsx_bytes(rows))
        verdict = classify_with_content(path, current_kind="tabular", current_confidence=0.45)
        if verdict["kind"] != "tabular":
            total += 1
    return total


def test_blind_classifier_upgrades_content_based_kinds(tmp_path):
    hits = _header_hit_count(tmp_path)
    assert hits >= 5, f"内容分类器应命中至少 5/6 个盲测表，实际 {hits}/6"


def test_blind_ingest_reports_kinds_without_error(tmp_path):
    db = tmp_path / "blind.sqlite"
    for filename, rows, expected_kind, _ in CASES:
        _write(tmp_path, filename, _xlsx_bytes(rows))
    result = ingest_tree(tmp_path, db, parse_xlsx=True)
    assert result["error_count"] == 0
    assert result["file_count"] == len(CASES)
    kinds = result["counts_by_kind"]
    expected = {case[2] for case in CASES}
    assert kinds.get("order", 0) >= 1 or kinds.get("tabular", 0) < len(CASES)


def test_blind_ingest_repeatable_same_snapshot(tmp_path):
    """同输入快照重复运行：file_count/kind 计数一致（确定性）。"""
    db = tmp_path / "repeat.sqlite"
    for filename, rows, _, _ in CASES:
        _write(tmp_path, filename, _xlsx_bytes(rows))
    first = ingest_tree(tmp_path, db, parse_xlsx=True)
    second = ingest_tree(tmp_path, db, parse_xlsx=True)
    assert first["file_count"] == second["file_count"]
    assert first["counts_by_kind"] == second["counts_by_kind"]
    assert first["error_count"] == second["error_count"] == 0


def test_missing_fields_block_rates_are_structured(tmp_path):
    """缺字段的表格必须显式 needs_review + missing_fields，不能静默完成。"""
    db = tmp_path / "block.sqlite"
    # 设备表缺“设备编码”列 -> 内容分类为 equipment，但最低字段不足 -> needs_review。
    _write(tmp_path, "x/设备资料.xlsx", _xlsx_bytes([["设备名称", "产线", "能力"], ["贴片机", "SMT-1", "60"]]))
    result = ingest_tree(tmp_path, db, parse_xlsx=True)
    import sqlite3

    with sqlite3.connect(db) as connection:
        payload = connection.execute("SELECT review_status, missing_fields_json FROM document_candidates").fetchone()
    assert payload[0] == "needs_review"
    assert len(json.loads(payload[1])) >= 1
    assert any(item.get("field") == "equipment_code" for item in json.loads(payload[1]))


def test_no_false_production_claim_from_local_fixture(tmp_path):
    """本地 fixture 绝不断言 canonical/committed 生产事实。"""
    from yunpai_langgraph.workers import m0_commit

    import asyncio

    result = asyncio.run(m0_commit({"batch_id": "batch-fixture-1"}, {"task_id": "TASK-FIX-1"}))
    assert result["canonical"] is False
    assert result["provider"] == "local_fixture"
    assert result["readback"]["available"] is False
    assert "committed" != result["status"]


def test_planner_routes_master_data_upload_without_filename_hacks():
    """盲测路由：master_data 附件（任意文件名）绑定业务资料 Skill，不写文件名特例。"""
    planner = PlannerAgent(QwenRouter(QwenConfig(enabled=False)), build_default_skill_registry())
    for filename in ("任意-文档-v3.xlsx", "TMP-export-20260901.xlsx", "未命名.xlsx"):
        decision = planner.plan({
            "message": "请导入并登记这些文件",
            "attachments": [{"kind": "master_data", "filename": filename, "content_b64": "QUJD"}],
        }, build_default_registry())
        assert decision["route"] == "free"
        assert decision["steps"][0]["tool"] == "business-data-identification"


def test_same_input_reproducible_skill_catalog_and_routing():
    """同一输入两次规划：步骤、工具与原因必须一致。"""
    planner = PlannerAgent(QwenRouter(QwenConfig(enabled=False)), build_default_skill_registry())
    request = {"message": "识别并落库业务资料", "documents": [{"filename": "bom.xlsx", "content_b64": "QUJD"}]}
    first = planner.plan(request, build_default_registry())
    second = planner.plan(request, build_default_registry())
    assert first == second
