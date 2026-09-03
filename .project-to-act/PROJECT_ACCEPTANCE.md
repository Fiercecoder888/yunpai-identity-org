# 项目验收

> 执行测试、交付或声明完成前必须读取本文件。没有新鲜证据时不得写成通过。
> 不粘贴密钥、完整个人信息、原始顾客对话或未脱敏工具输出。

## 当前验收结论

- 结论：协作治理验收通过；业务功能持续验收
- 验收范围：多 session 规则、分支隔离、路径认领和发布约束
- 最后检查：2026-09-03
- 遗留问题：后续 session 需按规则登记并提供各自证据

## 验收标准

| 标准 ID | 标准 | 状态 | 验证方法 | 证据 ID |
|---|---|---|---|---|
| A-001 | 项目目标达到可验证结果 | 待检查 | 对照 `PROJECT_OVERVIEW.md` | 无 |
| A-002 | 范围内功能满足完成条件 | 待检查 | 对照 `PROJECT_FEATURES.md` | 无 |
| A-003 | 项目约定的测试全部通过 | 待检查 | 运行完整测试命令 | 无 |
| A-004 | 阻塞与重大遗留问题已处理 | 待检查 | 对照 `PROJECT_PROGRESS.md` | 无 |
| A-005 | 多 session 有唯一分支/worktree、路径认领和发布锁规则 | 通过 | 检查 `docs/SESSION_COLLABORATION_RULES.md`、claims 模板并运行 `--validate` | E-SESSION-001 |
| A-006 | 每个 session 持续维护独立实时修改报告 | 通过 | 检查实时报告规则和 `reports/sessions/README.md` 模板 | E-SESSION-001 |
| A-007 | 39085/0902/当前版本功能差异与 PMC 风险有可追溯结论 | 通过 | 审阅差异文档、历史 39085 排程 JSON、当前 PMC 代码并运行规定测试 | E-PMC-DIFF-001 |
| A-008 | 0903 数据需求与已有数据优化项可追溯，且明确真实 PMC 生产阻断边界 | 通过 | 审阅数据需求文档、真实订单验证、业务目录统计、PMC v2 snapshot 合同和 WIP 来源审计；运行账本校验与项目测试 | E-0903-DATA-REQ-001 |

## 证据索引

| 证据 ID | 时间 | 方法或命令 | 退出状态 | 版本或文件哈希 | 结果摘要 | 证据位置 | 有效期 |
|---|---|---|---|---|---|---|---|
| E-SESSION-001 | 2026-09-03 | 初始化脚本 `--validate`；人工审阅规则文件 | 0 | `dev` / `4b9c1aa1` | 治理账本有效，规则与 claim 模板已落盘 | `.project-to-act/`、`docs/SESSION_COLLABORATION_RULES.md`、`.coordination/claims/README.md` | 2026-12-31 |
| E-PMC-DIFF-001 | 2026-09-03 | `.venv/bin/python -m pytest -q`; `cd frontend && npm test -- --run`; `cd frontend && npm run build`; 代码/历史证据审阅；PMC 默认值最小复现 | 0 | `dev` 工作区（HEAD `0a766ed`，含未提交改动） | 差异文档完成；48 后端测试、4 前端测试和构建通过；PMC 生产闭环仍未通过 | `docs/FUNCTION_DIFFERENCE_39085_0902_CURRENT.md` 及文档列出的证据路径 | 2026-12-31 |
| E-PMCV2-GB10-001 | 2026-09-03 | Tailscale HTTP health/API 联调；GB10 `solve_scheduling` 显式 PMC v2 调用；浏览器结果预览截图 | 0 | run `run-a6954a7068dd4667bdf4650d072a165f`；plan `wip-v2-f705464333` | PO-20260902-001/W-H410 生成 5 道工序、08:00–08:10 排程，资源阻断 0，validator PASS；停在发布前人工 Gate，未发布 | `docs/pmc-v2-gb10-PO-20260902-001-preview.html`、`docs/pmc-v2-gb10-PO-20260902-001-20260903.png` | 2026-09-10 |
| E-PMCV2-STREAM-001 | 2026-09-03 | 本地后端/前端测试、W-H128 SOP 流式候选、浏览器截图、GB10 Tailscale release/API/静态资源验证 | 0 | release `20260903201200`；run `run-67f945452c254e37a3a3d991749f1d72`；包 SHA-256 `dae7d89292f0cdc2e58df7a3b739184d745579e2470170827952ecff4d77e20b` | `STREAMING_FLOW` 15 道工序展开 180 条子批次，GB10 返回 324 条 WIP 数量段、14 条 WIP 边、180 active/266 blocked 状态段，validator PASS，停在人工发布 Gate；39092 新前端资源包含批次甘特逻辑 | `docs/pmc-v2-streaming/wh128-15ops-gantt.png`、`docs/pmc-v2-streaming/gb10-wh128-15ops-r3-run.json` | 2026-09-10 |
| E-39092-SKILL-REAL-001 | 2026-09-03 | 高阶 Skill/Tool/MCP 注册测试；真实 XLSX `/runs/upload` 全链路；显式 PMC v2 Skill；`pytest`、前端测试/构建、ledger validate | 0 | `dev` 工作区；run `run-98a0544c93674118b8d470a175a97230`、PMC run `run-4df2d4081de94ea184ea88c7a420abea` | 8 个 Skill、114 个 Tool/MCP 合同可发现；真实订单 8 行贯通 M0→M5 并生成 8 道工序；PMC v2 94 batches 因缺工位/人员绑定阻断，未投产 | `docs/39092_REAL_DATA_UPLOAD_TEST_20260903.md` | 2026-09-10 |
| E-0903-DATA-REQ-001 | 2026-09-03 | 业务目录 SQLite 统计、真实订单解析报告、PMC v2 snapshot 合同审阅、WIP 来源审计；`.venv/bin/python -m pytest -q`；`cd frontend && npm test -- --run`；`cd frontend && npm run build`；`init_project_management.py --validate` | 0 | `dev` / 本次数据需求文档提交 | 已形成 P0/P1 数据缺口、现有数据优化项、交付文件模板和真实 PMC 验收门槛；后端 58、前端 4 测试通过并成功构建；生产排程仍因资源事实缺失保持阻断 | `docs/DATA_REQUIREMENTS_0903.md`、`docs/WIP_PMC_SOURCE_AUDIT_20260903.md`、`docs/39092_REAL_DATA_UPLOAD_TEST_20260903.md` | 2026-09-10 |

## Gate 记录

| Gate ID | 日期 | Gate | 对象 | 结果 | 证据 ID | 豁免与确认人 |
|---|---|---|---|---|---|---|
| G-001 | 2026-09-03 | 协作治理 Gate | 多 session 规则 | 通过 | E-SESSION-001 | zhb |

## 验收记录

按时间倒序追加：日期、检查范围、证据 ID、结果、遗留问题和结论。失败、跳过与过期证据也必须如实记录。

- 2026-09-03：检查治理文件、分支策略、claim 模板和配置校验；证据 `E-SESSION-001`；结论：可开始并行 session，业务验收仍按各任务单独记录。
- 2026-09-03：检查 39085/0902/当前 PMC 功能差异并完成规定测试；证据 `E-PMC-DIFF-001`；结论：差异审计通过，PMC 仅能标注为 constrained preview/draft，P0/P1 修复后再做生产验收。
- 2026-09-03：GB10 Tailscale 联调与 PMC v2 只读候选截图验收；证据 `E-PMCV2-GB10-001`；结论：候选计算和前端预览可复核，生产发布 Gate 未批准，生产闭环仍待严格生命周期接入。
- 2026-09-03：验收 39092 Skill 注册、Agent 路由和真实订单上传；证据 `E-39092-SKILL-REAL-001`；结论：注册与数据桥接通过，真实 PMC v2 因缺少工位/人员事实正确阻断，业务生产验收仍未完成。
- 2026-09-03：完成 0903 数据需求审计文档；证据 `E-0903-DATA-REQ-001`；结论：数据需求、已有数据优化和验收门槛可追溯，文档交付通过；真实 PMC 生产验收仍未完成，需按 P0 数据包补齐后复验。
