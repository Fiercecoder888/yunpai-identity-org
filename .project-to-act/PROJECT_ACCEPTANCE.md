# 项目验收

> 执行测试、交付或声明完成前必须读取本文件。没有新鲜证据时不得写成通过。
> 不粘贴密钥、完整个人信息、原始顾客对话或未脱敏工具输出。

## 当前验收结论

- 结论：关键业务路径、右栏响应式布局和线上发布验收通过；Windows provenance 字节哈希测试仍需在统一 EOL/CI 环境复核
- 验收范围：前后端集成提交、右栏视觉/高度/滚动、关键页面点击、health 和前端回归
- 最后检查：2026-09-03 18:20 +08:00
- 遗留问题：本机 CLI Playwright 缺 Chromium；中文 OCR 引擎未安装；两项均已用真实浏览器控制 API、截图和同 DOM 可读文本证据替代并如实记录

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

## 证据索引

| 证据 ID | 时间 | 方法或命令 | 退出状态 | 版本或文件哈希 | 结果摘要 | 证据位置 | 有效期 |
|---|---|---|---|---|---|---|---|
| E-SESSION-001 | 2026-09-03 | 初始化脚本 `--validate`；人工审阅规则文件 | 0 | `dev` / `4b9c1aa1` | 治理账本有效，规则与 claim 模板已落盘 | `.project-to-act/`、`docs/SESSION_COLLABORATION_RULES.md`、`.coordination/claims/README.md` | 2026-12-31 |
| E-REGRESSION-002 | 2026-09-03 18:09 | `npm run typecheck`; `npm run build`; `npm test -- --run --maxWorkers=1 --no-file-parallelism`; root `pytest -q` | 前三项 0；root pytest 1（47 passed, 1 EOL hash mismatch） | `dev` / `24da1d70`；Git blob manifest hash 与 provenance 一致 | 前端回归通过；根测试唯一失败为 Windows `core.autocrlf` 工作树换行误报，非代码/运行时错误 | `reports/sessions/s-integration-final-20260903.md`、`reports/s-progress-restore-20260903/REPORT.md` | 2026-12-31 |
| E-INTEGRATION-002 | 2026-09-03 18:10 | Git merge/cherry-pick；线上浏览器控制 API 点击、布局、独立滚动；`/api/health`；静态资源请求 | Git/浏览器/HTTP 均成功；控制台 error/warning 0 | `dev` / `24da1d70`；CSS `f22e390038ea87ff4710bb3235db106d0f9d8e3513bfcf3a4782ffd2a3a18a8c`；release `20260903173855` | 后端与右栏提交完整集成；上传菜单、右栏满高/滚动、移动抽屉和问答关键路径符合预期 | `reports/s-progress-restore-20260903/REPORT.md`、`browser-evidence.json`、七张截图、线上 URL | 2026-12-31 |
| E-INTEGRATION-003 | 2026-09-03 18:20 | 两次 `git push neworigin dev`；`git ls-remote --heads neworigin dev`；项目管理 `--validate`；最终线上状态复核 | 全部退出 0；远端 `dev=ee8541cc`；账本 `valid=true` | `dev` / `ee8541cc`（交付基线 `d48ce911`）；release `20260903173855`；CSS `f22e390038ea87ff4710bb3235db106d0f9d8e3513bfcf3a4782ffd2a3a18a8c` | 集成提交和独立 session 报告已推送；旧 claim/DEPLOY_LOCK 已释放；线上关键路径保持通过 | `reports/sessions/s-integration-final-20260903.md`、`.project-to-act/`、`reports/s-progress-restore-20260903/`、远端分支 | 2026-12-31 |
| E-PMCV2-STREAM-001 | 2026-09-03 | 本地后端/前端测试、W-H128 SOP 流式候选、GB10 Tailscale release/API/静态资源验证 | 0 | release `20260903201200`；run `run-67f945452c254e37a3a3d991749f1d72` | `STREAMING_FLOW` 15 道工序展开 180 条子批次，生成 WIP 数量段与工序衔接边，validator PASS，停在人工发布 Gate；39092 前端包含批次甘特逻辑 | `docs/pmc-v2-streaming/wh128-15ops-gantt.png`、`docs/pmc-v2-streaming/gb10-wh128-15ops-r3-run.json` | 2026-09-10 |
| E-0904-WECHAT-AUDIT-001 | 2026-09-04 | `find` 目录/扩展名统计；ZIP/RAR/7z 归档清单；bundled Python/openpyxl 表头读取；`soffice` 临时转换旧 `.xls`；账本 `--validate`；`.venv/bin/python -m pytest -q`；`cd frontend && npm test -- --run`；`cd frontend && npm run build` | 全部退出 0 | `dev` / 本次审计提交 | 覆盖个人微信 `msg/file` 1,078、`msg/attach` 约 30,500、`~/Downloads` 约 43,054 和企业微信邮件缓存；确认真实制造资料存在，生产人员/技能/工位绑定、生产日历、当前 WIP、MES 事件仍未形成可放行实体；后端 58、前端 4 测试通过并成功构建 | `docs/WECHAT_DOWNLOAD_AUDIT_20260904.md`、`docs/DATA_REQUIREMENTS_0903.md` | 2026-09-11 |

## Gate 记录

| Gate ID | 日期 | Gate | 对象 | 结果 | 证据 ID | 豁免与确认人 |
|---|---|---|---|---|---|---|
| G-001 | 2026-09-03 | 协作治理 Gate | 多 session 规则 | 通过 | E-SESSION-001 | zhb |
| G-002 | 2026-09-03 | 前后端集成与线上关键路径 Gate | `dev` / GB10 39092 | 通过（关键路径；完整 pytest 环境性缺口已记录） | E-INTEGRATION-003 | zhb |

## 验收记录

按时间倒序追加：日期、检查范围、证据 ID、结果、遗留问题和结论。失败、跳过与过期证据也必须如实记录。

- 2026-09-03：检查治理文件、分支策略、claim 模板和配置校验；证据 `E-SESSION-001`；结论：可开始并行 session，业务验收仍按各任务单独记录。
- 2026-09-03：检查集成提交、前端顺序回归、线上 `39092` 多视口点击/滚动、静态资源和 `/api/health`；证据 `E-INTEGRATION-002`、`E-REGRESSION-002`；结论：关键路径通过；CLI Playwright/OCR 与 Windows provenance 换行测试缺口已如实保留。
- 2026-09-03：确认 `dev` 已推送到 `neworigin/dev`，账本校验通过，旧 session claim/发布锁已释放；证据 `E-INTEGRATION-003`；结论：本次集成交付完成，后续只需按独立任务处理环境性 EOL/工具缺口。
- 2026-09-03：复核 PMC v2 流式 WIP 与 GB10 39092 运行结果；证据 `E-PMCV2-STREAM-001`；结论：十五道工序和批次级 WIP 已生成，保留人工发布 Gate。
- 2026-09-04：完成微信/企业微信及本机下载目录全量只读复核；证据 `E-0904-WECHAT-AUDIT-001`；结论：真实订单、BOM、库存、采购入库、供应商、设备/模具、SOP/IE 时间和历史排产存在，但不能替代生产人员、技能绑定、日历、当前 WIP 与执行回传；真实 PMC 继续保持生产阻断。
