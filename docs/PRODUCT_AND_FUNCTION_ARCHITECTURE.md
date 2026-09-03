# 云湃工业一体机产品与功能架构

## 1. 产品定义

云湃不是六个模块的菜单，而是面向制造业的证据治理型业务执行 Agent。用户提交目标、文件或业务对象后，系统在同一个 `run_id` 和根 `task_id` 下完成理解、规划、执行、校验、交付和审计。

核心资产是四个部分：统一编排、结构化事实、证据链、可恢复执行。语言模型可以理解意图和生成候选，但不能单独决定 canonical 发布、采购发送、库存变更或排程发布。

## 2. 从文档包和源码包得到的架构结论

| 结论 | 实现影响 |
|---|---|
| M0 是跨模块 canonical 事实源 | M1-M5 不能建立另一套正式产品/BOM/物料事实 |
| PostgreSQL 是业务权威，Neo4j/搜索是投影 | 图或向量结果必须回指 fact ID、revision、checksum 和来源 |
| 模块保持独立故障域 | 编排器通过 HTTP Tool/MCP 调用，不共享 ORM 或跨库 SQL |
| 正常路径自动继续，异常统一 Gate | 候选、低置信、缺供应商、缺资源和发布动作在同一状态模型暂停 |
| 模型做理解，代码做约束 | Schema、数量、不变量、权限、幂等和 CAS 由确定性代码负责 |
| 一项业务任务只有一个根 TaskID | 所有下游调用、候选、版本、Outbox 和审批原样传播 TaskID |

源码包的原 Orchestrator 已包含业务流和 114 个 M0-M5 工具声明，但同时存在通用 ReAct 兼容路径、确定性业务流、大量外部运行依赖和遗留工具。重构层因此不复制模块私有代码，而是把原始 `tool.json` 作为能力合同，将编排、路由、状态和 Gate 收敛到独立 LangGraph 项目。

## 3. 业务模块

| 模块 | 主要职责 | 事实边界 | 工具数 |
|---|---|---|---:|
| M0 | 多格式数据导入、候选审核、canonical 实体/版本/来源/证据、回滚和主数据查询 | 正式跨模块事实 | 27 |
| M1 | PDF/图片/表格/Office/CAD/归档解析、订单字段、任务、审核和报告 | 解析任务与 candidate | 17 |
| M2 | BOM 历史检索、受控 BOM、SOP、模板和制品 | 工程草稿、案例和产物 | 7 |
| M3 | BOM 展开、MRP、物料匹配、需求、缺料和齐套 | 库存/MRP/分配运行事实 | 17 |
| M4 | 采购建议、PO、人工审核、供应商回复、ETA、追踪和预警 | 采购执行事实 | 26 |
| M5 | PMC 排程、版本、重排、知识、消息、派工、报工和采购视图 | 排程和生产执行事实 | 20 |

每个工具的完整描述、HTTP 和 JSON Schema 见 `M0_M5_FUNCTION_REFERENCE.md`；机器合同见 `registry/tool-manifests/`。

## 4. Agent 架构

```text
START
  |
  v
Planner Agent
  |  识别 workflow / free / chat，生成版本化步骤计划
  v
Worker Agent <--------------------------------+
  |  只调用 ToolRegistry，记录 action/observation |
  v                                               |
Reviewer Agent                                    |
  |-- pass 且有下一步 -----------------------------+
  |-- Gate ------------------------------> END(waiting_human)
  |-- fail ------------------------------> END(failed)
  `-- pass 且结束 ------------------------> END(completed)
```

这三个角色是实际 LangGraph 节点，不只是类名。`react.thought/action/observation/review` 事件写入 trace；自由路径允许用户显式选择任意已注册工具或工具列表。未绑定本地 handler/HTTP transport 的工具失败关闭，不返回伪成功。

Planner 可通过 GB10 上的 Qwen3.6 35B 提出意图和 route；模型只负责提案，最终 route、工具名和工作流版本由本地注册表/工作流合同校验。模型不可用时保留确定性回退，并在 `RunState.intent`、`route_decision`、`model` 和 trace 中标注来源。

## 5. M0-M5 主工作流

版本化定义位于 `workflows/m0_m5.json`：

1. `data_import_run`：形成 M0 candidate 和来源证据，打开 candidate Gate。
2. `data_import_commit`：批准后发布 canonical revision 和 ledger。
3. `ingest_document`：形成 `m1.document.v2`；低置信或缺字段打开 review Gate。
4. `run_bom_sop_workflow`：形成 BOM/SOP draft，打开 engineering Gate。
5. `run_m3_procurement_requirements`：计算需求和缺料；缺权威输入失败关闭。
6. `import_m4_purchase_suggestions_json`：桥接缺料；供应商/交期缺失打开 procurement Gate。
7. `solve_scheduling`：形成并验证排程 draft，打开 apply Gate；批准后生命周期为 `released`。

无缺料时 M4 Gate 自动跳过；需要补充数据时 `retry + supplement` 重跑当前步骤，原步骤标记 `superseded` 并保留审计记录。

## 6. 状态与恢复

`RunState` 包含：身份、租户、工作流版本、计划、下一步骤、当前 observation、模块/工具输出、证据、步骤、Gate、审批、执行前授权、错误、回复和 trace。SQLite repository 提供单机恢复；生产可替换为 PostgreSQL repository。API 不依赖进程内字典，重启后能按 `run_id` 恢复 Gate。

状态终态为 `completed` 或 `failed`；`waiting_human` 是可恢复暂停。拒绝不会删除候选、步骤或审批证据。

## 7. Tool、MCP 和 HTTP

- ToolRegistry 启动时校验 114 个工具的全局唯一性和 JSON Schema。
- 本地模式绑定七个确定性主链 handler，用于离线测试和合同验证。
- HTTP 模式由 `YUNPAI_TOOL_TRANSPORT=http` 开启，按 `M0_URL` 至 `M5_URL` 绑定全部工具。
- HTTP adapter 处理 path 参数、GET query、JSON body、base64→multipart、超时、TaskID、租户和幂等头。
- MCP stdio 暴露 `tools/list` 和 `tools/call`；每个工具带 module/execution/type 注解。
- 自由路径中的 `GET/HEAD/OPTIONS` 可直接执行；只生成候选/草稿且有后置 Gate 的四个主链工具可执行到审查点；其他非只读工具必须先经过 authorization Gate。

## 8. 失败关闭边界

系统不补造库存、供应商、ETA、标准工时、资源、生产单元、审批人或正式版本。`pressure_only` 不得发布。邮件草稿不等于发送，到货回复不等于库存增加，排程 draft 不等于 current。外部模块未连接时，工具明确返回未绑定错误。

## 9. 当前交付边界

本项目完整实现编排内核、合同注册、七个主链本地 handler、MCP、HTTP adapter、API、SQLite 恢复和文档生成。原模块的 OCR/VLM、数据库、OR-Tools、供应商/MES 集成仍由源码包里的 M0-M5 服务提供，必须在 HTTP 模式下部署并做真实数据、数据库和浏览器验收；本地确定性测试不能替代现场生产验收。
