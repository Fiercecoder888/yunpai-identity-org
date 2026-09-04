# DSH 盲测与 Skill 回归交付记录

- 关联：docs/DEEPSEEK_HARNESS_IMPLEMENTATION_TASKBOOK_20260904.md §5.3/§6.2
- 分支：dsh/upload-m0-pmc-20260904
- 日期：2026-09-04

## 盲测指标（tests/test_skill_blind_metrics.py）

| 指标 | 实现 | 说明 |
|---|---|---|
| Skill 路由准确率 | test_planner_routes_master_data_upload_without_filename_hacks | master_data 附件任意文件名均绑定 business-data-identification（不写文件名特例） |
| 分类准确率（内容修正） | test_blind_classifier_upgrades_content_based_kinds / test_blind_ingest_reports_kinds_without_error | 6 个未见布局 fixture（order/equipment/bom/station/worker/inventory），表头内容命中 ≥5/6 |
| 缺字段阻断率 | test_missing_fields_block_rates_are_structured | 缺最低字段表格必须 needs_review + missing_fields 列表，不静默完成 |
| 误报生产事实率 | test_no_false_production_claim_from_local_fixture | 本地 fixture 不产出 committed/canonical 断言 |
| 可复现性 | test_blind_ingest_repeatable_same_snapshot / test_same_input_reproducible_skill_catalog_and_routing | 同快照重复运行结果一致 |

## 错误归因（§5.3.2）

本次盲测未发现需要新增文件名特例的错误；分类失败场景（单列表格信号不足保持
tabular）归因于分类器最小命中阈值 2 的设计，属可复用规则边界，不作为特例修正。
字段缺失（equipment_code 等）归因到 schema 最低字段门槛，已在规则级修复并回归。

## Skill 升级回归集（tests/test_skill_upgrade_regression.py）

- SKILL_VERSION_BASELINE 锁定 8 个 Skill 的版本与关键声明工具；升级必须显式更新并全量回归。
- 同快照 Skill 调用两次结果一致，evidence 带 skill:name@version 引用。

## 盲测 fixture 列表

见 test_skill_blind_metrics.py CASES（customs/PO…备货表、vendor/设备档案、import/BOM表-new、
factory/工位清单、hr/员工技能表、wh/库存盘点；另含缺列设备表）。
