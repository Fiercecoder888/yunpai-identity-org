# M0 阶段一盲测指标与交付记录（DSH）

- 关联：docs/DEEPSEEK_HARNESS_IMPLEMENTATION_TASKBOOK_20260904.md §5.3/§6.2 + DSH 本机阶段一任务书 §五
- 分支：dsh/m0-local-20260904（worktree yunpai-gragh0903-20260904-162353-m0local）
- 日期：2026-09-04

## 逐类分类准确率（本地合同实测，fixture 见 tests/test_skill_blind_metrics.py TWELVE_KINDS）

| 类别 | 正例命中 | 反例（不误报） |
|---|---|---|
| order | ✓ | ✓ |
| product | ✓ | ✓ |
| bom | ✓ | ✓ |
| route（含 operation） | ✓ | ✓ |
| sop | ✓ | ✓ |
| equipment | ✓ | ✓ |
| tooling | ✓ | ✓ |
| station | ✓ | ✓ |
| worker | ✓ | ✓ |
| calendar | ✓ | ✓ |
| inventory | ✓ | ✓ |
| supplier | ✓ | ✓ |
| finance_cost | ✓ | ✓ |

实测：13/13 正例命中，0 反例误报（覆盖任务书 12 类；equipment/tooling 拆为两类、route 覆盖 operation 语义）。
关键类别（order/bom/equipment/worker/inventory）正例命中 100%（≥90% 目标满足）。
无文件名特例：所有用例以任意文件名+表头内容驱动分类。

## 未知布局盲测（任务书 §五.2）

每类一份"列序打乱 + 混入无关列"的未知布局样本（UNKNOWN_LAYOUT_KINDS），
13/13 命中对应类别（≥90%），验证对未见布局的泛化。

## 关键字段 precision/recall（任务书 §五.3，目标 ≥90%）

tests/test_field_metrics.py：以 golden 行折 ground truth，对解析器/候选的字段证据
逐字段计算 precision/recall（评估限定关键字段集，失败样例带 missing_fields/review_issues）：

| 类别 | 评估字段 | 实测 |
|---|---|---|
| order | order_id/product_code/quantity/due_date/unit_price | ≥90% |
| order（未知布局列序打乱） | product_code/quantity/due_date | ≥90% |
| equipment | equipment_code/equipment_name | ≥90% |
| worker | worker_code/worker_name/skill | ≥90% |
| inventory | material_code/warehouse/available_qty | ≥90% |
| supplier | supplier_code/supplier_name | ≥90% |

equipment/worker/inventory/supplier 等的字段证据来自通用表头->字段观察器
（business_catalog._generic_observations_from_sheets，非 order/bom 深解析类别也有
row/col/parser_version 定位）。

## Skill 路由与缺字段阻断

- master_data 附件任意文件名 → `business-data-identification` Skill（test_planner_routes_master_data_upload_without_filename_hacks）。
- 缺最低字段表格 → `needs_review` + `missing_fields` 列表（test_missing_fields_block_rates_are_structured）。
- 本地 sandbox/fixture 绝不产出 canonical/committed 断言（test_no_false_production_claim_from_local_fixture）。

## M0 编排链与回读

- data_import_run/status/preview/resolve/commit 本地可编排（tests/test_m0_sandbox.py）。
- commit 前必须 resolve；`require_resolved` 时未裁决 → BLOCKED_INPUT/PENDING_REVIEW。
- `/m0/readback/{batch_id}`：local transport 恒 `canonical_readback_available=false` + dry_run=true；
  只有 http transport + M0_URL 时才报告可回读（真实 M0 联调由部署方提供 URL/schema/授权后执行）。
- 候选证据：source sha、document_kind、confidence、review_status、environment=sandbox、canonical=false。

## 外部阻塞（写入运行日志 blockers.md）

- 真实 M0 canonical 写入与回读：GB10 9000/M0 容器端口未发布、无 M0 URL/PostgreSQL/审核授权 → 本阶段
  只提交 dry-run 报告与 sandbox 实现，未绕过 M0、未写生产数据库。
- 真实多格式批量（RAR 解包等需本地第三方能力）与生产数据盲测由部署方/集成负责人在受控环境执行。
