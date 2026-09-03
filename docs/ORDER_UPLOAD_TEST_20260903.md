# 桐曦订单上传后端测试记录

## 输入

- 文件：`/Users/murkydoubloon45/Downloads/桐曦PO-20260812-00008-HD备货订单-0831-合理SOP最终验收.xlsx`
- 请求消息：`请解析并校验这份采购备货订单，确认订单和物料后安排生产排程`
- 租户：`tongxi-final`

## Qwen 调用

- Endpoint：`http://gb10:18085/v1`
- Model：`qwen3.6-35b-a3b-fp8-gpu0-200k`
- 状态：`ok`
- 延迟：约 `1920.8 ms`
- Token：仅通过进程环境变量传入，未写入仓库或日志。

模型返回的受控提案：

```json
{
  "intent": "Parse and validate a procurement order file, then proceed to production scheduling.",
  "route": "workflow",
  "confidence": 0.95
}
```

模型曾提出若干 M0/M3/M5 原子工具，但本地 Planner 以 `workflows/m0_m5.json` 为 workflow 权威，最终计划固定为：

`data_import_run → data_import_commit → ingest_document → run_bom_sop_workflow → run_m3_procurement_requirements → import_m4_purchase_suggestions_json → solve_scheduling`

## 运行结果

- `run_id`：`run-95808abac6e84f81944b5f7cbf58a7cb`
- 根 `task_id`：`task-de760e9cce624ec0b8ac82e357c07a2b`
- 初始状态：`waiting_human`
- 首个 Gate：`m0 / data_import_run / candidate`
- 批准首个 Gate 后完成：`data_import_run`、`data_import_commit`、`ingest_document`
- 当前 Gate：`m2 / run_bom_sop_workflow / data`
- 当前原因：缺少权威 BOM 输入，未猜测或补造 BOM

解析结果：

| 字段 | 值 |
|---|---|
| 订单号 | `PO-20260812-001` |
| 供应商 | 广西桐曦电子科技有限公司 |
| 明细行 | 8 |
| 首个型号 | `W-H909` |
| 总数量 | 47,000 PCS |
| 总金额 | 175,200.00 |
| 交货日期 | 2026-09-12 |

## 决策审计

`GET /runs/run-95808abac6e84f81944b5f7cbf58a7cb` 可读取完整状态。重点字段：

- `intent.source = qwen`
- `route_decision.source = qwen`
- `route_decision.model_proposal` 保存模型原始意图/route/tools/reason
- `model.status = ok`、`model.latency_ms` 保存模型状态，不保存密钥
- `trace` 包含 `agent.model`、`agent.intent`、`agent.route`、`react.thought`、`gate.decided`
- API 返回中的订单 `content_b64` 为 `[omitted]`；原文件仅保留在服务端状态供恢复

## 发现与修复

第一次继续运行时发现 XLSX 行映射缺少 M1 合同要求的 `line_id`，流程按失败关闭停止；已补齐稳定行 ID 及价格字段，第二次相同订单上传成功通过 M1 并在缺 BOM 的 M2 Gate 停止。相关回归测试包含在 `tests/test_order_workbook.py` 和 `tests/test_api.py`。
