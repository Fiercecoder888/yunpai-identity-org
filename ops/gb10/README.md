# GB10 deployment

The deployment uses the existing GB10 Python 3.12 virtual environment at
`/home/wjc/yunpai0902-gb10/venv` and does not modify the frozen M0-M5 stacks.
The API listens on `127.0.0.1:9000`; `static_proxy.py` serves the built frontend
and proxies `/api/*` on `0.0.0.0:39092`. Isolated acceptance releases use
independent ports (backend `9002`, proxy `39094`) and their own SQLite runtime,
never the formal `39092`/`current`.

## 模型/Qwen 端点合同（T2）

- GB10 的 OpenAI-compatible Qwen 代理在 **`18085`**（本机 `http://127.0.0.1:18085/v1`，
  容器内 `http://gb10:18085/v1`），模型
  `qwen3.6-35b-a3b-fp8-gpu0-200k`；业务应用不得绕过 `18085` 直连 vLLM `18095`。
- Planner 路由（本仓库）经 `QWEN_BASE_URL` 使用该代理；`start_backend.sh` 启动时
  校验端点并打印脱敏地址，**严禁** `127.0.0.1:9`、`8081`、`11434`（本地 ollama）
  冒充模型端点。
- M2 冻结服务自己的 `/api/health` 用 `M2_MODEL_BASE_URL`（同 `18085` 代理）做模型
  检查。历史隔离 run（`run-5b4eeb48…`）的 M2 `/api/health` 曾报告
  `127.0.0.1:9` 不可达：这是 M2 启动环境未注入可达端点所致（M2 默认
  `8081/11434` 也不是 GB10 代理）。修复方式：隔离 release 启动 M2 时显式注入

  ```bash
  export M2_MODEL_BASE_URL=http://127.0.0.1:18085/v1   # GB10 本机
  export M2_MODEL_NAME=qwen3.6-35b-a3b-fp8-gpu0-200k
  ```

  端点不可达时 M2 必须如实报 `unavailable/degraded`，编排器把 M2 工程工具
  `HTTP_UNAVAILABLE/HTTP_TIMEOUT` 映射成可恢复 `BLOCKED_INPUT` 数据 Gate，
  **绝不伪造模型成功**。在 M2 冻结服务侧修补前，本仓库只改编排器模板/文档；
  对冻结栈的补丁建议单独提交，不改 `/home/wjc/yunpai-release-build-*/m1|m2`。

## M1 订单语义补充（T1）

- 真实订单 XLSX 由外部 M1 服务解析；当外部 M1 结果把文件判为订单但缺订单号或
  0 行时，编排器（`m1_http_adapter` → `order_semantics`）附加本地确定性候选
  `semantic_supplement`（表头/块事实/行级坐标证据 + SHA + parser 版本），
  **保留外部原结果并强制 review Gate**，绝不静默覆盖。
- 同一解析器（`order_parser_v2`/`order_semantics`）服务 business_catalog 的
  订单/库存判类与本地 fixture 重放；缺产品编码/交期等字段一律进入 review。

## 运行时数据库

Runtime databases are SQLite snapshots under `runtime/`:

- `yunpai-runs.sqlite`: run state, trace, Gate and agent intent/router records.
- `yunpai-business-catalog.sqlite`: business source files, document candidates and field observations.

Before replacing either database, stop writers, run `PRAGMA integrity_check`,
compare SHA-256 locally and remotely, and only then atomically rename the
staged file into the release directory. Raw files under the Mac external disk
are not copied by this deployment; the catalog retains their absolute path and
SHA-256 evidence so re-ingestion can detect drift when the source is mounted.
