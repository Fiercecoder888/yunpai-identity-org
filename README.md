# Yunpai LangGraph

测试、开发和 GB10 发布请统一阅读 [测试与开发手册](/Users/murkydoubloon45/Desktop/yunpaigragh/docs/TEST_DEVELOPER_HANDBOOK.md)。

云湃工业一体机的 LangGraph 编排项目。总规划 Agent 负责对话和计划，Worker Agent 调用 M0-M5 工具，审查 Agent 执行业务门禁；支持版本化 M0→M5 工作流和非工作流自由 ReAct 路径。

## 已实现

- 原源码 M0-M5 的 114 个 Tool 合同全部注册到总 Agent，并通过 MCP 暴露。
- 七个主链工具提供本地确定性实现；其余工具在 HTTP 模式绑定原模块服务。
- LangGraph 拓扑：`planner -> worker -> reviewer -> worker|END`。
- M0 candidate、M1 低置信、M2 工程批准、M4 供应商缺口、M5 发布 Gate。
- `run_id`/根 `task_id`、步骤、证据、审批和 ReAct trace。
- SQLite 运行持久化，以及 FastAPI 创建、查询、列表、恢复和工具目录接口。
- MCP JSON-RPC stdio：`tools/list`、`tools/call`。
- GB10 Qwen3.6 35B 规划路由：记录模型意图、route、置信度、延迟和回退原因。
- `/runs/upload` 支持 XLSX 订单上传和订单字段提取。
- `business-data-identification` Skill 支持外置业务资料目录/上传文件识别，写入 `runtime/yunpai-business-catalog.sqlite` 候选库；`GET /skills` 返回 Skill 目录。

## 安装与测试

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest -q
```

启动 API：

```bash
cp .env.example .env
uvicorn yunpai_langgraph.api:create_app --factory --port 9000
```

启动新的三栏 Agent 前端：

```bash
cd frontend
npm install
npm run dev
```

浏览器访问 `http://localhost:5173/`。前端通过 Vite `/api` 代理连接 LangGraph 的流式运行、Gate 恢复、运行查询和工具目录接口。

启动 MCP：

```bash
yunpai-mcp
```

LangGraph Studio/CLI 使用根目录 [langgraph.json](/Users/murkydoubloon45/Desktop/yunpaigragh/langgraph.json)，graph ID 为 `yunpai`。

## 运行模式

`YUNPAI_TOOL_TRANSPORT=local` 只绑定七个主链本地 handler，其他工具未绑定时失败关闭。生产连接设置 `YUNPAI_TOOL_TRANSPORT=http` 和 `M0_URL` 至 `M5_URL`；HTTP adapter 会按原 manifest 发送 query、JSON 或 multipart，并传播 TaskID 和租户。

规划模型配置见 [Qwen 意图与路由](/Users/murkydoubloon45/Desktop/yunpaigragh/docs/LLM_ROUTING.md)，设置 `QWEN_API_KEY` 后 Planner 会调用 GB10；未配置时自动使用确定性路由并明确记录 `not_configured`。

完整产品理解见 [产品与功能架构](/Users/murkydoubloon45/Desktop/yunpaigragh/docs/PRODUCT_AND_FUNCTION_ARCHITECTURE.md)，114 个接口见 [M0-M5 功能参考](/Users/murkydoubloon45/Desktop/yunpaigragh/docs/M0_M5_FUNCTION_REFERENCE.md)，测试证据见 [测试报告](/Users/murkydoubloon45/Desktop/yunpaigragh/docs/TEST_REPORT.md)。
