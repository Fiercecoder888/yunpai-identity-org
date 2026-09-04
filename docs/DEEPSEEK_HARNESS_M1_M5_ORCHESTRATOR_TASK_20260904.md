# DeepSeek Harness 直接执行任务书：打通 M1-M5 编排、快照、发布与验收

发送对象：DeepSeek Harness（DSH）

项目：`yunpai-gragh0903`

任务性质：集成与编排修复。M1、M3/M4、M5 Tool/Skill 已由其他分支开发；本任务不得重复实现已有工具，重点是集成这些成果并修复总 Agent 到 M1-M5 的流程断点。

本文件包含独立执行所需的目标、代码入口、分支、资料位置、GB10/Qwen 配置、实现步骤、测试门槛和回执格式。执行时不得依赖任何聊天记录；仓库文件、执行时 Git 远端和 GB10 运行态是事实源。

## 1. 最终目标与完成边界

在数据齐套时，使 39092 的制造业务总 Agent 能完成以下闭环：

```text
文件/API 请求
  -> PlannerAgent 识别意图并选择受控工作流
  -> WorkerAgent 调用 Skill/Tool
  -> M1 解析与人工复核
  -> M0 canonical 发布或已发布事实回读
  -> M2 已审批 BOM/SOP/route
  -> M3 MRP/齐套快照
  -> M4 采购与供应快照
  -> Orchestrator 组装六类不可变 M5 snapshot
  -> M5 ingest + solve，持久化 draft plan
  -> Reviewer/人工 Gate
  -> M5 数据库真实执行 approved/released + scenario head CAS
  -> 回读 plan、head、lifecycle、trace
```

本任务的“完整 M1-M5”以 M5 计划真实持久化并发布为终点。MES 实际派工是独立的扩展 Gate：没有 MES endpoint/ACK 合同时，允许只生成耐久 `pending` dispatch，但禁止声称已派工或已被 MES 接收。

完成必须同时满足：

1. M1-M5 必需 Tool 均真实绑定，不存在 manifest-only 工具参与主链。
2. M1-M5 模块交接来自前一步输出或 canonical 服务回读，不再从最初 request 重建生产事实。
3. M5 六类 snapshot 有来源、版本、观测时间和 checksum，且由确定性代码组装。
4. 人工 Apply Gate 后，M5 数据库中的 lifecycle/head 真实更新，不只修改 RunState JSON。
5. 一个脱敏真实订单完成 GB10 HTTP 与数据库回读验收；同一输入重放满足幂等。
6. 项目规定的测试、账本校验、提交和推送全部有退出码与 SHA 证据。

## 2. 项目、远端和执行环境

### 2.1 本机项目

- 仓库根目录：`/Users/murkydoubloon45/Desktop/yunpaigragh`
- 受控 `dev` 工作树：`/Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev`
- GitLab：`ssh://git@192.168.110.22:2222/yunpaiadmin/yunpai-gragh0903.git`
- 远端名：`origin`
- 目标集成分支：`dev`
- `main`：只作为集成/发布基线，不直接开发或推送。
- 本机项目虚拟环境：`/Users/murkydoubloon45/Desktop/yunpaigragh/.venv/bin/python`
- DSH 日志目录：`/Users/murkydoubloon45/.dsh-runs/yunpai-gragh0903/<run_id>/`

日志目录至少包含：`events.jsonl`、`commands.log`、`progress.md`、`blockers.md`、`final-report.md`。所有日志必须脱敏。

执行前必须读取仓库根 `AGENTS.md`。如果执行时规则与本文件冲突，以执行时 `AGENTS.md` 和用户明确指令为准，并在 `blockers.md` 记录差异。

### 2.2 开工命令

```bash
cd /Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev
git status --short --branch
git branch -vv
git worktree list
git remote -v
GIT_SSH_COMMAND='ssh -i /Users/murkydoubloon45/.ssh/id_ed25519_company -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10' git fetch origin --prune
git rev-parse HEAD origin/main origin/dev origin/dsh/m1-tool-skill-completion-20260904 origin/pmctooldev
```

必须先记录执行时 SHA，不得把本节生成时的 SHA 当成最新值。不得 reset、强推、清理或覆盖现有提交和未提交内容。当前不是 `dev`、工作树不干净或存在未认领冲突时，先停在 Git Gate 并写明精确文件，不擅自处理用户资产。

### 2.3 生成本任务书时的分支事实，仅供核对

- `origin/main=7997308`，已包含 M3/M4 完善提交 `f7fedaf` 和收尾提交 `7997308`。
- M1 分支：`origin/dsh/m1-tool-skill-completion-20260904`，代码提交 `8a9794d`，生成时最新记录提交 `7ab64a0`。
- M5 分支：`origin/pmctooldev`，生成时最新记录提交 `62ab339`；该分支持续更新，必须 fetch 后使用执行时最新 SHA。
- `origin/dev` 可能落后上述分支；本地 `dev` 可能包含尚未推送的用户提交，必须保留。

推荐集成顺序：

1. 在干净且明确授权的 `dev` 工作树合入执行时最新 `origin/main`，取得 M3/M4。
2. 合入 M1 分支。
3. 合入 M5 分支。
4. 语义合并公共文件，不得用一方版本覆盖另一方：`registry.py`、`skills.py`、`agents.py`、`workers.py`、`graph.py`、`tests/test_api.py`、`tests/test_registry.py`、Skill 一致性测试。
5. 每次集成后运行定向测试和完整后端测试；最终全绿后才提交/推送 `dev`。

若执行时上述分支已进入 `origin/dev` 或 `origin/main`，不得重复合并；以 `git merge-base --is-ancestor` 和提交历史为准。

## 3. GB10、39092 和 Qwen

### 3.1 GB10 拓扑

- GB10：`192.168.110.19`
- 外部页面/API：`http://192.168.110.19:39092/`
- 后端：`127.0.0.1:9000`
- 静态代理：`39092 -> 127.0.0.1:9000 /api/*`
- release 根：`/home/wjc/yunpai-langgraph/releases/`
- 当前运行软链：`/home/wjc/yunpai-langgraph/current`
- GB10 Python：`/home/wjc/yunpai0902-gb10/venv/bin/python`
- 启停脚本：仓库 `ops/gb10/start_backend.sh`、`ops/gb10/start_frontend.sh`
- 发布说明：仓库 `docs/TEST_DEVELOPER_HANDBOOK.md`、`ops/gb10/README.md`

必须创建新 release 并保留旧 release。不得覆盖 release 内容、删除历史数据库或使用宽泛 `pkill`。切换前后核对 `current` 实际路径、进程 cwd、9000/39092 监听和回滚点。

持久数据库不得放在会随 release 删除的临时目录。M5 使用 `YUNPAI_M5_DB` 指向 release 外的受控持久路径，并在任务报告中记录路径、schema 版本和备份/回滚策略，不记录凭据。

### 3.2 Qwen 18085

- 格式：OpenAI-compatible
- GB10 本机 URL：`http://127.0.0.1:18085/v1`
- 局域网 URL：`http://192.168.110.19:18085/v1`
- 主机名 URL：`http://gb10:18085/v1`
- 模型：`qwen3.6-35b-a3b-fp8-gpu0-200k`
- 最大上下文：`65536`
- 鉴权入口：`18085`
- 实际 vLLM 后端：`127.0.0.1:18095`，业务应用不得绕过 18085 直连。
- GB10 托管配置：`/home/soft/yunpai/dev-39085/config/deploy.env`

服务启动时从托管配置读取 `ORCH_LLM_API_KEY` 并注入 `QWEN_API_KEY`，禁止显示、复制或写入仓库。确定性分类测试使用 `max_tokens >= 128`，并设置 `chat_template_kwargs.enable_thinking=false`，避免 thinking 消耗全部输出 token。

调用方式和已验证结果见仓库 `工作记忆.md`。LLM 只能提出意图和路由方案，不能组装生产 snapshot、批准 Gate 或修改生命周期。

## 4. 必读规范、代码和交接资料

### 4.1 项目事实源和架构

按顺序读取：

1. `/Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev/AGENTS.md`
2. `.project-to-act/PROJECT_OVERVIEW.md`
3. `.project-to-act/PROJECT_PROGRESS.md`
4. `.project-to-act/PROJECT_FEATURES.md`
5. `.project-to-act/PROJECT_VERSIONS.md`
6. `.project-to-act/PROJECT_ACCEPTANCE.md`
7. `docs/DEEPSEEK_HARNESS_IMPLEMENTATION_TASKBOOK_20260904.md`
8. `docs/M0_M5_FUNCTION_REFERENCE.md`
9. `docs/TOOL_AND_MCP_REFERENCE.md`
10. `docs/PRODUCT_AND_FUNCTION_ARCHITECTURE.md`
11. `docs/LLM_ROUTING.md`
12. `docs/TEST_DEVELOPER_HANDBOOK.md`
13. `docs/ACCEPTANCE_MATRIX.md`
14. `docs/DATA_REQUIREMENTS_0903.md`
15. `docs/WECHAT_DOWNLOAD_AUDIT_20260904.md`
16. `docs/M0_GB10_INGEST_RECONCILIATION_20260904.md`
17. `docs/DATABASE_ARCHITECTURE_REPORT_20260904.md`
18. `docs/POSTGRESQL_DATA_DICTIONARY_20260904.md`
19. `docs/SESSION_COLLABORATION_RULES.md`
20. `.coordination/claims/README.md`
21. `工作记忆.md`

### 4.2 当前执行链代码

- API/上传：`src/yunpai_langgraph/api.py`、`frontend/src/lib/upload.ts`、`frontend/src/components/AgentWorkspace.tsx`
- Planner/Worker/Reviewer：`src/yunpai_langgraph/agents.py`
- 状态机和模块桥接：`src/yunpai_langgraph/graph.py`
- workflow：`src/yunpai_langgraph/workflows/m0_m5.json`、`src/yunpai_langgraph/workflow_registry.py`
- Tool 注册和 HTTP：`src/yunpai_langgraph/registry.py`、`src/yunpai_langgraph/contracts.py`
- Skill：`src/yunpai_langgraph/skills.py`、`skills/m0/` 至 `skills/m5/`、`skills/m5-pmc-lifecycle/`
- M1：合入后检查 `src/yunpai_langgraph/m1_tooling.py`、`m1_http_adapter.py`、`ops/m1/README.md`
- M5：`src/yunpai_langgraph/pmc_v2_adapter.py`、`pmc_v2_snapshots.py`、`pmc_v2_scheduler.py`、`m5_repository.py`、`m5_tools.py`
- RunState 持久化：`src/yunpai_langgraph/models.py`、`repository.py`
- Tool manifest：`src/yunpai_langgraph/manifests/m0.json` 至 `m5.json` 和 `registry/tool-manifests/`
- 本地环境模板：`.env.example`；只能参考变量名，不能向仓库写入真实值。

### 4.3 Tool/Skill 交接包和历史实现

M1 已提交交接包：

- `/Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev/handoff/m1-tool-skill-completion-20260904/`
- 重点：`COPY_PASTE_TASK.md`、`SOURCE_MIGRATION_MAP.md`、`IMPLEMENTATION_CONTRACT.md`、`TEST_ACCEPTANCE.md`、`sources/SHA256SUMS`
- 历史主实现：`/Users/murkydoubloon45/Desktop/yunpai/yunpai-t8-extract-panel/m1`
- 0902 补充：`/Users/murkydoubloon45/Desktop/yunpai0902/services/m1`

M3/M4 参考包：

- `/Users/murkydoubloon45/Desktop/yunpaigragh/handoff/m3-m4-tool-skill-completion-20260904/`
- 历史实现：`/Users/murkydoubloon45/Desktop/yunpai/yunpai-t8-extract-panel/m3`、`/Users/murkydoubloon45/Desktop/yunpai/yunpai-t8-extract-panel/m4`
- 0902 服务：`/Users/murkydoubloon45/Desktop/yunpai0902/services/m3`、`/Users/murkydoubloon45/Desktop/yunpai0902/services/m4`
- 当前正式代码优先取执行时最新 `origin/main`，历史包只用于理解和测试，不覆盖当前 manifest。

M5 参考包：

- `/Users/murkydoubloon45/Desktop/yunpaigragh/handoff/m5-pmc-v2-completion-20260904/`
- 重点：`TASKBOOK.md`、`IMPLEMENTATION_CONTRACT.md`、`TEST_ACCEPTANCE.md`、`ACCEPTANCE_REPORT_20260904.md`
- 当前实现优先取执行时最新 `origin/pmctooldev`
- 历史实现：`/Users/murkydoubloon45/Desktop/yunpai/yunpai-t8-extract-panel/m5`
- 0902 服务：`/Users/murkydoubloon45/Desktop/yunpai0902/services/m5`

所有 sources 归档必须先按随包 `SHA256SUMS` 校验。历史代码、部署配置和数据库只能作参考，不得复制其中的密钥、连接串或客户数据。

## 5. 已审计基础资料位置

以下路径只读。不得把原始制造文件、数据库、微信缓存或解包产物提交到 Git。只选最小脱敏样本，记录 SHA、相对路径和字段证据。

### 5.1 产品与架构资料

- 当前仓库产品文档包：`/Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev/Yunpai_产品设计架构功能文档包_20260902/`
- 内含：`云湃工业一体机产品设计思路文档.md`、`云湃工业一体机完整功能文档.md`、`云湃工业一体机完整架构文档.md`

### 5.2 订单、BOM、SOP、库存、采购和设备资料

- 已整理订单目录：`/Users/murkydoubloon45/Downloads/灵创新订单/`
- PMC 说明归档：`/Users/murkydoubloon45/Downloads/PMC相关资料与前端展示说明-2026-08-23.zip`
- WIP PMC 复用包：`/Users/murkydoubloon45/Desktop/yunpai.nosync/worktrees/0831-sub-c-frontend/exports/wip-pmc-reuse-20260901.zip`
- WIP PMC 解包目录：`/Users/murkydoubloon45/Desktop/yunpai.nosync/worktrees/0831-sub-c-frontend/exports/wip-pmc-reuse-20260901-bundle/`
- PMC 完整性试验数据：`/Users/murkydoubloon45/Desktop/yunpai/outputs/pmc_complete_pilot_dataset/`
- 历史 M5 报告数据：`/Users/murkydoubloon45/Desktop/yunpai/m5_reports_data/`
- 微信人工导出：`/Users/murkydoubloon45/Desktop/yunpai/微信文件导出/`
- 微信历史索引：`/Users/murkydoubloon45/Desktop/yunpai/vx/wechat_history/`
- 微信图片索引：`/Users/murkydoubloon45/Desktop/yunpai/vx/wechat_images/`
- 微信文件自动化目录：`/Users/murkydoubloon45/Desktop/yunpai/wechat_file_rpa/`

真实资料存在不等于 production snapshot 已齐套。具体已找到字段、缺口和使用边界以 `docs/WECHAT_DOWNLOAD_AUDIT_20260904.md` 和 `docs/DATA_REQUIREMENTS_0903.md` 为准；WIP 复用包必须按其内部说明和 source 标记区分 production、historical 与 test fixture。

### 5.3 当前本地数据库和边界

- RunState：`/Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev/runtime/yunpai-runs.sqlite`，若运行后创建；只保存 Agent 运行状态，不是业务事实源。
- 业务资料候选库：`/Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev/runtime/yunpai-business-catalog.sqlite`；只保存 source/candidate/evidence，不是 M0 canonical。
- M0 sandbox：`/Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev/runtime/yunpai-m0-sandbox.sqlite`；仅用于测试。
- M5 持久库：执行时由 `YUNPAI_M5_DB` 指定；GB10 production 值必须位于 release 外的受控持久路径。
- M0 canonical：设计目标为 PostgreSQL；实际 URL、schema、migration、RLS 和回读状态必须在 GB10 动态核对，不能根据逻辑数据字典假定已经存在。

### 5.4 微信/企业微信原始缓存边界

- 个人微信：`/Users/murkydoubloon45/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/`
- 企业微信邮件附件：`/Users/murkydoubloon45/Library/Containers/com.tencent.WeWorkMac/Data/Library/Application Support/WeMail/cache/attach/`

这些目录包含大量无关和敏感内容，不得默认全量导入、复制、上传或记录文件名。除非任务所需资料在前述整理目录不存在，只能依据审计文档选取明确制造资料；HR、工资、身份证、银行卡、合同和个人联系方式禁止进入 PMC、fixture、日志和仓库。

## 6. 当前架构事实和断点

当前架构是 `PlannerAgent -> WorkerAgent -> ReviewerAgent` 循环：

- PlannerAgent 使用 Qwen 提案并由确定性规则校验，只负责编排。
- 当前只有一个通用 WorkerAgent；Skill 是高阶 operation 到 Tool 的白名单映射，模块服务不是多个常驻 Worker Agent。
- ToolRegistry 负责 input/output schema、local/HTTP handler、TaskID/tenant/idempotency 传播。
- ReviewerAgent 在副作用前授权，并在结果后决定通过、失败或 Gate。
- FastAPI 当前直接使用 `YunpaiGraph.run/stream`；`build_graph()` 的 LangGraph StateGraph 不是 API 主路径。不得为了名称纯化而重写运行时，除非验收证明有必要。

必须修复的流程断点：

1. `/runs/upload` 只接受 XLSX，且在 Planner 前直接解析；PDF、图片、归档等无法进入 M1。
2. 全链路只加载固定 `m0_m5`，缺少“原始文件从 M1 开始”和“已有 canonical 数据恢复执行”入口。
3. M1->M2 主要重新读取初始 request，不完整消费 M1/canonical 输出。
4. M2->M3 的库存来自 `request.inventory`，当前兼容逻辑可能生成 `local-fixture` 默认字段。
5. M3->M4 的供应商主要来自 `request.supplier_by_material`，没有以 M4 主数据/事实回读为准。
6. M4->M5 没有消费 M4 PO/ETA/supply 结果；M5 又从初始 request 读取 route/resource/material。
7. Apply Gate 当前只把 RunState 输出中的 `lifecycle_status` 改为 `released`，没有调用 M5 repository 的 lifecycle/head 更新。
8. `/runs/{run_id}/resume` 接受请求体自报 `actor`，不能作为可信生产审批身份。
9. M5 dispatch 当前最多建立 durable `pending`；没有 MES sender/ACK 时不能声明真实下发。

## 7. 实施任务

### T0：集成 Tool/Skill 分支并建立运行时绑定 Gate

1. 按第 2.3 节集成 M1、M3/M4、M5，不重复实现已有工具。
2. 冲突处理必须保留 M1 专用 multipart/202/tenant/actor adapter、M3/M4 HTTP header/error/query adapter 和 M5 repository/Skill/Gate。
3. 增加启动期或创建 workflow 前的 required-capability 检查。全链路所需工具未绑定时，返回列出 module/tool 的 `CAPABILITY_UNAVAILABLE`，不得执行到中途才报 generic 500。
4. `/health` 和 `/tools` 输出各模块 spec/bound 数量；测试验证主链必需工具逐个 bound。不要只验证总数。
5. 生产使用真实模块时配置 `YUNPAI_TOOL_TRANSPORT=http`、`YUNPAI_HTTP_MODULES` 和 M1-M5 URL；local fixture 只能用于单元测试或显式 preview。

### T1：重构文件入口和工作流选择

1. 上传层接收文件、保存原字节/哈希/类型/相对路径，不能在 API 层只按 XLSX 固定解析。
2. 单文件和多文件统一转成 attachment reference；支持的实际类型以 M1 Tool 合同为准。
3. 新增至少两个版本化 workflow：
   - `m1_m5_document_to_plan`：原始文件 -> M1 parse/review -> M0 resolve/commit -> M2-M5。
   - `canonical_to_m5`：校验 canonical entity/version/checksum 后，从所需模块恢复，不重复导入原文件。
4. 旧 `m0_m5` 如需保留，只能作为兼容路径，且不得在 M1 解析前发布未解析原始文件为 canonical 事实。
5. Planner 只选择 workflow/Skill/Tool；不得由 Qwen 生成 BOM、库存、资源、审批或 snapshot 值。
6. 工作流中同一个根 `task_id`、`tenant_id`、`site_id` 传播到全部步骤。

### T2：建立确定性跨模块桥接

不要继续扩展 `graph.py::_payload_for()` 中的大段临时字典拼接。新增清晰的 orchestrator bridge，例如：

```text
src/yunpai_langgraph/planning_snapshot.py
src/yunpai_langgraph/orchestration_bridge.py
```

具体命名服从现有代码风格。实现要求：

1. M1->M2：从 M1 `m1.document.v2` 和已审核 canonical order/product 读取输入；保留 source/version/evidence。
2. M2->M3：只使用已批准 BOM/route；库存通过 M3/库存事实接口读取，不接受隐式仓库、批次、QC、时间默认值。
3. M3->M4：使用 M3 shortage/handoff envelope、revision、checksum；供应商和 ETA 由 M4 主数据/采购事实解析。
4. M4->M5：读取 M4 supplier/PO/ETA/receipt/QC supply snapshot，不忽略 M4 输出。
5. bridge 只能调用 ToolRegistry 中已注册的只读/受控工具，传播 TaskID、tenant、site、trace 和幂等键；不得直接跨模块访问私有数据库。
6. bridge 缺任何权威输入时返回结构化 `BLOCKED_INPUT`，包含 `missing_fields`、`source_module`、`required_tool` 和恢复动作。

### T3：组装并写入 M5 六类 snapshot

在 M5 solve 前增加独立 `m5_snapshot` 工作流步骤：

1. `order_snapshots`：行级订单、产品、数量、交期、优先级、状态、版本。
2. `routes`：已批准 route、operation、前置关系、标准工时、资源/技能要求。
3. `resource_snapshot`：工位、设备、人员/技能、能力、状态、生产单元和 WIP 占用。
4. `calendar_snapshot`：班次、工作区间、休息、停机、维护、请假/加班。
5. `supply_snapshot`：库存 lot、可用/锁定/QC、M3 allocation、M4 PO/ETA/收货。
6. `constraint_snapshot`：换型、冻结窗、锁定工序、批量、目标权重和跨单元约束。

每类 snapshot 必须含 `snapshot_id`、正整数 `revision`、`checksum`、`source_system`、`source_ref`、`source_observed_at`、`tenant_id/site_id`。checksum 使用规范化 JSON；不得对 `str(dict)` 哈希。

依次调用：

```text
validate_bundle
ingest_m5_planning_snapshot
get_m5_material_readiness
solve_scheduling
get_m5_schedule
```

production 缺 snapshot、数据过期、checksum 不符、route 未审批、资源无日历、供应未知时必须失败关闭。不得补 `08:00-17:00`、`60/h`、效率 1、默认工位、默认人员、默认 lot、默认供应商或 `APPROVED-ROUTE`。

### T4：把 Apply Gate 接到真实 M5 生命周期

M5 repository 已提供 lifecycle transition 和 scenario head CAS，但当前 Graph 未调用。实现受控服务/Tool，例如：

```text
approve_m5_schedule
release_m5_schedule
```

也可使用一个明确命名的原子 apply Tool，但必须满足：

1. 只接受已持久化 `production` plan_version。
2. 严格执行 `draft -> approved -> released` 相邻迁移。
3. release 前校验 validation report 为 pass。
4. release 与 `set_head(expected_revision)` 在一个事务边界完成；冲突时不能留下假 released 或错误 head。
5. lifecycle audit 记录认证 principal、Gate、TaskID、trace、revision 和时间。
6. 已发布计划不可覆盖；重排生成 parent_plan_version 明确的新版本。
7. Graph 只有在 Tool 成功并回读 lifecycle/head 后，才把步骤设为 completed。
8. 失败时保持 `waiting_human` 或返回可恢复冲突，不得只修改 RunState JSON。

### T5：审批身份与 Gate

1. `/runs/{run_id}/resume` 不再信任请求体 `actor`。
2. 从受信任认证中间件或反向代理 principal 获取 `actor_id/roles/tenant`；9000 只监听本机，外部只经受控 39092 入口。
3. candidate、M1 review、engineering、procurement、M5 apply 分别定义允许角色。
4. body 冒充 actor、跨租户审批、过期 revision、重复审批和无角色审批必须拒绝并记录审计。
5. 数据 Gate 不能通过简单 `approve` 绕过；必须提供新 snapshot/ref/revision 后重试。

### T6：MES 下发，条件任务

若执行时已有正式 MES endpoint、认证、operation 映射和 ACK 合同，则实现/接通：

```text
released -> durable outbox -> sender -> sent -> acknowledged/partial/failed
```

要求幂等、退避重试、dead-letter、ACK 原文摘要、execution event 回流和计划/实际对账。

若没有正式 MES 合同，本任务只验收 durable `pending` dispatch，并在最终报告明确：M1-M5 计划发布完成，MES 实际派工未验收。不得制造 ACK 或把 `pending` 写成 `sent`。

## 8. 真实数据映射要求

从第 5 节资料中选择一个不含 HR/财务敏感字段的真实多行订单，围绕同一订单补齐以下矩阵：

| 数据 | 权威来源 | 必须回读 |
|---|---|---|
| M1 文档 | 原文件 SHA、M1 task/document | 解析字段、证据位置、review 状态 |
| M0 订单/产品 | canonical API | entity/version/source/ledger/outbox/checksum |
| M2 BOM/route | 已批准工程版本 | approval_ref、route_version、operations |
| M3 齐套 | 库存和 allocation snapshot | required/available/locked/shortage/QC/ready_at |
| M4 供应 | supplier/PO/ETA/receipt/QC | PO line、数量、ETA、confidence、observed_at |
| M5 资源 | 工位/设备/人员/日历/WIP | resource/calendar/constraint snapshot IDs |
| M5 计划 | plan repository | plan_version、input_hash、validator、schedule |
| M5 发布 | lifecycle/head | approved/released audit、head revision |

人员、技能、工位、日历、当前 WIP 或供应事实不齐时，应得到精确的 `BLOCKED_INPUT`，并在 `blockers.md` 写出缺失字段和应提供的表/API。不得为了跑通使用 `TEST-*`、synthetic fixture、历史汇总或代码示例冒充生产事实。

## 9. 测试要求

### 9.1 定向测试

至少覆盖：

- 上传文件能够进入 M1，而不是在 API 层因非 XLSX 提前失败。
- Planner 对原始文件和 canonical refs 选择正确 workflow；无关聊天不触发生产链。
- 缺少必需 bound Tool 时在执行前返回工具清单。
- M1 输出真实进入 M2；M2 approved BOM 进入 M3。
- M3 snapshot 进入 M4，M4 supply/ETA 明确进入 M5 snapshot。
- snapshot 六类完整、checksum 稳定；缺一类、过期或篡改时失败关闭。
- M5 production 不进入 legacy/preview，不使用隐式默认。
- Apply Gate 后 SQLite/PostgreSQL 回读为 approved/released，并正确更新 head revision。
- body actor 冒充、跨租户、陈旧 CAS、同幂等键异输入全部拒绝。
- 同输入/同幂等键重放返回同 plan_version，不产生重复 plan/lifecycle/dispatch。
- RunState 的 `task_id`、`pending_gate`、approvals、trace 与模块数据库记录一致。

优先运行：

```bash
/Users/murkydoubloon45/Desktop/yunpaigragh/.venv/bin/python -m pytest -q \
  tests/test_api.py \
  tests/test_graph.py \
  tests/test_http_adapter.py \
  tests/test_m1_http_adapter.py \
  tests/test_m1_skill_operations.py \
  tests/test_m5_plan_repository.py \
  tests/test_m5_lifecycle_tools.py \
  tests/test_m5_pmc_v2_strict_input.py \
  tests/test_m5_solve_idempotency.py \
  tests/test_workflow_manifest.py
```

文件不存在时以执行时合入代码的对应测试为准，记录替代关系。

### 9.2 项目完整门槛

```bash
cd /Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev
/Users/murkydoubloon45/Desktop/yunpaigragh/.venv/bin/python -m pytest -q
python /Users/murkydoubloon45/.codex/skills/project-to-act/scripts/init_project_management.py \
  --project-root /Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev --validate
git diff --check
git status --short --branch
```

修改前端时还必须运行：

```bash
cd /Users/murkydoubloon45/Desktop/dsh-worktrees/yunpai-gragh0903-integration-dev/frontend
npm test -- --run
npm run build
```

任一测试失败、依赖缺失或未实际执行，不得提交后自动推送。不得因历史报告曾通过而跳过当前版本测试。

## 10. GB10 真实验收顺序

1. 创建新的隔离 release 和持久数据路径；登记并遵守 `DEPLOY_LOCK`。
2. 验证 Qwen `/v1/models` 和一次关闭 thinking 的 `/chat/completions`，不输出 Key。
3. 启动各 M1-M5 服务，逐个检查 `/health`、`/ready`、迁移和数据库连通性。
4. 配置 orchestrator HTTP transport；调用 `/api/health`、`/api/tools`、`/api/skills`，核对主链 required tools。
5. 上传选定真实订单；记录 run_id、root task_id、M1 task_id、M0 batch/entity refs。
6. 完成必要人工 Gate；所有批准使用认证 principal。
7. 回读 M2 approval、M3 readiness、M4 supply、六类 M5 snapshot。
8. 求解并回读 draft plan；完成 Apply Gate 后回读 approved/released lifecycle 和 head。
9. 同一输入重放一次；再做缺 snapshot、陈旧 CAS、同幂等键异输入三个负向测试。
10. 如有 MES，验证 sender/ACK；否则只记录 pending dispatch 边界。
11. 检查 39092 页面、API trace、数据库和 release cwd 一致；保留旧 release 回滚点。

只看到 HTTP 200、RunState completed、候选记录或页面显示排程，不算真实验收。必须有模块数据库/服务端 readback。

## 11. 提交、推送和账本

1. 只修改本任务所需代码、测试、文档和账本段落。
2. `.project-to-act/` 是唯一事实源；按实际结果更新进度、功能、版本、验收和阻塞，不能覆盖历史。
3. 测试全部退出 0 后检查待提交 diff、密钥、数据库和运行产物。
4. 在 `dev` 使用命令式提交，例如：`orchestrator: connect M1-M5 production workflow`。
5. 推送 `git push origin dev`。推送会带入非本任务本地提交时，停止并报告，不重写历史或强推。
6. 不直接提交、推送或自动合并 `main`；main 合并由集成/发布流程决定。

## 12. 停止条件

仅在以下情况停止实施并提交精确阻塞报告：

- 工作树/分支包含无法隔离且所有权不明的冲突修改。
- 必需模块没有可部署实现，且历史包/远端分支也不存在。
- 真实生产数据缺少 canonical revision、审批或来源证据。
- 需要处理未授权 HR/财务/个人敏感数据。
- MES 合同不存在时，只停止 MES 实际下发部分，不停止 M1-M5 计划发布闭环。

服务器权限、代码合并权限和常规部署操作不是本任务的预设阻塞。遇到端口、进程、依赖或 release 配置问题，应在不破坏其他服务的前提下自行诊断并解决。

## 13. 最终回执模板

```text
任务：M1-M5 编排、快照和发布闭环
run_id：<DSH run id>
工作树/分支：<absolute path>/<branch>
执行基线：HEAD=<sha>；origin/main=<sha>；origin/dev=<sha>
集成来源：M1=<sha>；M3/M4=<sha>；M5=<sha>
修改文件：<列表>

架构结果：
- 文件入口：<通过/阻塞，支持格式>
- workflow：<m1_m5_document_to_plan/canonical_to_m5>
- required Tool 绑定：<逐模块 spec/bound/主链缺失>
- M1->M2：<来源与版本>
- M2->M3：<BOM/库存 snapshot>
- M3->M4：<handoff/供应商>
- M4->M5：<supply/ETA 被消费的证据>
- M5 六类 snapshot：<ID/revision/checksum>
- M5 plan：<scenario_id/plan_version/input_hash/validator>
- M5 lifecycle/head：<draft/approved/released/head revision>
- MES：<acknowledged 或仅 pending，并说明边界>

真实数据：<脱敏订单标识、源 SHA、禁止记录原始敏感内容>
GB10 release：<release id/current/rollback id>
39092：<URL、health、required tools>
Qwen：<URL/model/HTTP 状态，不含 Key>

定向测试：<命令/退出码/通过数>
完整后端：<命令/退出码/通过数>
前端测试：<命令/退出码或未修改前端>
前端构建：<命令/退出码或未修改前端>
账本校验：<命令/退出码>
git diff --check：<退出码>
提交：<sha>
推送：<origin/dev sha 或未推送原因>
未解决阻塞：<精确位置、错误、已尝试、恢复条件>
结论：<M1-M5 计划发布已验收/未验收；MES 已验收/未验收>
```

禁止使用“基本完成”“应该可用”“本地能跑”作为最终结论。每个结论必须对应当前提交、HTTP 结果、数据库回读或明确阻塞证据。
