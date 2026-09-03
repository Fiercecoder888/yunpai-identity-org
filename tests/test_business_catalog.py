from __future__ import annotations

import json

from openpyxl import Workbook

from yunpai_langgraph.business_catalog import catalog_summary, ingest_tree


def _order_book(path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet["P6"] = "PO-TEST-001"
    sheet["X6"] = "2026-09-01"
    sheet["X7"] = "2026-09-10"
    sheet["G6"] = "供应商"
    sheet["P7"] = "月结"
    sheet["D8"] = "东莞"
    sheet["E10"] = 1
    sheet["I10"] = "W-H909"
    sheet["J10"] = "HDMI"
    sheet["N10"] = "4K"
    sheet["Q10"] = "1M"
    sheet["R10"] = 4
    sheet["S10"] = "PCS"
    sheet["V10"] = 10
    sheet["W10"] = 40
    workbook.save(path)


def test_ingest_tree_extracts_order_and_is_repeatable(tmp_path):
    root = tmp_path / "业务数据"
    root.mkdir()
    _order_book(root / "桐曦备货订单.xlsx")
    (root / "notes.json").write_text(json.dumps({"records": [{"kind": "bom"}]}), encoding="utf-8")
    db = tmp_path / "catalog.sqlite"

    first = ingest_tree(root, db, parse_xlsx=True)
    second = ingest_tree(root, db, parse_xlsx=True)

    assert first["file_count"] == 2
    assert first["error_count"] == 0
    assert second["error_count"] == 0
    summary = catalog_summary(db)
    assert summary["source_files"] == 2
    assert summary["documents"] == 2
    assert summary["field_observations"] > 0


def test_ingest_tree_extracts_all_bom_sheets_and_rows(tmp_path):
    root = tmp_path / "BOM专项"
    root.mkdir()
    workbook = Workbook()
    first = workbook.active
    first.title = "产品A"
    first.append(["项目", "物料编码", "材料名称", "用量", "单位", "单价", "成本"])
    first.append([1, "YA.A.01.001", "插头料", 2, "PCS", 1.2, 2.4])
    second = workbook.create_sheet("产品B")
    second.append(["物料编码", "材料名称", "规格", "数量", "单位"])
    second.append(["XC005", "光纤", "30#", 1, "M"])
    workbook.save(root / "成品BOM多Sheet.xlsx")

    db = tmp_path / "catalog.sqlite"
    result = ingest_tree(root, db, parse_xlsx=True)

    assert result["error_count"] == 0
    summary = catalog_summary(db)
    assert summary["field_observations"] >= 9
    import sqlite3
    with sqlite3.connect(db) as connection:
        payload = connection.execute("SELECT payload_json FROM document_candidates").fetchone()[0]
        metadata = connection.execute("SELECT metadata_json FROM source_files").fetchone()[0]
    assert '"sheet_count": 2' in payload
    assert '"bom_line_count": 2' in payload
    assert '"产品A"' in metadata and '"产品B"' in metadata


def test_ingest_tree_keeps_binary_business_file_types(tmp_path):
    root = tmp_path / "BOM规则"
    root.mkdir()
    (root / "verify_release.py").write_text("print('ok')", encoding="utf-8")
    result = ingest_tree(root, tmp_path / "catalog.sqlite")
    assert result["file_count"] == 1
    assert result["error_count"] == 0
    assert result["counts_by_kind"] == {"bom": 1}
