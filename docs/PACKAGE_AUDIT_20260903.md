# 当前版本打包审计（2026-09-03）

## 之前导出包检查

检查对象：`dist/yunpai-langgraph-handoff-20260903.tar.gz`。

该包已经包含后端 `src/yunpai_langgraph`、M0-M5 manifest、Skill 文档、测试、文档、运行样例数据和前端 `dist` 构建产物，核心运行功能可以覆盖；但它不是当前仓库的完整源码包，缺少：

- `frontend/src` 前端源码，以及 `vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、TypeScript 配置；
- 顶层 `registry/` 工具注册源文件；
- `scripts/` 数据导入和能力参考生成脚本；
- 顶层 `workflows/m0_m5.json`；
- `.gitignore` 等源码交付元文件。

因此旧包适合作为运行交接包，不适合作为当前版本的完整代码归档。

## 本次完整包覆盖

本次包覆盖当前目录中的：

- Python 后端、LangGraph graph、Agent、API、MCP、LLM 路由、repository、contracts、内置 manifest/workflow；
- React/Vite 前端源码、构建产物、依赖锁定文件和测试配置；
- `skills/` 下 M0-M5、业务资料识别和 orchestrator Skill 及工具参考；
- `registry/` 工具 manifest 与来源记录；
- `scripts/`、`ops/`、顶层 workflow、测试、README、架构/验收文档和截图；
- `runtime/` 中现有 SQLite、上传样例和 API 日志，便于复现当前验收状态。

## 有意排除

为避免把机器环境和缓存当作源码交付，包中排除 `frontend/node_modules`、`.venv`、`__pycache__`、`.pytest_cache`、Vite 临时缓存、以及已有压缩包本身；前端生产构建产物 `frontend/dist` 保留。

## 验证证据

- 后端：`.venv/bin/python -m pytest -q` -> `40 passed`；
- 前端：`npm test -- --run` -> `2 files / 4 tests passed`；
- 前端：`npm run build` -> Vite production build 成功。

