# 项目验收

> 执行测试、交付或声明完成前必须读取本文件。没有新鲜证据时不得写成通过。
> 不粘贴密钥、完整个人信息、原始顾客对话或未脱敏工具输出。

## 当前验收结论

- 结论：关键业务路径、右栏响应式布局和线上发布验收通过；Windows provenance 字节哈希测试仍需在统一 EOL/CI 环境复核
- 验收范围：前后端集成提交、右栏视觉/高度/滚动、关键页面点击、health 和前端回归
- 最后检查：2026-09-03 18:10 +08:00
- 遗留问题：本机 CLI Playwright 缺 Chromium；中文 OCR 引擎未安装；两项均已用真实浏览器控制 API、截图和同 DOM 可读文本证据替代并如实记录

## 验收标准

| 标准 ID | 标准 | 状态 | 验证方法 | 证据 ID |
|---|---|---|---|---|
| A-001 | 项目目标达到可验证结果 | 通过（关键路径） | 对照 `PROJECT_OVERVIEW.md`、线上浏览器证据 | E-INTEGRATION-002 |
| A-002 | 范围内功能满足完成条件 | 通过（关键路径） | 前端回归、线上多视口点击/滚动和截图报告 | E-INTEGRATION-002 |
| A-003 | 项目约定的测试全部通过 | 部分通过 | 前端 typecheck/build/test 通过；Windows 根 pytest 47 通过、1 个 provenance 换行误报；Git blob hash 一致 | E-REGRESSION-002 |
| A-004 | 阻塞与重大遗留问题已处理 | 部分通过 | 线上无当前错误；环境性 provenance 测试缺口待统一 EOL/CI 复核 | E-INTEGRATION-002 |
| A-005 | 多 session 有唯一分支/worktree、路径认领和发布锁规则 | 通过 | 检查 `docs/SESSION_COLLABORATION_RULES.md`、claims 模板并运行 `--validate` | E-SESSION-001 |
| A-006 | 每个 session 持续维护独立实时修改报告 | 通过 | 检查实时报告规则和 `reports/sessions/README.md` 模板 | E-SESSION-001 |

## 证据索引

| 证据 ID | 时间 | 方法或命令 | 退出状态 | 版本或文件哈希 | 结果摘要 | 证据位置 | 有效期 |
|---|---|---|---|---|---|---|---|
| E-SESSION-001 | 2026-09-03 | 初始化脚本 `--validate`；人工审阅规则文件 | 0 | `dev` / `4b9c1aa1` | 治理账本有效，规则与 claim 模板已落盘 | `.project-to-act/`、`docs/SESSION_COLLABORATION_RULES.md`、`.coordination/claims/README.md` | 2026-12-31 |
| E-REGRESSION-002 | 2026-09-03 18:09 | `npm run typecheck`; `npm run build`; `npm test -- --run --maxWorkers=1 --no-file-parallelism`; root `pytest -q` | 前三项 0；root pytest 1（47 passed, 1 EOL hash mismatch） | `dev` / `24da1d70`；Git blob manifest hash 与 provenance 一致 | 前端回归通过；根测试唯一失败为 Windows `core.autocrlf` 工作树换行误报，非代码/运行时错误 | `reports/sessions/s-integration-final-20260903.md`、`reports/s-progress-restore-20260903/REPORT.md` | 2026-12-31 |
| E-INTEGRATION-002 | 2026-09-03 18:10 | Git merge/cherry-pick；线上浏览器控制 API 点击、布局、独立滚动；`/api/health`；静态资源请求 | Git/浏览器/HTTP 均成功；控制台 error/warning 0 | `dev` / `24da1d70`；CSS `f22e390038ea87ff4710bb3235db106d0f9d8e3513bfcf3a4782ffd2a3a18a8c`；release `20260903173855` | 后端与右栏提交完整集成；上传菜单、右栏满高/滚动、移动抽屉和问答关键路径符合预期 | `reports/s-progress-restore-20260903/REPORT.md`、`browser-evidence.json`、七张截图、线上 URL | 2026-12-31 |

## Gate 记录

| Gate ID | 日期 | Gate | 对象 | 结果 | 证据 ID | 豁免与确认人 |
|---|---|---|---|---|---|---|
| G-001 | 2026-09-03 | 协作治理 Gate | 多 session 规则 | 通过 | E-SESSION-001 | zhb |
| G-002 | 2026-09-03 | 前后端集成与线上关键路径 Gate | `dev` / GB10 39092 | 通过（关键路径；完整 pytest 环境性缺口已记录） | E-INTEGRATION-002 | zhb |

## 验收记录

按时间倒序追加：日期、检查范围、证据 ID、结果、遗留问题和结论。失败、跳过与过期证据也必须如实记录。

- 2026-09-03：检查治理文件、分支策略、claim 模板和配置校验；证据 `E-SESSION-001`；结论：可开始并行 session，业务验收仍按各任务单独记录。
- 2026-09-03：检查集成提交、前端顺序回归、线上 `39092` 多视口点击/滚动、静态资源和 `/api/health`；证据 `E-INTEGRATION-002`、`E-REGRESSION-002`；结论：关键路径通过；CLI Playwright/OCR 与 Windows provenance 换行测试缺口已如实保留。
