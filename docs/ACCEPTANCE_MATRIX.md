# 需求验收矩阵

| 用户要求 | 实现 | 验收证据 |
|---|---|---|
| 阅读文档包和代码包 | 产品结论、模块边界和来源哈希 | `PRODUCT_AND_FUNCTION_ARCHITECTURE.md`、`registry/SOURCE_PROVENANCE.json` |
| 提取 M0-M5 主要功能 | 原始 114 个合同无损提取 | `registry/tool-manifests/`、manifest 哈希测试 |
| 封装为 Skill | M0-M5 六个模块 Skill 和 Orchestrator Skill | `skills/*/SKILL.md`、官方 `quick_validate.py` |
| 封装为 Tool | 全局 `ToolRegistry`、Schema、绑定状态、HTTP adapter | `registry.py`、注册表与 adapter 测试 |
| 封装为 MCP | JSON-RPC stdio 的 initialize/list/call | `mcp.py`、MCP 单元和 stdio 往返测试 |
| 重构为 LangGraph | 可编译的三节点 StateGraph 和 Studio 导出 | `graph.py`、`studio.py`、`langgraph.json`、图节点测试 |
| 总规划/Worker/审查 Agent | 三个独立职责类和节点 | `agents.py`、ReAct trace 集成测试 |
| M0-M5 工作流 | 版本化七步依赖图及桥接 | `workflows/m0_m5.json`、工作流合同测试 |
| 非工作流自由执行 | 单/多工具自由计划，读直达、写前置授权 | 自由路径、未绑定失败、授权零调用测试 |
| 类 ReAct 对话路由 | workflow/free/chat 分流和 thought/action/observation/review | graph 集成测试与 trace 断言 |
| 注册进总 Agent | 114 个能力由 Planner 可见，Worker 只经同一注册表执行 | 工具计数、目录、自由工具测试 |
| 可恢复人工 Gate | SQLite 持久化、审批/补充/拒绝、跨实例恢复 | repository 与 API 测试 |
| 完整功能测试和记录 | 自动化、打包、Skill、HTTP 冒烟及边界声明 | `TEST_REPORT.md`、`DEVELOPMENT_RECORD.md` |

“完成”指本次 LangGraph 编排项目及其本地合同实现通过验收。依赖外部生产服务的 OCR、数据库、求解器、邮件和 MES 行为在报告中明确列为生产联调项，不以模拟结果冒充现场验收。
