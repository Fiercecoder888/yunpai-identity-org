# Tool、MCP 与 API 接口

## Tool 注册

总 Agent 从包内 `manifests/m0.json` 至 `m5.json` 加载原源码合同，共 114 个：M0 27、M1 17、M2 7、M3 17、M4 26、M5 20。每项包含模块、描述、HTTP method/path/timeout、输入/输出 JSON Schema、同步/异步模式以及 Agent 端点（如适用）。

完整逐项说明见 `M0_M5_FUNCTION_REFERENCE.md`；权威机器合同位于 `registry/tool-manifests/`。

`GET /tools` 的每项包含 `bound`：

- `true`：当前进程已有本地或 HTTP handler，可执行。
- `false`：合同已注册但 transport 未绑定；调用失败关闭，不返回模拟成功。

`GET /skills` 返回 8 个已注册高阶 Skill。每个 Skill 除名称和描述外还声明其可调用的 Tool 白名单；Skill 调用仍经过同一 `ToolRegistry` 的输入/输出 Schema 校验。当前包括业务资料识别、M0 数据基础、M1 文档解析、M2 BOM/SOP、M3 物料计划、M4 采购、M5 PMC 和 M5 PMC 生命周期。

## HTTP transport

设置：

```env
YUNPAI_TOOL_TRANSPORT=http
M0_URL=http://m0:8010
M1_URL=http://m1:8080
M2_URL=http://m2:8765
M3_URL=http://m3:8000
M4_URL=http://m4:8000
M5_URL=http://m5-api:8000
```

`ToolRegistry.bind_http()` 执行以下转换：

1. 校验输入 JSON Schema。
2. 替换并 URL 编码 `{path_parameter}`。
3. GET/DELETE 使用 query；普通写请求使用 JSON。
4. `content_b64` 文件对象转换为 multipart。
5. 传播 `X-Yunpai-Task-ID`、`X-Yunpai-Tenant-ID` 和 `Idempotency-Key`。
6. 使用工具自有 timeout，校验响应 JSON Schema。

认证头通过 `headers_by_module` 注入；密钥不写入 manifest。

## MCP

`yunpai-mcp` 提供 JSON-RPC stdio：

- `initialize`：返回 server 信息和 tools capability。
- `tools/list`：返回 114 个工具的 `name/description/inputSchema/annotations`。
- `tools/call`：执行已绑定工具，返回文本 content、structuredContent 和 `isError`。

未绑定、Schema 错误和模块错误返回 `isError=true`，错误码 `TOOL_CALL_FAILED`。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 服务、注册工具数、已绑定工具数和 Skill 数 |
| GET | `/tools?module=m5` | 能力目录及绑定状态 |
| POST | `/runs` | 创建并运行到完成、失败或 Gate |
| POST | `/runs/upload` | 上传 XLSX/订单文件，解析后进入总 Agent；支持 `message/tenant_id/workflow` 查询参数 |
| POST | `/runs/stream` | 以 NDJSON 流式创建运行，实时返回 Agent、工具、审查和 Gate 事件 |
| GET | `/runs` | 按租户列出持久化运行 |
| GET | `/runs/{run_id}` | 获取完整 RunState |
| POST | `/runs/{run_id}/resume` | 带 `decision/supplement/actor` 恢复 Gate |
| POST | `/runs/{run_id}/resume/stream` | 以 NDJSON 流式恢复 Gate 并继续运行 |

`POST /runs` 可直接提交业务请求，也可使用 `{ "request": {...}, "tenant_id": "..." }` 包装。未知工具返回 400；不存在的 run 返回 404；对非暂停状态执行 resume 返回 409。

上传接口会在持久化状态中保留原文件供恢复，但 API 和流式快照中的 `content_b64` 统一替换为 `[omitted]`。

恢复 decision：`approve|allow|continue` 接受当前 observation，`retry` 合并 supplement 后重跑当前步骤，`reject|stop` 终止并保留审计。

流式接口事件包含 `run_start`、`assistant_delta`、`step_start`、`step_result`、`gate_opened`、`state_snapshot`、`run_done` 和 `run_error`。快照会隐藏附件 `content_b64`，但保留文件名、类型和运行状态；`run_done` 的 `state.status` 仍可能是 `waiting_human`，表示运行暂停等待下一次 resume。

自由路径中的写工具在 Worker 调用前打开 `authorization` Gate。批准后同一计划步骤只执行一次；拒绝时不创建步骤 observation 或工具输出。MCP 的 `tools/call` 是底层工具 transport，不代替总 Agent 的 Gate，业务会话应通过 `/runs` 调用总 Agent。

## RunState

关键字段：`run_id`、`task_id`、`tenant_id`、`route`、`workflow_id/version`、`plan`、`next_step_index`、`current_result`、`outputs`、`evidence`、`steps`、`pending_gate`、`approvals`、`authorized_steps`、`errors`、`trace`。同一运行不得替换根 TaskID。
