from io import BytesIO

from openpyxl import Workbook

from yunpai_langgraph.order_workbook import parse_order_workbook


def test_parse_stocking_order_workbook():
    workbook = Workbook()
    sheet = workbook.active
    sheet["P6"] = "PO-TEST-001"
    sheet["X6"] = "2026年8月12日"
    sheet["X7"] = "2026-09-01"
    sheet["G6"] = "供应商"
    sheet["E9"] = "序号"
    sheet["I9"] = "型号"
    sheet["J9"] = "名称"
    sheet["R9"] = "采购数量"
    sheet["V9"] = "单价"
    sheet["W9"] = "金额"
    sheet["E10"] = 1
    sheet["I10"] = "W-H909"
    sheet["J10"] = "高清线"
    sheet["R10"] = 4000
    sheet["V10"] = 3.4
    sheet["W10"] = 13600
    output = BytesIO()
    workbook.save(output)
    document = parse_order_workbook("order.xlsx", output.getvalue())
    assert document["order_id"] == "PO-TEST-001"
    assert document["product_code"] == "W-H909"
    assert document["quantity"] == 4000
    assert document["lines"][0]["amount"] == 13600
