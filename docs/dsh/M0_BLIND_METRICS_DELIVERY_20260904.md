# M0 阶段一盲测指标与交付记录（DSH）

- 关联：docs/DEEPSEEK_HARNESS_IMPLEMENTATION_TASKBOOK_20260904.md §5.3/§6.2 + DSH 阶段一任务书 §7
- 分支：dsh/m0-ingest-20260904（worktree yunpai-gragh0903-20260904-155229-m0ingest）
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
