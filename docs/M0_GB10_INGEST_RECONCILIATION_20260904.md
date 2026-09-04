# M0 -> GB10 39092 数据落库对账（2026-09-04）

## 结论

截至 2026-09-04，本次不能确认云湃工厂、工人、机器、财务等资料已经通过 M0 正确落入 GB10 39092 对应的 canonical 数据库。可以确认的是：39092 当前 release `20260903201200` 的候选目录 SQLite 已保存一批来源文件、SHA-256 和文档候选；这不是 M0 canonical 主数据，也不能支撑真实 PMC 的完整工位排程。

本次没有直接补写数据库或重复上传。原因是 39092 发布进程使用 `YUNPAI_TOOL_TRANSPORT=local`，对外只暴露 orchestrator API；39092 的 M0 HTTP 路径返回 404，主机端口 8010 未发布。绕过 M0 直接写候选 SQLite 或运行库会破坏来源、审核、版本和 Outbox 约束，且人员/工资资料包含敏感信息。

## 运行态证据

- `GET http://192.168.110.19:39092/api/health`：HTTP 200，`tools=114`、`bound_tools=7`。
- `GET /api/openapi.json` 仅有 `/health`、`/runs`、`/runs/upload`、`/runs/{run_id}`、`/skills`、`/tools` 等 orchestrator 路径。
- `GET /api/m0/import/batches`、`/api/m0/catalog/summary`、`/api/m0/catalog/entities`：均 HTTP 404。
- GB10 当前路径：`/home/wjc/yunpai-langgraph/current -> releases/20260903201200`。
- `yunpai-business-catalog.sqlite` `PRAGMA integrity_check`：`ok`；表仅有 `ingest_batches`、`source_files`、`document_candidates`、`field_observations`，没有产品、订单、物料、供应商、设备、人员、工位、财务或 ledger/outbox canonical 表。
- `source_files`：779 条来源记录、392 个唯一 SHA；所有记录 `status=identified`。
- `document_candidates`：779 条；BOM 24 条 `candidate`、12 条 `needs_review`，订单 12 条 `needs_review`，其余主要为 `unclassified`；`approved=0`。
- 最新业务资料批次：`batch-task-6c56e5c4dcdb4a3ab287b79d6d3c37a4`（16 个 SOP/文档/其他文件）和 `batch-task-08e35de353da444187036d6766052798`（4 个 BOM），均为候选识别批次，不是 canonical 发布批次。
- 运行库中虽然存在 `data_import_commit.status=committed`、`master_counts.published_batches=1` 的状态 JSON，但其兼容批次 ID（例如 `batch-c20844c065ae`）不在 `ingest_batches`，且候选 SQLite 没有相应实体表；该字段不足以证明 M0 生产库写入成功。

## 逐类核对

| 数据类 | 本机/微信目录存在 | GB10 候选源 SHA | 候选审核状态 | M0 canonical 落库证据 | 结论与动作 |
|---|---|---|---|---|---|
| 工厂/订单 | 是，订单和历史排产文件较多 | 订单类 206 个唯一 SHA | 主要 `unclassified`，12 条 `needs_review` | 无 canonical 订单表或可查询实体 | 未完成；需 M0 可达后按订单 schema 解析、审核、发布 |
| 产品/BOM/工艺 | 是，BOM、SOP、工程图和 IE 时间存在 | BOM 28、SOP 22、工程图 24 个唯一 SHA（工程资料另有候选记录） | BOM 24 `candidate`、12 `needs_review`；SOP/工程图未批准 | 无产品/BOM/route/operation 表 | 未完成；需补齐稳定编码、版本、生效期和来源证据 |
| 库存/物料 | 是，`库存.xls` 等 | `库存.xls` SHA `a630e168...`，候选库 2 条同 SHA 记录；库存类共 8 个唯一 SHA | `identified`，无 `approved` | 无 `m0_master_inventory` 或库存 canonical 表 | 仅候选已上传；不能视为正式库存 |
| 机器/设备/模具 | 是，楼层设备、测试设备、机器模具清单存在 | `广西桐曦一楼押出生产设备 一览表.xls` SHA `988211fb...`（10 条来源记录）；二楼 `b58e7d41...`（10 条）；测试设备 `acc72954...`（10 条）；白宝机器模具 `dde0f8cd...`（1 条） | 均 `unclassified_table/identified` | 无设备/模具 canonical 表，也无能力、维护、工位绑定实体 | 仅来源已上传；PMC 仍不可用 |
| 供应商/采购/收货 | 是，供应商、采购入库和采购压缩包存在 | 采购类 54 个唯一 SHA | `identified`，未批准 | 无 supplier/PO/receipt canonical 表 | 未完成；需拆分供应商、PO、承诺 ETA、收货和质检状态 |
| 工人/人员/技能 | 本机企业微信缓存存在 HR/工资类文件，但未发现可直接作为生产主数据的完整工人技能表 | `source_files` 中未发现人员、工资、薪酬、财务命名记录 | 无候选 | 无 worker/skill/station/shift 表 | 未上传；需生产人员主数据、技能/资格、生效期和工位绑定；原始身份证、银行卡、工资明细不得直接上传 |
| 财务/成本 | 本机存在成本分析和硬件成本核算工作簿 | 代表性文件 `2026.03.30-唯格品牌--成品成本分析-不含税.xlsx` SHA `43a4e084...`、`1.线材-成本分析列表.xlsx` SHA `a5d81908...` 在 `source_files` 中均为 0 | 无候选 | 无成本/财务 canonical 表 | 未上传；需先定义成本口径、期间、币种和脱敏字段 |
| 生产日历/WIP/MES | 本机审计未形成完整可放行 snapshot | 无对应 canonical 实体 | 无 | 无 calendar/WIP/event 表 | 未完成；这是 PMC 生成完整正确工位排程的硬阻塞 |

## 本次补传决定

1. 不补传到 39092：当前入口不是 M0 canonical 写入入口，补传只能再次制造候选记录，不能满足“正确落库”。
2. 不直接写 GB10 SQLite/PostgreSQL：没有经过 M0 的 schema、权限、审核、版本和 Outbox 证据，直接写入不可接受。
3. 不上传原始 HR/工资/银行/身份证数据：先由业务负责人确认最小字段、脱敏规则和授权范围。
4. 解除阻塞后，补传顺序建议为：物料/产品/BOM/route/operation -> 设备/模具及能力 -> 供应商/采购/库存 -> 生产人员/技能/班次/工位 -> 日历/WIP/MES 事件 -> 成本财务；每类都要留 `task_id`、`batch_id`、来源 SHA、审核决定、canonical entity/version、ledger 和 outbox 证据，并逐笔回读核对。

## 需要外部提供的前置条件

- 可从 39092 或同一受控网络访问的 M0 base URL（当前容器 `m0:8010` 未发布到 GB10 主机）。
- M0 PostgreSQL 数据库连接由部署方提供并确认 schema/migration 已完成；不得把候选 SQLite 当生产库。
- 每类资料的已批准 `m0.ingest.v1` 映射和审核人；人员/财务字段的脱敏与授权确认。
- 写入后可查询的 entity/version、ledger、projection outbox 和回滚记录。

本报告为只读核验结果；在上述条件满足前，不能声明“已全部上传并正确落库”，也不能声明 PMC 已具备完整真实工位排程数据。
