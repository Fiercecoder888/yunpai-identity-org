# 功能测试报告

测试日期：2026-09-03。环境：项目 `.venv`，Python 3.14.5，pytest 9.1.1。

## 自动化测试

执行命令：

```bash
.venv/bin/python -m pytest -q
```

最终结果：`40 passed`。

| 测试域 | 验证内容 |
|---|---|
| Registry/合同 | 114 个工具及模块计数；全局重名；完整 HTTP metadata；绑定状态；根目录/包内副本一致；提取 SHA-256 一致 |
| LangGraph | planner/worker/reviewer 三节点；编译图执行；workflow/free/chat 路由；ReAct trace；未绑定失败关闭 |
| 主工作流 | M0→M5 七步、TaskID 传播、缺料计算、采购桥接、makespan、候选/工程/采购/发布 Gate、无缺料分支 |
| Gate | 批准、补充重试、superseded、拒绝终止、低置信恢复；自由写工具批准前零调用且批准后恰好一次 |
| Persistence/API | SQLite 跨图实例恢复、租户过滤、HTTP 创建/列表/查询/连续恢复至完成 |
| LLM/上传 | Qwen JSON 路由解析、模型失败回退、意图/路由记录、XLSX 订单字段提取、上传端点脱敏 |
| HTTP adapter | TaskID/tenant 头、GET query、模块 URL、base64 文件转 multipart |
| MCP | 114 项 list、原合同调用、未绑定协议错误、stdio initialize 往返 |
| Workflow | ID/版本、七步顺序、依赖有效性、根目录/包内副本一致 |

## 附加验收

| 检查 | 结果 |
|---|---|
| 七个 Skill 的官方 `quick_validate.py` | 全部通过 |
| `compileall` | 全部通过 |
| wheel 构建及安装内容检查 | 通过；包含 6 个 manifest 和 1 个 workflow |
| 原源码 manifest 对照 | M0-M5 六份均与归档内 Orchestrator declaration 的 SHA-256 完全相同 |
| FastAPI 冒烟 | `/health` 报告 114/7；`/tools?module=m5` 返回 20；完整 no-shortage 运行经三次 Gate 后完成并发布 M5 |
| SQLite 冒烟 | API 创建的 run 可从新 repository 实例读取，步骤、审批和状态完整 |
| 真实订单端到端 | GB10 Qwen3.6 35B 返回 workflow/0.95；桐曦订单解析 8 行、47,000 PCS、175,200.00，M0/M1 完成后按缺 BOM 在 M2 data Gate 停止 |

## 未包含的生产验收

真实 PostgreSQL/Neo4j/Redis、OCR/VLM、OR-Tools、供应商/邮件、MES、生产认证、浏览器 UI、迁移、并发容量与故障注入未运行，因为这些服务和凭据不属于当前独立交付环境。HTTP adapter、原合同和失败关闭行为已验证；上线前必须对已部署的原 M0-M5 服务执行联调和现场验收。

## GB10 部署验收（2026-09-03）

| 检查 | 结果 |
|---|---|
| 交接包 SHA-256 | 见 `dist/yunpai-langgraph-handoff-20260903.sha256`（包外置校验，避免自引用） |
| 迁移前后 SQLite 基线哈希 | 两份数据库均完全一致，`integrity_check=ok` |
| GB10 `/health` | 114 registered tools / 7 bound tools，Qwen configured=true |
| GB10 真实订单上传 | Qwen `ok`，意图“识别并落库业务资料”，`free` 路由，Skill `business-data-identification` |
| Gate 恢复 | candidate Gate allow 后 `completed`，trace 含 `gate.decided`、`run.completed` |
| 前端 | 构建通过；`http://192.168.110.19:39092/` 可返回 `index.html` |
| 前端单测 | Vitest `2 files / 4 tests passed` |

## 39092 M3 回归（2026-09-03）

使用前端同路径的 base64 附件请求（不提供预解析 document）复现并验证：M1 自动提取订单字段，M3 对 nullable 数值安全计算，完整 M0→M5 Gate 流程完成，错误列表为空。
