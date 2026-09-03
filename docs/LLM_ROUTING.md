# Qwen 意图与路由

## 配置

规划 Agent 使用 GB10 的 OpenAI-compatible Qwen3.6 35B 服务：

```env
QWEN_ROUTER_ENABLED=true
QWEN_BASE_URL=http://gb10:18085/v1
QWEN_MODEL=qwen3.6-35b-a3b-fp8-gpu0-200k
QWEN_API_KEY=<secret>
QWEN_TIMEOUT_S=45
```

密钥只从环境变量读取，不写入代码、manifest、日志或状态。HTTP 请求使用 `chat_template_kwargs.enable_thinking=false`、`temperature=0` 和 JSON response format，避免把思维过程当作路由结果。

## 模型职责

Qwen 只提出 `intent/route/tools/confidence/reason`，不直接执行工具。允许的 route 是：

| route | 含义 |
|---|---|
| `workflow` | 版本化 M0→M5 主链 |
| `free` | 一个或多个已注册 Tool |
| `chat` | 无业务副作用的解释性对话 |

Planner 会检查模型工具名是否存在于 114 项注册表。模型不可用、超时、非法 JSON、非法 route 或工具名无效时，使用原有确定性 Planner，并将 `route_decision.source` 标为 `deterministic_fallback`；显式 `workflow/tool/tools` 请求始终以用户显式选择为准。

## 状态记录

每个运行的 `RunState` 包含：

- `intent`: `name/confidence/source`，标记意图名称、置信度和来源。
- `route_decision`: 模型状态、模型原始提案或回退原因。
- `model`: provider、model、base_url、status、latency_ms，不含密钥。
- `trace`: `agent.model`、`agent.intent`、`agent.route` 以及标准 ReAct `thought/action/observation/review` 事件。

`GET /runs/{run_id}` 可以查看完整决策；文件正文只在服务端持久化状态中保留，API 响应会脱敏。

## 本次 GB10 验证

使用订单消息“请解析并校验这份采购备货订单，确认订单和物料后安排生产排程”调用真实模型，返回：

```json
{
  "intent": "解析采购订单并执行生产排程",
  "route": "workflow",
  "confidence": 0.95,
  "reason": "跨越 M0 到 M5 的完整业务主链"
}
```

随后本地 Planner 将 route 校验为 `workflow` 并加载 `m0_m5` 版本 `1.0.0`；Tool 选择以本地 manifest 和工作流定义为最终权威。
