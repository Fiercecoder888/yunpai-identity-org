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
