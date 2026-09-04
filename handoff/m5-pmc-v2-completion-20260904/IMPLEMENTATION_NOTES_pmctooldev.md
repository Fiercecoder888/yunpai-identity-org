# M5 PMC v2 完善 — pmctooldev 实现状态与验收证据

- 分支：`pmctooldev`（基于 `origin/main` @ 1829888a58855b0fd6064fa5b8ee4a858823c191）
- 任务书：`handoff/m5-pmc-v2-completion-20260904/TASKBOOK.md` 及同目录文档
- 用户流程决策：先在 `pmctooldev` 完成开发与本地验证；验证通过后再提交 `dev` 等待合并；不直接推 `main`；`dev` 上其它 session 未提交改动未触碰。

## 1. 完成状态（2026-09-04 实测）

| 任务 | 状态 | 提交 |
|---|---|---|
| Task 1 严格化 PMC v2 输入（删隐式默认/legacy 显式 preview/规范化 hash） | 完成 | `55f3c86` |
| Task 2 snapshot/plan sqlite repository（幂等/CAS/已发布保护/生命周期迁移） | 完成 | `f2f3dc4` |
| Task 3/4/5 17 个 handler + lifecycle + progress/readiness + messages/knowledge/procurement | 完成 | `2a189f4` |
| Task 6 Skill operation 映射与 agents Gate 同步 | 完成 | 同 `2a189f4` |
| 测试矩阵（strict/tool binding/skill ops/http+metrics/lifecycle tools） | 完成 | `b437c32` |
| solve 落库幂等（registry 真实入口 replay/conflict） | 完成 | `a7a89b6` |
| session 报告 | 完成 | `27fac5f` |
| 服务端生命周期守卫（pressure_only/validation-failed 不可 release）＋ ingest 只建快照不求解 | 完成 | `06fb51c` |
| replan 保留 event/freeze/locks 元数据＋progress 只挂持久化执行证据 | 完成 | 待提交 |

本地回归：**107 passed**（原 60 passed 基线全部保留并按新合同等价升级；新增 47 项 M5 测试）。

Registry 数量实测：工具总数 **114**、M5 manifest **20**、Skill **8**；M5 已绑定 **18**（17 新增 + solve_scheduling），排除工具 `report_workload`/`bind_worker_to_order` 保持未绑定且不在任何 Skill。

## 2. Task1 关键改动

- `pmc_v2_adapter.py`：`_strict_production()` 识别 production（非 legacy_preview）；删 date-only 日历默认 08:00-17:00、资源 capacity 60/efficiency 1/equipment_type 默认、route `APPROVED-ROUTE`/`route_version`/`route_code` 默认；缺 supply/readiness → `MISSING_SUPPLY`；`input_hash = sha256(canonical_bytes(bundle))`。
- `pmc_v2_scheduler.py`：无绑定设备的工序时长不再用隐式 60/h、效率 1（直接用显式 standard minutes）。
- `workers.py::m5_schedule`：production 且无 v2 事实且未显式 `legacy_preview` → `LEGACY_PRODUCTION_BLOCKED`；legacy 仅显式 preview/sandbox。
- `graph.py`：m0_m5 演示链路 fixture 显式 `legacy_preview: true`（fixture/sandbox 语义）。
- 反例测试：`tests/test_m5_pmc_v2_strict_input.py`（10 项）。

## 3. Repository 语义（sqlite，`runtime/yunpai-m5.sqlite`，可用 ctx `m5_db_path`/env `YUNPAI_M5_DB` 覆盖）

- 六类 snapshot（order/routes/resource/calendar/supply/constraint）按 scenario 持久化并可读回。
- plan 表：plan_version/lifecycle_status/parent/input_hash/solver_hash/algorithm_version/validation/bundle/schedule/released_at。
- idempotency：同键同输入重放；save 已 released 计划 → `PLAN_PROTECTED`。
- scenario head CAS：`set_head(expected_revision=...)`，冲突 `HEAD_CONFLICT`。
- lifecycle：`draft→approved→released→dispatched→execution` 相邻迁移 + `m5_lifecycle` 审计日志；仅 production 且 validation report pass 可 release/dispatch/execution，pressure_only/preview → `PURPOSE_NOT_RELEASABLE`。
- 追加：dispatch（pending durable）、execution events（幂等）、department messages（pending_approval→approved→outbox）、knowledge、procurement proposals。

## 4. 17 个本地 handler（m5_tools.py，registry 绑定已验证）

get_m5_schedule / list_m5_schedules / get_m5_pmc_progress / get_m5_material_readiness /
get_m5_integration_contracts / ingest_m5_planning_snapshot / replan_m5_schedule /
dispatch_m5_schedule / get_m5_execution_summary / search_m5_knowledge / record_m5_knowledge /
prepare_m5_department_message / get_m5_department_message / get_m5_department_message_delivery /
advise_m5_schedule / run_m5_intelligent_schedule / generate_m5_material_procurement_plan

边界遵守：
- dispatch 仅 released；无 MES sender → 只回 pending，不声称已发送。
- execution summary 只汇总持久化事件，不伪造实际执行。
- record/search knowledge 仅引用已持久化 plan。
- department message 只到 pending_approval；approved→outbox 由人工 actor 触发。
- procurement 只生成 proposal，不写库存/采购事实。
- pressure_only/preview/validation-failed 不进入 release/dispatch（progress 只接受 released+production+head，其它 raise/blocked）。
- LLM 不修改硬约束/snapshot/状态。

## 5. Skill/Agent

- `skills.py`：`yunpai-m5-pmc` 白名单 13 个工具、`yunpai-m5-pmc-lifecycle` 7 个工具；删 `report_workload`/`bind_worker_to_order`；每个 operation 有唯一工具映射。
- `agents.py`：`_READ_ONLY_SKILL_OPERATIONS` 同步（pmc：schedule/progress/contracts/readiness/knowledge_search/message_get/message_delivery/advise/intelligent；lifecycle：default/schedule/versions/progress/execution）。

## 6. 测试矩阵（tests/）

- `test_m5_pmc_v2_strict_input.py`：默认值禁止 / v2-only / 缺事实阻断 / canonical hash。
- `test_m5_plan_repository.py`：六类 snapshot 读回、幂等 replay、同键异输入、head CAS、released 保护、合法/非法迁移。
- `test_m5_lifecycle_tools.py`：release→progress→dispatch→execution；replan 从服务端恢复父 bundle；messages pending→approved→outbox；knowledge；readiness；procurement；ingest/get/list。
- `test_m5_tool_bindings.py`：17 个绑定、2 排除未绑定、schema pass。
- `test_m5_skill_operations.py`：白名单与 Scope 完全一致、operation→tool 映射、跨模块/排除工具拒绝、只读 Gate。
- `test_m5_http_metrics.py`：HTTP method/path 合同、路径参数替换、metrics 不伪造、dispatch replay。

## 7. 验收结论（TEST_ACCEPTANCE 格式）

| 项 | 值 |
|---|---|
| local_tests_passed | ✅ 103 passed（.venv/bin/python -m pytest -q，exit 0） |
| contract_tests_passed | ✅ strict/binding/skill/http/metrics/lifecycle/solve-idempotency 契约测试全绿 |
| real_http_readback | ❌ 阻塞：本工作区无 `m5-api:8000`/GB10 M5 服务可读（未运行） |
| real_db_readback | ⚠️ 本地 sqlite 读回已验证（runtime/yunpai-m5.sqlite 语义）；生产 DB 读回待 GB10 联调 |
| lifecycle_verified | ✅ 本地 repository 状态机 + 事件日志（approved/released/dispatched/execution） |
| execution_verified | ✅ 本地 execution events 幂等落库 + summary（非真实 MES） |
| blockers | GB10 真实 HTTP/DB 联调未执行（用户要求验证无误后合 dev） |

未完成项：GB10 真实服务读回；因此本交付不声称“生产 PMC 已完成”。
