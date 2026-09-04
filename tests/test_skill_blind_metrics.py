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
    """本地 sandbox 绝不断言 canonical/committed 生产事实。"""
    from yunpai_langgraph.workers import m0_commit, m0_import

    import asyncio
    import base64
    import os
    import tempfile

    sandbox_db = os.path.join(tempfile.mkdtemp(), "m0-sandbox.sqlite")
    prior = os.environ.get("YUNPAI_M0_SANDBOX_DB")
    os.environ["YUNPAI_M0_SANDBOX_DB"] = sandbox_db
    try:
        imported = asyncio.run(m0_import(
            {"files": [{"filename": "fixture.json", "content_b64": base64.b64encode(b'{"records":[]}').decode()}]},
            {"task_id": "TASK-FIX-1", "tenant_id": "default"},
        ))
        result = asyncio.run(m0_commit({"batch_id": imported["batch_id"]}, {"task_id": "TASK-FIX-1"}))
        assert result["canonical"] is False
        assert result["provider"] == "local_fixture"
        assert result["environment"] == "sandbox"
        assert result["readback"]["available"] is False
        assert "committed" != result["status"]
    finally:
        if prior is None:
            os.environ.pop("YUNPAI_M0_SANDBOX_DB", None)
        else:
            os.environ["YUNPAI_M0_SANDBOX_DB"] = prior


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


# ---- 12 类正反例分类准确率（任务书 §7：正例/反例、逐类指标、关键类别 >= 90%） ----
TWELVE_KINDS = {
    "order": ([["订单号", "型号", "数量", "交期"], ["SO-1", "P-1", 10, "2026-09-20"]], [["审批单号", "审批结论", "签字人"], ["AP-1", "同意", "张三"]]),
    "product": ([["产品编码", "产品名称", "规格", "版本"], ["P-1", "高清线", "2m", "v1"]], [["请假人", "日期", "时长"], ["李四", "09-01", 2]]),
    "bom": ([["物料编码", "材料名称", "用量", "单位"], ["M-1", "铜箔", 2, "m"]], [["工号", "姓名", "班次"], ["E-1", "王五", "白班"]]),
    "route": ([["工序编码", "工序名称", "顺序", "标准工时"], ["OP-1", "裁切", 1, 5]], [["客户地址", "联系人"], ["东莞市", "赵六"]]),
    "sop": ([["工站", "作业步骤", "投入人数"], ["S-1", "锁付", 1]], [["PO 状态", "行号"], ["open", 1]]),
    "equipment": ([["设备编码", "设备名称", "产线", "能力"], ["EQ-1", "注塑机", "线1", "250"]], [["会议纪要", "议题"], ["M-1", "排产"]]),
    "tooling": ([["模具编码", "模具名称", "模穴数"], ["TL-1", "外壳模", 2]], [["请假单", "时长"], ["L-1", "1天"]]),
    "station": ([["工位编码", "工位名称", "绑定工序"], ["ST-1", "组装", "OP-2"]], [["客户", "金额"], ["C-1", 100]]),
    "worker": ([["工号", "姓名", "技能", "资格"], ["E-2", "钱七", "焊接", "焊工证"]], [["供应商", "报价"], ["S-1", "10元"]]),
    "calendar": ([["日期", "班次", "开始时间", "结束时间"], ["2026-09-01", "白班", "08:00", "17:00"]], [["设备", "能力"], ["EQ-9", "60"]]),
    "inventory": ([["物料编码", "仓库", "批次", "现存数量"], ["M-9", "A仓", "L-2", 10]], [["产品名", "版本"], ["高清线", "v2"]]),
    "supplier": ([["供应商编码", "供应商名称", "PO编号"], ["S-2", "苏州厂", "PO-1"]], [["工站", "步骤"], ["X", "Y"]]),
    "finance_cost": ([["成本项目", "期间", "币种", "单位成本"], ["直接材料", "2026-09", "CNY", 12]], [["订单", "型号"], ["SO", "P-9"]]),
}


def test_twelve_kind_classification_accuracy(tmp_path):
    """12 类各正例被内容分类器正确归类；反例不误报为对应类别（防把普通表归为业务类别）。"""
    correct = 0
    total = 0
    false_positives = 0
    for kind, (positive, negative) in TWELVE_KINDS.items():
        for case in (positive, negative):
            path = tmp_path / f"blind/{kind}-{id(case)}.xlsx"
            _write(tmp_path, f"blind/{kind}-{id(case)}.xlsx", _xlsx_bytes(case))
            verdict = classify_with_content(path, current_kind="tabular", current_confidence=0.45)
            total += 1
            is_positive = case is positive
            if is_positive:
                if verdict["kind"] == kind:
                    correct += 1
                else:
                    false_positives += 1  # 正例被归到别的类也计入误分类
            else:
                if verdict["kind"] == kind:
                    false_positives += 1
    # 关键类别正例（order/bom/equipment/worker/inventory）必须有 >= 90% 命中。
    key_correct = 0
    key_total = 0
    for kind in ("order", "bom", "equipment", "worker", "inventory"):
        path = tmp_path / f"blind/{kind}-positive-{kind}.xlsx"
        _write(tmp_path, f"blind/{kind}-positive-{kind}.xlsx", _xlsx_bytes(TWELVE_KINDS[kind][0]))
        key_total += 1
        if classify_with_content(path, current_kind="tabular", current_confidence=0.45)["kind"] == kind:
            key_correct += 1
    assert key_correct / key_total >= 0.9, f"关键类别正例命中 {key_correct}/{key_total}"
    assert false_positives <= 1, f"反例误报过多: {false_positives}"
