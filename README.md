# Yunpai LangGraph（云湃工业一体机 · 统一源码）

云湃工业一体机的 LangGraph 编排项目。总规划 Agent 负责对话和计划，Worker Agent 调用
M0-M5 工具，审查 Agent 执行业务门禁；支持版本化 M0→M5 工作流和非工作流自由 ReAct 路径。

本仓库为**统一源码基线**：后端 `src/yunpai_langgraph` + 正式前端 `frontend-yunpaizhisuan`
（React/Vite/antd，独立团队开发）。历史旧前端已移除。

## 已实现

- M0-M5 的 Tool 合同全部注册到总 Agent，并通过 MCP 暴露。
- 主链工具提供本地确定性实现（订单解析、工程校验、缺料计算、M4 采购、M5 PMC v2 排程求解）。
- LangGraph 拓扑：`planner -> worker -> reviewer -> worker|END`。
- M0 candidate、M1 低置信、M2 工程批准、M4 供应商缺口、M5 发布 Gate。
- `run_id`/根 `task_id`、步骤、证据、审批和 ReAct trace。
- SQLite 运行持久化，以及 FastAPI 创建、查询、列表、恢复和工具目录接口。
- MCP JSON-RPC stdio：`tools/list`、`tools/call`。
- Qwen 规划路由：记录模型意图、route、置信度、延迟和回退原因；未配置时回退确定性路由。
- `/runs/upload` 支持 XLSX 订单上传和订单字段提取。
- `business-data-identification` Skill 支持外置业务资料目录/上传文件识别，写入
  `runtime/yunpai-business-catalog.sqlite` 候选库；`GET /skills` 返回 Skill 目录。

## 安装与测试

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev,parsers,vision]'
pytest -q          # 420 passed, 2 skipped
```

## 启动

```bash
# 后端（默认 127.0.0.1:9000，本地优先：M0-M5 全部本地固定算法）
bash ops/deploy/start_backend.sh

# 前端（先构建，再由 static_proxy 服务 dist/ 并反代 /api/*）
cd frontend-yunpaizhisuan && npm install && npm run build && cd ..
bash ops/deploy/start_frontend.sh   # 默认 0.0.0.0:8000
```

部署细节与环境变量表见 [ops/deploy/README.md](ops/deploy/README.md)。

启动 MCP：

```bash
yunpai-mcp
```

LangGraph Studio/CLI 使用根目录 [langgraph.json](langgraph.json)，graph ID 为 `yunpai`。

## 运行模式

默认 `YUNPAI_TOOL_TRANSPORT=local`：全部模块走本地 Tool handler，不依赖外部服务。
设置 `YUNPAI_TOOL_TRANSPORT=http` 后，`YUNPAI_HTTP_MODULES` 列出的模块按 manifest 绑定
外部 HTTP 服务（如独立 M1 文档解析服务），未列出模块保持本地。HTTP Adapter 按 manifest
发送 query、JSON 或 multipart，传播 TaskID、租户、幂等键、revision/checksum、trace 和
操作者信息，并在发送前检查必需认证头。

需要 Bearer 认证的 M3/M4 环境可设置 `M3_API_KEY`、`M4_API_KEY`，或通过
`M3_AUTHORIZATION`、`M4_AUTHORIZATION` 提供完整 Authorization 值。凭据只放运行环境，
不写入 manifest 或仓库。

规划模型：设置 `QWEN_API_KEY`/`QWEN_BASE_URL`/`QWEN_MODEL` 后 Planner 调用 Qwen；
未配置时自动使用确定性路由并明确记录 `not_configured`。

## 前端对接契约（yunpaizhisuan-FE）

- 原始文件上传必须发 `workflow: "m1_m5_document_to_plan"`（`m0_m5` 是订单已入库后的
  直接排程入口，用错会导致 M1 `ingest_document` 415）。
- 前端 local 模式（`VITE_LOCAL_LANGGRAPH=true`）走 `POST /runs/stream` 与
  `POST /runs/{id}/resume/stream`，事件协议为 NDJSON
  （`run_start/assistant_delta/step_start/step_result/gate_opened/run_error/run_done`）。
- `documents` 附件数组每项必须带 `kind: "order"`；其余字段
  `filename/content_type/content_b64`。

开发规范见 [AGENTS.md](AGENTS.md)。
