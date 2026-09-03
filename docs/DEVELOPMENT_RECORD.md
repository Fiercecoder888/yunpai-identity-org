# 开发记录

## 2026-09-02：输入审计与架构提炼

1. 阅读三份产品文档、`Yunpai-0902-architecture-package-20260902.zip` 和 `yunpai-0825-source-8fb686d5.zip`。确认产品核心不是模块菜单，而是以 M0 canonical 事实、统一 TaskID、EvidenceRef、版本和 Gate 为基础的制造业务执行系统。
2. 审计原 Orchestrator 与 M0-M5 的 `.well-known/tool.json`、业务流、模块边界和运行依赖。确认跨模块不得共享 ORM/跨库 SQL，PostgreSQL 是权威事实，Neo4j/搜索是可重建投影。
3. 确定重构边界：新项目负责 Planner/Worker/Reviewer、路由、工作流、合同注册、MCP/API、状态恢复和审计；OCR/VLM、数据库、OR-Tools、供应商与 MES provider 仍由原模块服务负责。

输入归档及六个提取 manifest 的 SHA-256 记录在 `registry/SOURCE_PROVENANCE.json`。提取文件与原 Orchestrator module declaration 逐字节一致。

## 2026-09-02：能力提取

1. 从原源码提取 M0 27、M1 17、M2 7、M3 17、M4 26、M5 20，共 114 个原始 Tool 合同。
2. 建立 `ToolSpec`/`ToolRegistry`，启动时检查全局唯一名称和 JSON Schema；未绑定工具失败关闭。
3. 建立六个模块 Skill 和一个 Orchestrator Skill。每个模块 Skill 说明职责、事实边界、选择方式和失败语义，并链接由 manifest 自动生成的逐工具参考。
4. 建立 MCP JSON-RPC stdio，支持 `initialize`、`tools/list` 和 `tools/call`。114 个工具均输出原始输入 Schema 和模块注解。
5. 建立生产 HTTP adapter：path 参数编码、GET/DELETE query、JSON body、base64 multipart、模块认证头、TaskID/tenant/idempotency 传播、超时和响应 Schema 校验。

## 2026-09-02 至 2026-09-03：LangGraph 重构

1. 实现真实三节点图：Planner 只规划，Worker 只从全局注册表调用，Reviewer 执行确定性审查并决定继续、Gate 或失败。
2. 实现 ReAct 类路由：`workflow` 加载版本化业务流，显式/语义工具进入 `free`，无业务动作进入 `chat`；trace 记录 thought/action/observation/review。
3. 将 M0→M5 主链提取到 `workflows/m0_m5.json`：M0 候选与发布、M1 解析、M2 BOM/SOP、M3 MRP、M4 采购桥接、M5 排程。
4. 为七个主链工具实现离线确定性 handler，严格遵循原始输入/输出合同，用于项目自验证；其余 107 个工具由 HTTP transport 连接原服务。
5. 实现 candidate、review、engineering、procurement、apply 和 authorization Gate；`retry + supplement` 保留 superseded 步骤，拒绝保留审计并终止。
6. 修复自由写工具的执行时序：非只读能力在 Worker 调用前授权，拒绝时零调用，批准后同一步骤恰好执行一次。
7. 实现 InMemory/SQLite repository、FastAPI 创建/列表/查询/恢复接口和 LangGraph Studio graph 导出；每个节点后持久化，可跨实例恢复 Gate。

## 2026-09-03：文档与验收

1. 生成 `M0_M5_FUNCTION_REFERENCE.md` 和六份 `skills/*/references/tools.md`，逐项记录功能说明、HTTP、执行模式、输入和输出 Schema。
2. 编写产品理解、实现架构、Tool/MCP/API 说明、验收矩阵和本报告。
3. 运行单元、集成、状态恢复、HTTP adapter、MCP stdio、打包、Skill 校验、源码哈希和 HTTP 冒烟测试。最终命令与结果见 `TEST_REPORT.md`。
4. 使用真实桐曦 XLSX 订单调用 GB10 Qwen3.6 35B，模型返回 `workflow/0.95`；上传运行记录、解析字段、Gate 和修复过程见 `ORDER_UPLOAD_TEST_20260903.md`。

## 2026-09-03：业务资料识别 Skill

1. 新增 `business-data-identification` Skill、SkillRegistry 和 `/skills` 目录接口；Planner/Worker/Reviewer 共用同一审计状态机。
2. 新增 `runtime/yunpai-business-catalog.sqlite` 候选库，包含批次、来源文件、文档候选和字段观察表；按路径+SHA-256 幂等，保留 Source/Evidence 定位。
3. 从 `/Volumes/外置硬盘/云湃业务数据` 全量识别 439 个支持文件，0 个异常；大型 Excel 延后 M1 专项解析。
4. 使用桐曦真实订单上传验证 Skill 路由：Planner 记录“业务资料识别与落库”，选择自由路径和 Skill，候选写入后 Reviewer 打开 candidate Gate。
5. 本次 Qwen 请求返回 HTTP 401，系统按设计记录模型错误并使用确定性 Skill 路由；恢复 Qwen 需要配置 GB10 服务认可的 API Key。

## 2026-09-03：GB10 交接部署

1. 交接包 `dist/yunpai-langgraph-handoff-20260903.tar.gz` 包含核心源码、M0-M5 Skill/Tool/MCP 合同、工作流、测试、构建后的前端和两份 SQLite 数据库快照。
2. 部署到 `/home/wjc/yunpai-langgraph/current`；后端 9000 仅本机监听，静态代理对外提供 39092，未触碰 GB10 既有冻结服务。
3. 停写、checkpoint、完整性检查、SHA-256 对比后完成数据库原子迁移；迁移基线与远端哈希一致。详细结果见 `GB10_DEPLOYMENT_20260903.md`。
4. GB10 真实订单验收成功调用 Qwen3.6 35B，Planner 选择 `free -> business-data-identification` 并打开/恢复 candidate Gate；模型与路由审计记录已落入 runs SQLite。

## 2026-09-03：39092 M3 空值修复

1. 根据 GB10 前端错误记录定位：浏览器 `/runs/stream` 仅提交订单附件，M1 未自动解析 XLSX，导致 `quantity=None` 传入 M3 并触发 `float(None)`。
2. `graph._payload_for` 现在对流式订单附件调用 `parse_order_workbook`；M3 数值归一化函数对 `None`/空字符串使用零值并保留非法类型错误。
3. 新增回归测试覆盖流式附件解析和 M3 nullable 数值；后端测试更新为 39 passed。
4. GB10 39092 已切换到 release `20260903134000`，真实订单经 M0→M5 Gate 流程完成，M3 返回 `partial_shortage` 且无错误。

## 2026-09-03：39092 前端三项问题修复

1. 基础资料输入改为 `multiple + webkitdirectory`，一次可选择整个文件夹；使用 `webkitRelativePath` 保留目录层级和文件名，后端仍按单文件候选逐个识别。
2. 修复桌面布局的 Grid/Flex 高度约束：主列固定占满视口，消息区独立滚动，输入框固定在可视区域底部；1280×720 实测输入框 `bottom=720`。
3. 修复聊天回答链路：Qwen 路由 JSON 增加 `answer` 字段，chat 分支写入运行响应并流式返回；修复完成分支覆盖 answer 的 bug；无模型时保留确定性中文兜底。
4. 本地验证后发布 GB10 release `20260903161000`。真实浏览器复测：文件输入 `multiple=true`、基础资料输入 `webkitdirectory=true`，普通询问返回 Qwen 答案，页面输入框可见。

## 关键决策

| 决策 | 理由 |
|---|---|
| 原 manifest 原样保存，不人工简写 | 防止丢失长尾工具、嵌套 Schema 和真实 HTTP 合同 |
| 本地只实现七个主链 handler | 编排项目不复制模块数据库和 provider；未连接能力必须诚实失败 |
| workflow 与 free 共用 Worker/Reviewer | 保持一个安全模型和一种审计记录 |
| 原始 observation 完整保存，trace 只保存摘要 | 兼顾可恢复性与日志体积 |
| MCP 作为底层 transport，业务会话走总 Agent | 原子工具可复用，但跨模块 Gate 只由编排状态机负责 |

## 生产上线前仍需完成

本目录可完整验证编排项目，但不包含生产 PostgreSQL/Neo4j、Redis、OCR/VLM、OR-Tools、供应商邮件或 MES 环境。上线前必须部署原 M0-M5 服务，配置认证与模块 URL，执行真实数据库迁移、租户/RBAC、幂等冲突、故障恢复、浏览器流程、容量和安全测试。此边界不以本地 mock 成功替代。
