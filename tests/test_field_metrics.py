"""关键字段 precision/recall 指标（任务书 §五.3，目标 >= 90%）。

方法：用已知 golden 事实（人工/构建时写入的字段值）作为 ground truth，
对比解析器/候选的字段证据，逐字段计算：
- precision = 正确抽取数 / 模型抽取数（抽取了但没有 ground truth 的算 FP）
- recall = 正确抽取数 / ground truth 数（应抽取但缺失的算 FN）
失败样例必须携带 missing_fields 或 review_issues。
"""

from __future__ import annotations

from tests import fixtures

from yunpai_langgraph.order_parser_v2 import parse_order_sheets


def _extract_truth_lines(lines: list[dict]) -> dict[tuple[int, str], object]:
    """把 golden 行折成 {(row, field): value}，仅数值/文本可比较字段。"""
    truth: dict[tuple[int, str], object] = {}
    for line in lines:
        row = line["_row"]
        for field, value in line.items():
            if field == "_row":
                continue
            truth[(row, field)] = value
    return truth


def _parse_to_observations(document: dict) -> dict[tuple[int, str], object]:
    """从解析结果 field_evidence 折成 {(row, semantic_type): value}。"""
    observations: dict[tuple[int, str], object] = {}
    for evidence in document.get("field_evidence", []):
        row = evidence.get("row")
        field = evidence.get("semantic_type")
        value = evidence.get("raw_value")
        if row is not None and field and value not in (None, ""):
            observations[(row, field)] = value
    return observations


def _precision_recall(truth: dict, observed: dict, *, fields: set[str] | None = None) -> dict:
    def _filter(items: dict) -> dict:
        if fields is None:
            return items
        return {key: value for key, value in items.items() if key[1] in fields}

    truth, observed = _filter(truth), _filter(observed)
    tp = len(set(truth) & set(observed))
    fp = len(set(observed) - set(truth))
    fn = len(set(truth) - set(observed))
    return {
        "true_positive": tp,
        "false_positive": fp,
        "false_negative": fn,
        "precision": round(tp / max(1, tp + fp), 4),
        "recall": round(tp / max(1, tp + fn), 4),
    }


def test_order_field_precision_and_recall_above_90():
    """order 表头驱动的关键字段 precision/recall >= 90%。"""
    golden_rows = [
        {"_row": 2, "order_id": "SO-1", "product_code": "W-H909", "quantity": "10", "due_date": "2026-09-20", "unit_price": "3.5"},
        {"_row": 3, "order_id": "SO-1", "product_code": "W-H910", "quantity": "20", "due_date": "2026-09-21", "unit_price": "2.0"},
    ]
    headers = ["订单号", "型号", "数量", "交期", "单价"]
    workbook_rows = [headers]
    for line in golden_rows:
        workbook_rows.append([line["order_id"], line["product_code"], line["quantity"], line["due_date"], line["unit_price"]])
    raw = fixtures.xlsx_bytes(headers, workbook_rows[1:])
    document = parse_order_sheets("order.xlsx", raw)

    truth = _extract_truth_lines(golden_rows)
    observed = _parse_to_observations(document)
    eval_fields = {"order_id", "product_code", "quantity", "due_date", "unit_price"}
    metrics = _precision_recall(truth, observed, fields=eval_fields)

    assert metrics["precision"] >= 0.9, f"order 字段 precision {metrics['precision']} < 0.9: {metrics}"
    assert metrics["recall"] >= 0.9, f"order 字段 recall {metrics['recall']} < 0.9: {metrics}"
    # 失败样例必须携带 missing_fields 或 review_issues（本组应无失败）。
    assert document["validation_issues"] == [] or document["missing_fields"] == []


def test_unknown_layout_keeps_90_percent_recall_with_shifted_columns():
    """列顺序变化/未知布局：关键字段仍应高 recall；缺字段进 review_issues。"""
    # 列顺序打乱且加了包装文本列：型号在末尾、数量带中文单位。
    headers = ["序号", "备注", "交期", "数量(个)", "型号"]
    rows = [["1", "中性彩盒", "2026年9月25日", "30", "W-123"]]
    raw = fixtures.xlsx_bytes(headers, rows)
    document = parse_order_sheets("layout-shifted.xlsx", raw)
    truth = {(2, "product_code"): "W-123", (2, "quantity"): "30", (2, "due_date"): "2026年9月25日"}
    observed = _parse_to_observations(document)
    eval_fields = {"product_code", "quantity", "due_date"}
    metrics = _precision_recall(truth, observed, fields=eval_fields)
    # 型号/数量/交期三个关键字段必须都命中。
    assert metrics["recall"] >= 0.9, f"未知布局 recall {metrics['recall']}: {metrics}"
    assert metrics["precision"] >= 0.9
