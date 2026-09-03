# 业务资料识别 Skill

## 能力

`business-data-identification` 是注册在总规划 Agent 下的高阶 Skill。它接收授权的业务资料目录或上传文件，识别订单、BOM、SOP、采购、库存、工程图和普通文档，保留来源哈希并写入可审核候选库。

Skill 不直接发布 M0 canonical 事实；识别完成后由 Reviewer 打开 candidate Gate，人工批准后才能进入后续 M0 发布流程。

## 输入

目录模式：

```json
{
  "business_data_root": "/Volumes/外置硬盘/云湃业务数据",
  "business_catalog_db": "runtime/yunpai-business-catalog.sqlite"
}
```

上传模式由 `/runs/upload` 生成 `documents`，Planner 在消息包含“业务资料/业务数据/识别并落库/文件落库”时选择该 Skill。

## 数据库

数据库文件：`runtime/yunpai-business-catalog.sqlite`。

| 表 | 作用 |
|---|---|
| `ingest_batches` | 批次、根目录、状态、文件数和汇总 |
| `source_files` | 路径、文件名、扩展名、MIME、大小、修改时间、SHA-256、分类和状态 |
| `document_candidates` | 文档类型、订单号、产品编码、置信度、候选载荷和审核状态 |
| `field_observations` | 字段路径、原值、归一化值、物理/语义类型、置信度和证据定位 |

## 当前导入结果

2026-09-03 从 `/Volumes/外置硬盘/云湃业务数据` 识别 439 个可支持文件，0 个异常：

- 订单 217
- 采购 70
- BOM 39
- 工程文档 39
- 工程图 24
- SOP 21
- 库存 7
- 普通表格 7
- 普通文档 6
- 其他 7
- 压缩包 2

大型/全量 Excel 标记为 `xlsx_deferred_to_m1_parser`，由 M1 专项解析；上传的小型 Excel 可做字段级抽取。真实桐曦订单上传已抽取订单号 `PO-20260812-001`、产品 `W-H909`、8 行明细和字段证据。

## 路由与审计

运行状态会记录：

- `intent.name/source/confidence`
- `route_decision.source` 和 `skill`
- Planner `agent.intent`、`agent.route`
- Worker `react.action`、`react.observation`
- Reviewer `react.review` 和 `gate.opened`

真实上传测试结果为 `route=free`、`tool=business-data-identification`、`status=waiting_human`。

## 接口发现

- `GET /skills`：返回已注册 Skill 目录。
- `POST /runs/upload`：上传文件并由 Planner 识别是否调用 Skill。
- `POST /runs`：可通过 `business_data_root` 调用目录模式。

## 限制

当前候选库是编排层本地 SQLite，不替代 M0 生产 PostgreSQL；候选审核和 M0 发布仍需真实模块服务、权限、迁移和 Outbox 环境。
