# M5 PMC v2 完善 — pmctooldev 实现设计笔记

- 分支：`pmctooldev`（基于 `origin/main` @ 1829888a58855b0fd6064fa5b8ee4a858823c191）
- 任务书：`handoff/m5-pmc-v2-completion-20260904/TASKBOOK.md` 及同目录其余文档
- 关联任务书：`docs/DEEPSEEK_HARNESS_IMPLEMENTATION_TASKBOOK_20260904.md`、`docs/dsh/PMC_P0P2_DSH_SUPPLEMENT_CONFIRMATION_20260904.md`
- 用户决策（2026-09-04）：先在独立 `pmctooldev` 分支开发并做 GB10 验证；验证无误后把改动提交到 `dev` 等待合并；不直接推 `main`；`dev` 上其它 session 的未提交改动不得触碰。

## 1. 核对一致的现状（2026-09-04 实测）

| 项 | 值 |
|---|---|
| `build_default_registry()` 工具总数 | 114（M0 27 / M1 17 / M2 7 / M3 17 / M4 26 / M5 20）|
| M5 manifest | 20 工具；`solve_scheduling` 唯一绑定本地 handler |
| `build_default_skill_registry()` | 8 个 Skill |
| M5 两个 Skill 现状 | `yunpai-m5-pmc` tools 元组含排除工具；`yunpai-m5-pmc-lifecycle` 缺 ingest 等 |
| 本地 pytest 基线 | **60 passed**（任务书写 59，已 +1）|
| 真实服务 | 本工作区无 `m5-api:8000`；T8 历史代码与 0902 测试在 Desktop 其他目录 |

## 2. 范围与数字口径

- M5 manifest 20 = 在范围 18（两个 Skill 工具并集 13+7−共享 2）+ 排除 2。
- `solve_scheduling` 已完成 → 本任务补 **17** 个 handler：`get_m5_schedule`、`list_m5_schedules`、`get_m5_pmc_progress`、`get_m5_material_readiness`、`get_m5_integration_contracts`、`replan_m5_schedule`、`dispatch_m5_schedule`、`get_m5_execution_summary`、`ingest_m5_planning_snapshot`、`generate_m5_material_procurement_plan`、`advise_m5_schedule`、`run_m5_intelligent_schedule`、`search_m5_knowledge`、`record_m5_knowledge`、`prepare_m5_department_message`、`get_m5_department_message`、`get_m5_department_message_delivery`。
- 排除（保持 unbound、不进任何 Skill）：`report_workload`、`bind_worker_to_order`。
- 数量不变量：注册表 114、M5 manifest 20、Skill 8。

## 3. 任务书文字与基线回归的冲突处置口径（重要）

任务 1（删隐式默认、production 强制 v2、legacy 仅显式 preview）会与现有回归 fixture 冲突：
`tests/test_pmc_v2_streaming.py`（日历只有 start/end、资源无容量/效率、无 approval_ref）、
`tests/test_graph.py`（production 默认走 legacy 贪心、apply 后内存置 released）等。

**处置口径**：代码按任务书严格化（删默认 → BLOCKED_INPUT）；现有回归测试若因“隐式默认被删”而失败，
按“等价升级 fixture”（补显式 calendar_ref/shift/capacity/efficiency/approval_ref；legacy 请求显式加
`legacy_preview: true` 标记）使其在新合同下仍全绿，并在测试/报告中说明。不允许改动既有通过语义断言来“刷绿”。

## 4. 实现层次规划（自底向上）

1. 内核层：`pmc_v2_adapter.py` / `pmc_v2_snapshots.py` / `pmc_v2_scheduler.py` — 删隐式默认、canonical input_hash。
2. 仓库层：新增 `m5_repository.py`（SQLite，仿 `SQLiteRunRepository`），保存六类 snapshot、plan、版本/CAS、lifecycle、execution、message、knowledge、procurement proposal；幂等 replay / 同键冲突 / released 保护。
3. 服务层：17 个 handler（workers/HANDLERS 或独立模块注册）按 m5.json 输入/输出 schema 实现本地语义，输出可过 schema 校验。
4. 生命周期：draft→approved→released→dispatched→execution；replan 从服务端 base_plan_version 恢复 bundle。
5. Skill/Agent：`skills.py` 两个 Skill operation map 对齐、白名单只含范围工具；`agents.py` 只读 op 与 Gate 规则同步；删 report_workload/bind_worker。
6. 测试：任务书建议的 test_m5_* 矩阵 + HTTP mock + 真实读回记录（不可达则记为阻塞）。

## 5. 验收报告口径

按 `TEST_ACCEPTANCE.md` 记录：local_tests_passed / contract_tests_passed / real_http_readback /
real_db_readback / lifecycle_verified / execution_verified / blockers。无真实服务读回时不得声称生产 PMC 完成。
