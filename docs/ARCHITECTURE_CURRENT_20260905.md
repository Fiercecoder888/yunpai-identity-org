# 云湃 39092 当前软件架构（修复后）

更新时间：2026-09-05  
验收实例：GB10 `100.121.179.111:39092`（Tailscale）  
当前 release：`20260905173500-m2-restore`  
GitLab `dev`：`01af6b5`

## 1. 总体架构

当前系统是一个“单总图 LangGraph + Skill 能力层 + Tool Registry 执行层 + 模块化 HTTP 服务”的架构。

```text
用户 / 前端
    ↓
39092 Static Proxy
    ↓
FastAPI Orchestrator
    ↓
YunpaiGraph / LangGraph StateGraph
    ├── PlannerAgent：理解目标、生成计划
    ├── WorkerAgent：执行 Skill 或 Tool
    └── ReviewerAgent：Gate、授权、审批、恢复
             ↓
      SkillRegistry / ToolRegistry
             ↓
      M0 / M1 / M2 / M3 / M4 / M5 HTTP Tool
             ↓
      PostgreSQL / 模块服务数据库 / M5 Repository
```

39092 不要求每个模块由独立 Compose 容器承载。真实边界以运行实例、Tool URL、服务身份、数据库连接和回读证据为准。

## 2. LangGraph 实际结构

代码入口：

```text
src/yunpai_langgraph/graph.py
```

图节点：

```text
START
  ↓
planner
  ↓
worker
  ↓
reviewer
  ├── waiting_human：打开人工 Gate
  ├── worker：Gate 通过后继续
  ├── failed：Tool/数据/能力错误
  └── END：完成或聊天响应
```

### PlannerAgent

负责：

- 读取用户目标；
- 接收 Qwen 或确定性意图提案；
- 形成 `route`、`plan`、`workflow_id`、`workflow_version`；
- 记录 `intent`、`route_decision` 和模型信息。

### WorkerAgent

负责：

- Skill 步骤调用 `SkillRegistry`；
- Tool 步骤调用 `ToolRegistry`；
- 传递 `run_id`、`task_id`、`tenant_id`；
- 保存输入摘要、输出摘要、步骤状态和 evidence。

### ReviewerAgent

负责：

- 执行前授权；
- 执行后确定性审查；
- 打开并恢复 data、candidate、engineering、procurement、schedule Gate；
- 校验 principal 权限；
- 阻止数据库、认证、schema 和服务不可用错误被人工审批绕过。

## 3. RunState 和持久化

核心状态类型：

```text
RunState
├── run_id / task_id / tenant_id
├── request / route / workflow
├── plan / next_step_index / current_step
├── outputs / steps / evidence / trace
├── pending_gate / approvals / authorized_steps
├── errors / response
└── intent / route_decision / model
```

状态生命周期：

```text
queued → running → waiting_human → running → completed
                         └──────────────→ failed
```

持久化分层：

| 数据 | 当前承载 |
|---|---|
| RunState、trace、Gate、步骤状态 | Orchestrator RunRepository / SQLite 运行库 |
| M0 canonical、候选、审批、ledger、outbox | 39092 M0 PostgreSQL backend |
| M2 BOM/SOP 工艺事实 | M2 Tool 服务及其 Store |
| M3 物料需求和齐套 | M3 Tool 服务及其数据提供器 |
| M4 采购建议/供应快照 | M4 Tool 服务 |
| M5 排程、资源、WIP、版本 | M5 Tool / M5 Repository |

## 4. Skill 架构

当前 39092 暴露 8 个 Skill：

```text
business-data-identification
yunpai-m0-data-foundation
yunpai-m1-document-parser
yunpai-m2-bom-sop
yunpai-m3-material-planning
yunpai-m4-procurement
yunpai-m5-pmc
yunpai-m5-pmc-lifecycle
```

Skill 负责：

- 高阶业务能力封装；
- Tool 白名单；
- 输入/输出整理；
- evidence 和版本信息；
- `next_actions`；
- 缺失和冲突结果汇总。

Skill 不应绕过 ToolRegistry 直接写生产数据库，也不应自行伪造 M1→M5 后续事实。

### 业务资料识别 Skill

`business-data-identification` 负责：

- 接收文件或目录；
- 识别文件类型和业务类别；
- 记录 SHA、字段观察和解析证据；
- 创建候选；
- 返回候选审核、canonical 发布、M1 解析等下一步建议。

它不应仅根据附件类型自动启动完整订单链路。

## 5. Tool Registry 架构

总 Tool 合同数：

```text
114
```

Tool Registry 负责：

- 加载 M0-M5 manifest；
- 校验 input/output schema；
- 绑定本地或 HTTP handler；
- 添加 module、capability、side effect、review gate；
- 统一返回 status、code、data、evidence、next_actions；
- 保留幂等和下游字段信息。

Goal 模式审计字段：

```json
{
  "execution_mode": "goal",
  "decision_source": "skill_tool_contract",
  "agent_route_mutation": false
}
```

列表型 Tool 保持原始数组兼容形状，字典型 Tool 使用统一结构化结果外壳。

## 6. 39092 当前真实运行状态

运行实例：

```text
release:
/home/wjc/yunpai-langgraph/releases/20260905173500-m2-restore

orchestrator:
127.0.0.1:9000

external:
100.121.179.111:39092
```

运行配置：

```text
transport=http
local_fixture=false
environment=sandbox
planner=Qwen qwen3.6-35b-a3b-fp8-gpu0-200k
```

当前 `/api/health`：

| 模块 | Tool 总数 | 已绑定 |
|---|---:|---:|
| M0 | 27 | 27 |
| M1 | 17 | 17 |
| M2 | 7 | 7 |
| M3 | 17 | 16 |
| M4 | 26 | 25 |
| M5 | 20 | 20 |
| 合计 | 114 | 112 |

本次修复结果：

```text
M2：从 1/7 恢复为 7/7
其他模块绑定数量保持不变
```

M2 当前全部绑定：

```text
run_bom_sop_workflow
search_m2_bom_history
generate_m2_bom_controlled
onboard_m2_bom_template
generate_m2_sop
list_m2_runs
get_m2_run
```

## 7. M0-M5 业务数据流

```text
真实文件
  ↓
M0 Skill/Tool：来源 SHA、分类、候选
  ↓
人工 candidate Gate
  ↓
M0 PostgreSQL canonical publish
  ↓
PostgreSQL readback
  ↓
M1：订单头/订单行/字段证据
  ↓
M2：BOM/SOP/route/IE 工时
  ↓
工程 Gate
  ↓
M3：库存来源、需求、齐套、缺料
  ↓
M4：采购建议或无缺料结果
  ↓
M5：设备、工装、人员、技能、日历、WIP、排程
  ↓
M5 发布与状态回读
```

人工批准只能改变业务 Gate 状态，不能覆盖：

```text
数据库不可用
schema 错误
认证失败
服务不可用
来源冲突
缺失权威事实
```

## 8. 当前边界和遗留问题

### 已确认

- 39092 orchestrator 正常运行；
- HTTP Tool transport 生效；
- local fixture=false；
- M0/M1/M2/M5 Tool 面完整；
- M2 7 个 Tool 已恢复绑定；
- 其他模块配置未被覆盖；
- 旧 release 保留，可回滚。

### 尚未等同于完整业务验收

- M3 仍有 1 个 Tool 未绑定；
- M4 仍有 1 个 Tool 未绑定；
- M2 服务 `/api/health` 报告其模型地址为 `127.0.0.1:9`，模型辅助能力不可用；
- M0 canonical PostgreSQL 真实写入/回读仍需用 W-H909 完整执行；
- M5 真实资源、人员技能、日历和 WIP 事实仍需现场核验；
- 当前 `environment=sandbox`，真实生产验收前需明确环境标识政策。

因此当前结论是：

```text
架构和 M2 Tool 绑定已修复；
39092 当前运行正常；
尚未据此宣称 W-H909 M0→M5 全链路验收通过。
```
