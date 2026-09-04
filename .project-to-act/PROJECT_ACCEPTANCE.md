# 项目验收

> 执行测试、交付或声明完成前必须读取本文件。没有新鲜证据时不得写成通过。
> 不粘贴密钥、完整个人信息、原始顾客对话或未脱敏工具输出。

## 当前验收结论

- 结论：既有关键业务路径和线上发布验收保持通过；M3/M4 Tool 与 Skill 补全已通过代码、本地运行态和 mock HTTP 集成验收，真实独立服务/数据库联调尚未执行
- 验收范围：既有前后端集成与线上证据；本次 M3/M4 Tool registry、HTTP Adapter、Skill operation、授权 Gate、错误语义和 M3→M4 流程
- 最后检查：2026-09-04 19:14 +08:00
- 遗留问题：本机未监听 8000、8010、8080、8765、39092，未取得真实 M3/M4 服务 URL、认证和数据库回读条件；不得将 mock HTTP 证据描述为生产验收

## 验收标准

| 标准 ID | 标准 | 状态 | 验证方法 | 证据 ID |
|---|---|---|---|---|
| A-001 | 项目目标达到可验证结果 | 通过（关键路径） | 对照 `PROJECT_OVERVIEW.md`、线上浏览器证据和远端分支 | E-INTEGRATION-003 |
| A-002 | 范围内功能满足完成条件 | 通过（关键路径） | 前端回归、线上多视口点击/滚动和截图报告 | E-INTEGRATION-003 |
| A-003 | 项目约定的测试全部通过 | 部分通过 | 前端 typecheck/build/test 通过；Windows 根 pytest 47 通过、1 个 provenance 换行误报；Git blob hash 一致 | E-REGRESSION-002 |
| A-004 | 阻塞与重大遗留问题已处理 | 部分通过 | 线上无当前错误；环境性 provenance 测试缺口待统一 EOL/CI 复核 | E-INTEGRATION-002 |
| A-005 | 多 session 有唯一分支/worktree、路径认领和发布锁规则 | 通过 | 检查 `docs/SESSION_COLLABORATION_RULES.md`、claims 模板并运行 `--validate` | E-SESSION-001 |
| A-006 | 每个 session 持续维护独立实时修改报告 | 通过 | 检查实时报告规则和 `reports/sessions/README.md` 模板 | E-SESSION-001 |
| A-007 | 微信下载目录全量复核结论可追溯，且不把原始资料误报为不存在 | 通过 | 只读扫描个人/企业微信目录、`~/Downloads` 和导出目录；归档清单、表头核验；账本校验；后端/前端回归与构建 | E-0904-WECHAT-AUDIT-001 |
| A-008 | M0 -> GB10 39092 各类资料已正确落入 canonical 数据库 | 未通过（外部阻塞） | 39092 health/openapi、GB10 SQLite 完整性与 schema、source SHA/候选审核状态、运行状态批次交叉核对 | E-0904-M0-GB10-RECON-001 |
| A-009 | M3/M4 Tool 与 Skill 完整绑定并保持副作用 Gate | 通过（代码与本地运行态） | 完整 pytest、compileall、diff check、账本校验、9001 health/tools、HTTP mock 集成 | E-M3M4-TOOLS-001 |
| A-010 | M1 Tool 与 Skill 完整绑定：17 个 M1 Tool 经专用 HTTP Adapter 可执行（租户头/202 轮询/权限/错误映射），Skill 声明 17 Tool 且查询 op 不打开写入 Gate，本地 fixture 不冒充完整 M1 解析 | 通过（代码与本地运行态） | 完整 pytest、M1 定向测试、compileall、git diff --check、Registry 绑定统计、HTTP mock 集成 | E-M1-TOOLS-001 |

## 证据索引

| 证据 ID | 时间 | 方法或命令 | 退出状态 | 版本或文件哈希 | 结果摘要 | 证据位置 | 有效期 |
|---|---|---|---|---|---|---|---|
| E-PLAN-M1M5-ORCH-001 | 2026-09-04 | 核对当前 Agent/Graph/API/Registry/Skill/M5 lifecycle 实现、远端 M1/M3/M4/M5 分支、交接包、数据审计、GB10/Qwen 和项目治理；逐项检查 27 个基础资料/代码路径；生成自包含 DSH 任务书；运行完整 pytest、账本 `--validate` 和 `git diff --check` | 路径检查、151 项 pytest、账本和 diff 检查全部退出 0；未执行业务代码、分支集成或生产联调 | `dev` / `85c77a4`；执行时远端 SHA 必须重新 fetch | 将 Tool 合并之外的阻塞定位到文件入口、workflow、跨模块桥接、六类 snapshot、M5 lifecycle/head、审批身份和 MES 边界；全部列明路径存在，任务书与当前回归兼容 | `docs/DEEPSEEK_HARNESS_M1_M5_ORCHESTRATOR_TASK_20260904.md` | 2026-09-30 |
| E-GB10-QWEN-001 | 2026-09-04 22:31 +08:00 | 通过 GB10 SSH 使用服务器托管凭据调用三种 `GET /v1/models`；调用 `POST /v1/chat/completions`；只读核对 vLLM 进程参数 | SSH、HTTP 和 JSON 校验全部退出 0 | `dev` / `974eca0`；模型 `qwen3.6-35b-a3b-fp8-gpu0-200k` | `127.0.0.1:18085`、`192.168.110.19:18085` 和 `gb10:18085` 均鉴权成功；chat 返回 `GB10-QWEN-OK`；实际上下文 65536；未记录 API Key | `工作记忆.md`、GB10 当前 vLLM 运行态 | 2026-09-11 |
| E-INFRA-GITLAB-FRP-TS-001 | 2026-09-04 | SSH 只读核对 GitLab22 服务；`frpc verify`、FRP 服务重启；LAN/Tailscale/FRP Web 与 Git SSH 三路径探针；Tailscale ping | 全部退出 0 | GitLab22 `100.127.40.100`；FRP config mode `0600` | `tailscaled.service`/`frpc.service` 均 enabled/active；Web 三路径 HTTP 200；三个 Git SSH 入口 `git ls-remote` 均返回同一 HEAD；token/私钥未进入仓库 | `工作记忆.md`；服务器 `/root/frpc.toml.bak-pre-permissions-20260904-145836` | 2026-09-11 |
| E-M3M4-TOOLS-001 | 2026-09-04 19:23 | Windows venv 完整 pytest；compileall；git diff --check；项目账本 --validate；临时 9001 /health 与 /tools；显式 Yunpai SSH key 执行 fetch/push | 全部代码/本地验证退出 0；69 passed, 1 warning；远端 main 未前移；实现提交已推送 | 实现 commit f7fedaf；分支 codex/m3-m4-tool-skill-completion-20260904；基线 1829888a | 114 个 Tool、45 个 bound；M3 16/17、M4 24/26；两个 receiver 未绑定；M3→M4 mock HTTP、审批、revision/checksum、发送和供应事实确认通过；真实服务未联调 | reports/sessions/s-m3-m4-tools-20260904.md、tests/test_m3_m4_tool_integration.py | 2026-09-11 |
| E-M1-LOCAL-001 | 2026-09-04 22:25 | python3.12 独立 venv 安装 T8 M1 基础依赖并在 127.0.0.1:18081 启动真实服务（SQLite+memory graph）；编排器专用 M1 Adapter 直连真实 HTTP：只读端点、真实 XLSX 上传、TaskStore/文档回读、审核队列、跨租户 404 | 真实 HTTP 探针全部成功；/health degraded、/ready not_ready（无模型层，如实报告） | 实现 commit 8a9794d / 账本 52c5ef3；分支 dsh/m1-tool-skill-completion-20260904 | 真实上传 task b1e064a04ce9 → needs_review 候选并可回读 m1.document.v2；review 队列含该任务；othertenant 读同任务 404；生产验收未通过（缺 GPU/MinerU/Instructor/PostgreSQL/Neo4j） | /tmp/m1run/uvicorn.log、ops/m1/README.md §4.1、reports/sessions/s-m1-tools-20260904.md | 2026-09-11 |
| E-M1-TOOLS-001 | 2026-09-04 22:10 | 完整 pytest；compileall；git diff --check；M1 定向测试；Registry 绑定统计；本地 API/HTTP mock 集成 | 全部退出 0；117 passed, 2 skipped（真实服务 opt-in） | 实现 commit 8a9794d5e7f2e92acbb122692cc66262af59ddd3；分支 dsh/m1-tool-skill-completion-20260904；基线 79973082535f459f7c0be03096c654d233fe99ab | 114 Tool：default 61 bound（M1 17/17：ingest_document 本地 fixture + 16 专用 Adapter），HTTP runtime 112 bound（M1 17/17 专用 Adapter）；Skill yunpai-m1-document-parser 17 Tool / 19 ops；13 个查询 op 免授权 Gate；真实 M1 服务（MinerU/Instructor/PostgreSQL/Neo4j）未联调，生产未验收 | reports/sessions/s-m1-tools-20260904.md、tests/test_m1_*.py、ops/m1/README.md | 2026-09-11 |
| E-SESSION-001 | 2026-09-03 | 初始化脚本 `--validate`；人工审阅规则文件 | 0 | `dev` / `4b9c1aa1` | 治理账本有效，规则与 claim 模板已落盘 | `.project-to-act/`、`docs/SESSION_COLLABORATION_RULES.md`、`.coordination/claims/README.md` | 2026-12-31 |
| E-REGRESSION-002 | 2026-09-03 18:09 | `npm run typecheck`; `npm run build`; `npm test -- --run --maxWorkers=1 --no-file-parallelism`; root `pytest -q` | 前三项 0；root pytest 1（47 passed, 1 EOL hash mismatch） | `dev` / `24da1d70`；Git blob manifest hash 与 provenance 一致 | 前端回归通过；根测试唯一失败为 Windows `core.autocrlf` 工作树换行误报，非代码/运行时错误 | `reports/sessions/s-integration-final-20260903.md`、`reports/s-progress-restore-20260903/REPORT.md` | 2026-12-31 |
| E-INTEGRATION-002 | 2026-09-03 18:10 | Git merge/cherry-pick；线上浏览器控制 API 点击、布局、独立滚动；`/api/health`；静态资源请求 | Git/浏览器/HTTP 均成功；控制台 error/warning 0 | `dev` / `24da1d70`；CSS `f22e390038ea87ff4710bb3235db106d0f9d8e3513bfcf3a4782ffd2a3a18a8c`；release `20260903173855` | 后端与右栏提交完整集成；上传菜单、右栏满高/滚动、移动抽屉和问答关键路径符合预期 | `reports/s-progress-restore-20260903/REPORT.md`、`browser-evidence.json`、七张截图、线上 URL | 2026-12-31 |
| E-INTEGRATION-003 | 2026-09-03 18:20 | 两次 `git push neworigin dev`；`git ls-remote --heads neworigin dev`；项目管理 `--validate`；最终线上状态复核 | 全部退出 0；远端 `dev=ee8541cc`；账本 `valid=true` | `dev` / `ee8541cc`（交付基线 `d48ce911`）；release `20260903173855`；CSS `f22e390038ea87ff4710bb3235db106d0f9d8e3513bfcf3a4782ffd2a3a18a8c` | 集成提交和独立 session 报告已推送；旧 claim/DEPLOY_LOCK 已释放；线上关键路径保持通过 | `reports/sessions/s-integration-final-20260903.md`、`.project-to-act/`、`reports/s-progress-restore-20260903/`、远端分支 | 2026-12-31 |
| E-PMCV2-STREAM-001 | 2026-09-03 | 本地后端/前端测试、W-H128 SOP 流式候选、GB10 Tailscale release/API/静态资源验证 | 0 | release `20260903201200`；run `run-67f945452c254e37a3a3d991749f1d72` | `STREAMING_FLOW` 15 道工序展开 180 条子批次，生成 WIP 数量段与工序衔接边，validator PASS，停在人工发布 Gate；39092 前端包含批次甘特逻辑 | `docs/pmc-v2-streaming/wh128-15ops-gantt.png`、`docs/pmc-v2-streaming/gb10-wh128-15ops-r3-run.json` | 2026-09-10 |
| E-0904-WECHAT-AUDIT-001 | 2026-09-04 | `find` 目录/扩展名统计；ZIP/RAR/7z 归档清单；bundled Python/openpyxl 表头读取；`soffice` 临时转换旧 `.xls`；账本 `--validate`；`.venv/bin/python -m pytest -q`；`cd frontend && npm test -- --run`；`cd frontend && npm run build` | 全部退出 0 | `dev` / 本次审计提交 | 覆盖个人微信 `msg/file` 1,078、`msg/attach` 约 30,500、`~/Downloads` 约 43,054 和企业微信邮件缓存；确认真实制造资料存在，生产人员/技能/工位绑定、生产日历、当前 WIP、MES 事件仍未形成可放行实体；后端 58、前端 4 测试通过并成功构建 | `docs/WECHAT_DOWNLOAD_AUDIT_20260904.md`、`docs/DATA_REQUIREMENTS_0903.md` | 2026-09-11 |
| E-0904-M0-GB10-RECON-001 | 2026-09-04 | 39092 `/api/health`、`/api/openapi.json`、M0 路径 404；SSH 只读检查 current release、SQLite `integrity_check`/schema/批次/来源 SHA/候选审核状态；进程、监听端口和 `.env.example` 运行方式核对 | 只读命令全部退出 0；结论未通过 | release `20260903201200`；catalog SQLite 779 条来源/392 个唯一 SHA；canonical entity 表 0 | 设备和库存来源进入候选目录但均未批准；代表性供应商明细、成本/财务、人员/工资 SHA 未进入目录（采购类候选仍存在）；没有可验证的 M0 canonical 表或写入回读证据；不能补传，需受控 M0 URL/PostgreSQL/审核授权 | `docs/M0_GB10_INGEST_RECONCILIATION_20260904.md` | 2026-09-11 |
| E-PLAN-DEEPSEEK-HARNESS-001 | 2026-09-04 | 读取项目账本、仓库分支/远端状态、上传识别代码、Skill 文档和 GB10 对账报告；生成 DeepSeek Harness 实施任务书 | 规划完成；未执行代码、数据或线上写入 | `dev` / `7acc4bb`；`main` / `59e9bfe`；任务书文档 SHA 以 Git 提交为准 | 明确 main -> dev 基线同步、上传识别/M0-M5/PMC 改造、GB10 新 release 测试、canonical 回读、推送和 MR 合并门槛；等待 Harness 执行 | `docs/DEEPSEEK_HARNESS_IMPLEMENTATION_TASKBOOK_20260904.md` | 2026-09-30 |
| E-HANDOFF-M1-001 | 2026-09-04 | `git fetch origin main dev`；M1 manifest/registry/Skill/handler 与历史源码逐项审计；JSON 解析、归档清单、SHA-256、敏感路径/文本扫描、项目账本校验；`/Users/murkydoubloon45/Desktop/yunpaigragh/.venv/bin/python -m pytest -q` | 包级校验和回归测试退出 0（151 passed）；未执行 M1 生产 HTTP/数据库联调 | `origin/main` / `1829888a58855b0fd6064fa5b8ee4a858823c191`；`origin/dev` 生成基线 / `a0d943317b07b09d7112078eb4e3800a686af4aa`；总归档 SHA-256 `0f28bf95898f0dcbae3535b4388cc2456f100d48f635e27394ebc0c6993c8eb1`；最终任务包提交以 Git 记录为准 | 形成独立 M1 开发任务包，覆盖 17 个注册工具、Skill 缺口、T8/0902 净化源码、迁移映射、开发合同和分层验收；仅证明资料包完整，不证明功能或生产链路完成 | `handoff/m1-tool-skill-completion-20260904/`、`handoff/m1-tool-skill-completion-20260904.tar.gz` | 2026-09-30 |

## Gate 记录

| Gate ID | 日期 | Gate | 对象 | 结果 | 证据 ID | 豁免与确认人 |
|---|---|---|---|---|---|---|
| G-003 | 2026-09-04 | M3/M4 Tool 与 Skill 代码验收 Gate | codex/m3-m4-tool-skill-completion-20260904 | 通过（不含真实外部服务） | E-M3M4-TOOLS-001 | Codex |
| G-001 | 2026-09-03 | 协作治理 Gate | 多 session 规则 | 通过 | E-SESSION-001 | zhb |
| G-002 | 2026-09-03 | 前后端集成与线上关键路径 Gate | `dev` / GB10 39092 | 通过（关键路径；完整 pytest 环境性缺口已记录） | E-INTEGRATION-003 | zhb |

## 验收记录

按时间倒序追加：日期、检查范围、证据 ID、结果、遗留问题和结论。失败、跳过与过期证据也必须如实记录。

- 2026-09-04：核对 M1-M5 Agent/Worker/Skill/Tool 主链和当前分支成果，生成自包含 DSH Orchestrator 执行任务书；27 个资料/代码位置均存在，完整后端 151 项、账本和 diff 检查通过；证据 `E-PLAN-M1M5-ORCH-001`；结论：任务书完整覆盖基础资料、GB10/Qwen、流程断点、实施和验收，但本记录只证明任务交接完成，不证明代码集成或生产链路完成。
- 2026-09-04 22:31 +08:00：实测 GB10 Qwen 35B 的 OpenAI-compatible models/chat 调用，并核对 18085 鉴权入口、18095 vLLM 后端、模型名和 65536 上下文；证据 `E-GB10-QWEN-001`；结论：三种地址均可用，chat 返回预期正文，调用方法已脱敏写入 `工作记忆.md`。
- 2026-09-04：核对并收紧 GitLab22 的 FRP/Tailscale 入口；证据 `E-INFRA-GITLAB-FRP-TS-001`；结论：LAN `:8181/:2222`、Tailscale `100.127.40.100:8181/:2222`、FRP `linkdown.bitnp.asia:6001/:6002` 均可用，FRP token 配置已改为 `0600 root:root` 并保留 root-only 备份；未修改业务代码、GitLab 数据或仓库内容。
- 2026-09-04：检查 M3/M4 registry、Skill、授权 Gate、HTTP Adapter、完整后端回归和本地 FastAPI 运行态；证据 E-M3M4-TOOLS-001；结论：代码与本地运行态通过，真实 M3/M4 服务和数据库回读因外部条件缺失未验收。
- 2026-09-03：检查治理文件、分支策略、claim 模板和配置校验；证据 `E-SESSION-001`；结论：可开始并行 session，业务验收仍按各任务单独记录。
- 2026-09-03：检查集成提交、前端顺序回归、线上 `39092` 多视口点击/滚动、静态资源和 `/api/health`；证据 `E-INTEGRATION-002`、`E-REGRESSION-002`；结论：关键路径通过；CLI Playwright/OCR 与 Windows provenance 换行测试缺口已如实保留。
- 2026-09-03：确认 `dev` 已推送到 `neworigin/dev`，账本校验通过，旧 session claim/发布锁已释放；证据 `E-INTEGRATION-003`；结论：本次集成交付完成，后续只需按独立任务处理环境性 EOL/工具缺口。
- 2026-09-03：复核 PMC v2 流式 WIP 与 GB10 39092 运行结果；证据 `E-PMCV2-STREAM-001`；结论：十五道工序和批次级 WIP 已生成，保留人工发布 Gate。
- 2026-09-04：完成微信/企业微信及本机下载目录全量只读复核；证据 `E-0904-WECHAT-AUDIT-001`；结论：真实订单、BOM、库存、采购入库、供应商、设备/模具、SOP/IE 时间和历史排产存在，但不能替代生产人员、技能绑定、日历、当前 WIP 与执行回传；真实 PMC 继续保持生产阻断。
- 2026-09-04：逐类核对 GB10 39092 候选目录、来源 SHA、候选审核状态、运行批次与 M0 接入面；证据 `E-0904-M0-GB10-RECON-001`；结论：设备和库存仅进入候选源库，代表性供应商明细/成本财务/人员主数据未进入（采购类候选仍存在）；39092 使用 local transport 且 M0 HTTP 路径不可达，未执行绕过 M0 的补传，canonical 落库和完整 PMC 仍阻塞。
- 2026-09-04：核对 M1 现状、历史实现、17 个工具合同和 Skill 覆盖并生成独立开发任务包；证据 `E-HANDOFF-M1-001`；结论：任务资料、净化源码、逐项迁移和验收规范齐全，包级校验及项目回归通过；M1 业务实现、真实格式矩阵、PostgreSQL/Outbox/Neo4j 回读与生产 HTTP 联调未在本次执行，不得据此标记生产验收通过。
- 2026-09-04 22:25：本地真实 T8 M1 服务运行联调（SQLite+memory，无模型层）；证据 E-M1-LOCAL-001；结论：服务本体可运行、编排器真实 HTTP 联通、上传进入 needs_review 候选并回读、跨租户 404；因缺模型/数据库条件，生产验收仍未通过。
- 2026-09-04：检查 M1 Registry/Skill/专用 HTTP Adapter、租户与角色头、202 轮询、错误映射、本地 fixture 边界和 M1 定向测试；证据 E-M1-TOOLS-001；结论：代码与本地运行态通过（117 passed, 2 skipped），真实 M1 独立服务与数据库回读因外部条件缺失未验收。
