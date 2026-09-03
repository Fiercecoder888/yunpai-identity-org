# 39085、桌面 0902 与当前版本功能差异

更新时间：2026-09-03
对比对象：39085 历史验收版本、桌面 0902 架构包、当前 `yunpaigragh` 工作区 `dev`

## 1. 结论摘要

当前版本不是 39085 PMC 的等价替换，也还没有达到 0902 冻结契约要求的生产 PMC。当前新增的 `pmc_v2` 可以在显式快照齐全时生成一个确定性的草稿排程，已经覆盖基础的多订单、工序前置关系、设备/人员/工装/工位组合、日历、停机、换型、WIP 延迟和阻断码；但它仍是内存式的贪心排程适配器。

PMC 的主要差距不是页面样式，而是“事实输入、求解目标、计划生命周期”三层没有闭环：

1. 输入层仍会把缺失的产能、效率、工作日历和路线审批值补成默认值，违反 0902 的 fail-closed 约束。
2. 求解层按输入顺序寻找最早可用组合，没有 39085 的 CP-SAT 优化、交期/优先级目标、迟交指标和多订单全局权衡。
3. 运行层只返回 `draft`，没有 39085 的持久化版本、审批/发布、锁定、派工、执行回传、事件重排和版本差异。

因此，当前 PMC 可定位为“受约束排程预览/开发验证”，不能描述为可发布、可派工或生产验收通过。

## 2. 对比边界与证据

| 对象 | 证据位置 | 证据性质 |
|---|---|---|
| 39085 | `/Users/murkydoubloon45/Desktop/yunpai/0810-todo/evidence-fix3-39085-schedule/api-latest.json`、`.../repro-final-content.txt` | 真实环境的排程结果和浏览器复现记录 |
| 39085 前端 | `/Users/murkydoubloon45/Desktop/yunpai/39085前端使用手册/使用手册.md`、`scripts/explore_report.json` | 页面功能和 M5 看板/甘特入口记录 |
| 0902 架构 | `Yunpai-0902-architecture-package-20260902.zip` 中 `23-VERSION-COMPARISON.md`、`24-LATEST-CODE-VERSION.md` | 架构继承包和版本差异基线 |
| 0902 产品/架构定义 | `Yunpai_产品设计架构功能文档包_20260902/云湃工业一体机完整架构文档.md`、`.../云湃工业一体机产品设计思路文档.md` | PMC 输入边界、M5 责任和验收原则 |
| 当前版本 | `src/yunpai_langgraph/pmc_v2_snapshots.py`、`pmc_v2_adapter.py`、`pmc_v2_scheduler.py`、`workers.py`、`frontend/src/components/AgentWorkspace.tsx` | 当前工作区代码；工作区存在未提交改动，不能视为已发布版本 |

39085 证据本身也有边界：历史浏览器复现记录出现过一次 401 资源错误，且计划状态仍为 `draft`。本文把它作为“已实现能力面”的对照，不把它误写成当前生产环境的全量验收。

## 3. 功能差异总表

| 能力域 | 39085 | 桌面 0902 冻结方向 | 当前版本 | 差异判断 |
|---|---|---|---|---|
| 订单与齐套 | `order_kitting`、库存分配、最早齐套时间、缺料清单 | 订单快照 + M3/M4 供应快照，ETA 不确定时不得释放 | 只有订单快照；供应主要从 `wip_status`/`material_availability` 转换，未接 `order_kitting` | **缺口**：齐套与排程释放条件不完整 |
| 工艺路线 | OP-10…OP-70、工位/资源、工时和路线版本 | 已批准 route snapshot，`approval_ref`、版本、checksum 必须齐全 | 能生成 route snapshot，但 `approval_ref` 可默认成 `APPROVED-ROUTE` | **P0 风险**：缺失审批事实被伪造成已批准 |
| 求解器 | CP-SAT，返回 `optimal`、迟交和资源负载指标 | 确定性约束求解；目标权重可配置 | 逐工序 earliest-fit 贪心；只按最早开始时间和组合顺序选解 | **核心缺口**：无交期/优先级/全局优化 |
| 多资源 | 工作中心、设备、人员、工装、工位和容量 | 设备/人员/工装/工位组合同时满足 | 支持四类资源组合和占用，但资源字段不足时适配器补默认值 | 能力存在，数据真实性不足 |
| 日历与停机 | 真实班次、资源不可用窗口 | `calendar_snapshot` 和 `resource_unavailability` 为显式输入 | 支持窗口和停机；只有 `date` 时自动补 08:00-17:00 | **P0 风险**：隐式班次会改变计划结果 |
| WIP | WIP/齐套刷新，排程结果可追踪 | WIP 必须带路线版本和完成工序证据 | 只按 readiness/earliest_ready_at 延迟或阻断；输出统一 `wip_state=released` | **缺口**：未保留完成工序证据和真实状态 |
| 换型/Setup | 求解器中的换型约束和资源负载 | setup matrix；缺规则默认禁止切换 | 同设备相邻工序才计算；矩阵缺项回退到工序 `setup_minutes` | **P0 风险**：缺换型规则未阻断 |
| 交期与优先级 | `on_time_rate`、`total_tardiness_minutes`、订单级交付判断 | 目标权重含 makespan/tardiness/setup/加班等 | 读取 due/priority 但不参与选择；无 tardiness/on-time 指标 | **核心缺口** |
| 计划版本 | `plan_version`、父版本、输入/solver hash、历史查询 | 服务端持久化、不可变快照、scenario head/CAS | 版本号由 bundle hash 生成，结果只在本次调用内存中存在 | **P0 缺口**：不能恢复、比较或并发保护 |
| 生命周期 | draft → approve → release → dispatch → execution feedback | 同样要求人工 Gate、可暂停/回滚、事件重排 | `run_pmc_v2` 永远返回 `lifecycle_status=draft` | **P0 缺口**：不能形成生产动作闭环 |
| 动态重排 | 事件驱动 replan、手工锁定/解锁、冻结窗口、版本 diff/stability | `replan_m5_schedule` 从服务端权威版本恢复输入 | 当前没有 replan/lock/frozen window 的执行入口 | **缺口** |
| 派工与报工 | MES dispatch、ack/retry、execution event、deviation summary | M5 runtime tables + outbox/执行摘要 | 当前没有持久化派工、回执或执行事件 | **缺口** |
| 前端工作台 | M5 流程看板、排程版本列表、甘特图、资源列、任务状态 | 专业 M5 工作台回到统一 TaskID/trace | 对话结果内嵌表格和简化甘特；没有版本操作、资源负载和派工动作 | **展示可用，专业操作不足** |
| 审计与证据 | trace、input hash、solver input hash、风险和消息 | 每个 snapshot checksum、source/evidence ref、freshness | 有 bundle hash/trace/evidence，但缺逐来源观测时间和持久化 Receipt | **缺口** |

## 4. 当前 PMC 的代码级问题

### P0：缺失事实会被静默补造

- `pmc_v2_adapter.py:37-55`：只给日期时生成 `08:00-17:00` 工作窗口。
- `pmc_v2_adapter.py:63-78`：资源缺少类型、产能或效率时默认 equipment、`60/h`、效率 `1`。
- `pmc_v2_adapter.py:121-125`：路线缺少审批引用时默认 `APPROVED-ROUTE`。
- `pmc_v2_scheduler.py:311-317`：没有设备的工序再使用 `60/h`、效率 `1` 计算时长。

这些默认值与 `pmc_v2_snapshots.py` 顶部“不得创建隐式 machine/person/shift/capacity/availability defaults”的声明相冲突。最小复现（当前工作区）显示：只有一个空资源对象、一个仅含日期的日历和 6 分钟标准工时时，系统仍成功生成 60 分钟排程，并把路线标记为 `APPROVED-ROUTE`。这类结果不能用于生产承诺。

### P0：生产请求可能绕过 v2 输入门禁

`workers.py:192-202` 只在 payload 携带 `pmc_v2`、日历或 `standard_minutes` 时才进入 v2；其他调用走 `workers.py:203-232` 的 legacy 分支。legacy 分支以输入顺序串行累加时长，并在 `processing_minutes/cycle_minutes` 缺失时使用 1 分钟。生产场景应统一进入严格 v2，旧分支只能保留为显式标记的本地兼容测试。

### P0：没有计划持久化和生命周期

`pmc_v2_adapter.py:157-172` 每次调用都重新构造 bundle/hash，返回 `draft`；没有服务端计划表、幂等键冲突、scenario head CAS、人工批准、发布、派工、执行回传、事件序列或回滚。39085 已有这些入口，0902 也将其列为 M5 正式职责。

### P1：贪心排程无法代表 39085 的 PMC 目标

`pmc_v2_scheduler.py:445-564` 对各订单行轮询，候选组合按 `p`（最早开始时间）和输入顺序选择。`due_time`、`priority`、`optimization_weights` 不参与排序，也不计算 tardiness、on-time rate、订单级 makespan 或资源负载。多订单场景下，输入数组顺序会改变结果，不能声称“最优”。

### P1：约束和运行字段尚未接通

适配器当前没有把 0902 合同中的 `order_kitting`、`production_units`、跨单元依赖、manual locks、frozen windows、labor capacity windows/adjustments、material substitutions、BOM、source systems/freshness 和 optimization weights 送进求解器。WIP 输出还把每个已排工序统一标成 `released`，没有保留现场完成工序证据。

### P1：前端只展示结果，不支持 PMC 操作闭环

`AgentWorkspace.tsx:68-83` 只在有操作时渲染表格和简化甘特图。当前没有计划版本历史、输入快照/证据查看、资源负载、审批/发布、锁定/解锁、重排、派工和报工入口；阻断时若没有操作，PMC 详情面板直接不显示。

## 5. 已具备能力与不可误读边界

当前实现仍有可复用基础：

- snapshot 的 `snapshot_id/revision/checksum` 校验和缺失字段阻断；
- 工序前置关系、设备/人员/工装/工位组合和资源占用；
- 工作窗口、停机窗口、WIP `NOT_READY` 延迟/阻断；
- setup、良率折算、确定性 plan hash、trace/evidence 输出；
- 前端可展示工序明细和跨度甘特图。

这些能力只能证明“约束排程内核的开发切片可运行”。它们不能替代 39085 的 CP-SAT 优化和运行时闭环，也不能把 `draft` 结果升级成 `released` 或“可派工”。

## 6. PMC 修复优先级与验收门槛

### P0（先于任何生产验收）

1. 所有 production PMC 请求强制走 v2；legacy 分支加显式 `legacy_preview=true` 且禁止 production。
2. 删除日历、产能、效率、审批引用等隐式默认；缺失统一返回 `BLOCKED_INPUT`，并指出字段路径。
3. 建立 M5 持久化候选/版本表：保存完整 input bundle、checksum、input hash、solver hash、scenario head、父版本、TaskID/trace 和 Receipt；同幂等键重放返回同结果，不同载荷冲突。
4. 实现 approve/release/dispatch/execution/replan 的状态机和 CAS，未通过校验或 `pressure_only` 不得产生生产副作用。

### P1（恢复 39085 的计划价值）

1. 在确定性求解器中接入 due/priority/tardiness、setup/changeover、资源负载和 `optimization_weights`，至少输出 `on_time_rate`、`total_tardiness_minutes`、`resource_load_minutes`。
2. 接入 `order_kitting`、manual locks、frozen windows、production unit 和 labor capacity；每个阻断保留来源引用。
3. 增加版本列表/详情、版本 diff/stability、事件重排和操作锁 API，并在前端显示当前 head 与影响范围。

### P2（操作体验和持续优化）

1. 恢复 M5 流程看板、资源负载视图、派工 ack/retry、执行偏差和报工摘要。
2. 补齐 M5→M3/M4 物料需求/排程影响 proposal 的幂等受理和人工确认。
3. 将 solver/audit/knowledge 作为独立只读产物接回 TaskID/trace，不让 LLM 修改硬约束或事实。

### 最低验收条件

- 缺日历、缺标准工时、缺资源能力、缺 route approval、缺齐套/供应事实时均为 `BLOCKED_INPUT`，且零排程、零生产副作用。
- 相同输入快照和幂等键重复调用返回相同 `plan_version`/结果；不同输入或过期 head 被拒绝。
- 多订单测试同时验证资源不冲突、前置关系、换型、WIP 延迟、交期指标和资源负载。
- 计划只能按 `draft → approved → released → dispatched` 迁移；`pressure_only` 永不进入发布。
- replan 必须从服务端保存版本恢复输入，保留父版本、事件序列和未冻结工序。
- 浏览器验收能查看阻断原因、当前 head、版本差异、资源负载和派工/报工状态，而不是只显示一张结果表。

## 7. 建议的当前版本标注

在代码、前端和交付报告中统一使用：

> `PMC v2 constrained preview / draft only`
> 已实现快照校验与基础资源约束；生产持久化、CP-SAT 目标优化、生命周期、动态重排和派工闭环未完成。

不要使用“PMC 已完成”“可发布排程”“最优解”或“生产已验收”等表述，除非对应 P0/P1 门槛有新鲜测试和目标环境证据。
