# M5 PMC v2 集成验收 — 2026-09-04（dev 合并 + GB10 隔离 release）

- 分支：`pmctooldev`（remote `origin/pmctooldev` = `61382f2`）
- 基线：origin/main @ 7997308 → pmctooldev fork @ 1829888 → 合并 origin/dev @ a3384379（54ded86）
- 目标 release：`/home/wjc/yunpai-langgraph/releases/20260904-pmctooldev-m5-accept`（192.168.110.19）
- DEPLOY_LOCK：`.coordination/claims/pmctooldev-m5-pmc-v2.md`（独立端口，未覆盖 39092/9000）

## 1. 测试门槛（本机，合并后）

| 命令 | 结果 |
|---|---|
| `.venv/bin/python -m pytest -q`（worktree 合并后） | **201 passed / exit 0** |
| `cd frontend && npm test -- --run` | 6 passed / exit 0 |
| `cd frontend && npm run build` | exit 0（dist 生成） |
| `git diff --check` | 通过 |
| 项目账本 `init_project_management.py --project-root . --validate` | `valid=true`，issues=[] |

> 注：合并后本地绑定数 = **27**（dev 10 个本地 handler + pmctooldev 新增 17 个 M5 handler），因此
> health `bound_tools=27`；若按旧口径 7+17=24 计数则不含 dev 新增的 M0 status/preview/resolve。

## 2. Registry/Skill 不变量（HTTP 实测）

- `/health`：`tools=114, bound_tools=27, skills=8`
- `GET /tools?module=m5`：20 个 M5 工具中 **18 bound**；`report_workload`、`bind_worker_to_order` 未绑定
- `yunpai-m5-pmc` 白名单 13、`yunpai-m5-pmc-lifecycle` 7；两排除工具不在任何 Skill

## 3. HTTP 业务验收（隔离后端 127.0.0.1:9001，本地 transport，独立 M5 SQLite）

| 步骤 | 结果 |
|---|---|
| solve_scheduling（HTTP /runs，apply Gate 后） | success=True，plan_version=`plan-SC-ACCEPT-HDMI-85e6057457` |
| get_m5_schedule / list_m5_schedules（HTTP） | success=True，input_hash 64 位；列表含该版本 |
| approve→release + set_head（repository actor 过渡） | lifecycle audit=[approved, released]；head revision=1 |
| dispatch_m5_schedule（HTTP） | status=pending；同幂等键重放 `replayed=True` |
| execution event 写入 → summary/progress | summary event_count=1；progress（released head）orders[0] ops=2 |
| replan_m5_schedule（HTTP insert_order） | success=True；新版本 `replan-plan-...-7dcce314`；parent 保留；bundle 从 SO-ACCEPT-1 增加 SO-ACCEPT-2（事件真实应用） |
| 同幂等键异输入 | HTTP 409 `IDEMPOTENCY_CONFLICT`（data gate 拒绝，阻断语义） |
| 陈旧 head CAS | `HEAD_CONFLICT` |
| pressure_only 计划 release | `PURPOSE_NOT_RELEASABLE` |

## 4. SQLite 回读（独立验收库 runtime/yunpai-m5-acceptance.sqlite）

- 六类 snapshot：order_snapshots / routes / resource_snapshot / calendar_snapshot / supply_snapshot / constraint_snapshot ✅
- plan：plan_version、lifecycle_status、input_hash、bundle、schedule ✅
- lifecycle audit：`m5_lifecycle` 记录 approved/released + actor/gate/task ✅
- dispatch：durable pending 记录 ✅
- execution events：持久化 event 落库并可汇总 ✅

## 5. 阻塞与边界

- 无新阻塞。39093 静态代理仅转发 `/api/*`（`/tools` 404 属代理预期范围；M5 绑定经 9001 验证）。
- 未推送 dev/main——按用户流程，等待集成负责人把 `origin/pmctooldev`（61382f2）合入 dev；dev 全绿后走集成流程合 main。
- 未启用 m5-api:8000；生产 MES/真实外部服务读回不在本次隔离范围。
