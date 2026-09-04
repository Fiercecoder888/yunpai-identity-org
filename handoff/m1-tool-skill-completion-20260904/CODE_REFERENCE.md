# 代码参考索引

## 1. 当前 Yunpai LangGraph

仓库根：`/Users/murkydoubloon45/Desktop/yunpaigragh`

- Tool 合同：`registry/tool-manifests/m1.json`
- 运行时 Manifest：`src/yunpai_langgraph/manifests/m1.json`
- Skill 文档：`skills/m1/SKILL.md`、`skills/m1/references/tools.md`
- Registry/HTTP：`src/yunpai_langgraph/registry.py`
- Tool/Skill 类型：`src/yunpai_langgraph/contracts.py`、`src/yunpai_langgraph/skills.py`
- 本地兼容 handler：`src/yunpai_langgraph/workers.py::m1_parse` 和 `HANDLERS`
- Graph payload：`src/yunpai_langgraph/graph.py::_payload_for`
- XLSX 兼容解析：`src/yunpai_langgraph/order_workbook.py`
- Agent 路由/Gate：`src/yunpai_langgraph/agents.py`
- MCP/API：`src/yunpai_langgraph/mcp_server.py`、`src/yunpai_langgraph/api.py`
- GB10 启动：`ops/gb10/start_backend.sh`
- 当前测试：`tests/test_registry.py`、`test_http_adapter.py`、`test_business_skill.py`、`test_graph.py`、`test_api.py`、`test_mcp.py`、`test_order_workbook.py`

必须从执行时最新 `origin/main` 读取以上文件。资料包中的当前源码只是生成时快照。

## 2. T8 M1 完整历史实现

源目录：`/Users/murkydoubloon45/Desktop/yunpai/yunpai-t8-extract-panel/m1`

核心入口：

- `src/m1/api/main.py::create_app`
- `src/m1/api/ingest_routes.py`
- `src/m1/api/task_routes.py`
- `src/m1/api/review_routes.py`
- `src/m1/api/knowledge_routes.py`
- `src/m1/api/contracts.py`
- `src/m1/api/route_support.py`

解析与任务：

- `src/m1/state.py`
- `src/m1/workflow/engine.py`
- `src/m1/workflow/document_pipeline.py`
- `src/m1/workflow/review.py`
- `src/m1/workflow/persistence.py`
- `src/m1/workflow/task_store_migrations.py`
- `src/m1/ingest/batch.py`
- `src/m1/ingest/batch_status.py`
- `src/m1/ingest/batch_finalization.py`
- `src/m1/documents/`、`src/m1/parsers/`、`src/m1/extractors/`

导出与报告：

- `src/m1/order_export.py`
- `src/m1/reports.py`
- `src/m1/replication_report.py`

知识系统：

- `src/m1/knowledge/runtime.py`
- `src/m1/knowledge/persistence.py`
- `src/m1/knowledge/document_repository.py`
- `src/m1/knowledge/entity_repository.py`
- `src/m1/knowledge/retrieval_store.py`
- `src/m1/knowledge/review_store.py`
- `src/m1/knowledge/projection_repository.py`
- `src/m1/knowledge/stats_repository.py`
- `src/m1/knowledge/outbox_repository.py`
- `src/m1/knowledge/outbox_delivery.py`
- `src/m1/knowledge/sinks.py`
- `src/m1/knowledge/migrations/`

部署与依赖：

- `README.md`、`pyproject.toml`、`uv.lock`
- `Dockerfile`、`docker-compose.yml`
- `deploy/compose.runtime.yml`、`compose.build.yml`、`compose.dev.yml`
- `.env.example` 只能作为变量说明，禁止复制任何真实 `.env`。

## 3. yunpai0902 规则参考

源目录：`/Users/murkydoubloon45/Desktop/yunpai0902`

- `services/m1/provider.py`：CSV/PDF 订单候选、无隐式默认值、字段证据、候选不自动发布。
- `services/m1/sop_parser.py`：SOP PDF 候选、页/区域证据、缺标准工时阻断、幂等候选提交。
- `tests/m1/test_order_csv.py`
- `tests/m1/test_order_pdf.py`
- `tests/m1/test_sop_parser.py`

0902 代码不是完整 M1 服务，不能替代 T8 API、TaskStore、审核和知识系统。

## 4. 已知合同差异

- T8 M1 使用 `X-Tenant-ID`、`X-Actor-ID`、`X-Actor-Roles`；当前 Registry 主要发送 `X-Yunpai-Tenant-ID`。
- 当前 Manifest 比 T8 `.well-known/tool.json` 增加 `document.order_type`。
- 当前 `search_m1_orders` 增加 `interface/length/color/connector/conductor/od` 过滤。
- T8 `/ingest/sync` 可能返回 HTTP 202 和 `poll_url`；当前 Tool 输出验证需要显式 pending 处理。
- T8 导出/报告包含文件响应和下载链接；Tool Adapter 必须选择 JSON 元数据接口，不直接把任意文件路径交给 Agent。
