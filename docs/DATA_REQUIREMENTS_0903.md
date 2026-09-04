# 0903 数据需求与现有数据优化清单

日期：2026-09-03，微信目录复核更新：2026-09-04
范围：39085、桌面 0902、当前 39092/PMC v2 真实订单链路，以及本机微信/企业微信下载与附件目录
结论（修订）：不能笼统表述为“没有这些数据”。微信目录确实有真实订单、BOM、库存、采购入库、供应商、设备/模具、SOP/IE 时间、手工排产和历史产出；但大多是分散、半结构化或历史汇总，尚未形成可审计生产 snapshot。真实 PMC 仍不能生产放行，首要阻断是生产人员/技能/工位绑定和生产日历，其次是批准路线、设备能力、当前 WIP、物料状态、生产单元映射和执行回传事实。

## 1. 审计依据

- 真实订单验证：[`39092_REAL_DATA_UPLOAD_TEST_20260903.md`](39092_REAL_DATA_UPLOAD_TEST_20260903.md)。订单 `PO-20260812-001` 共 8 行、数量 47000；M0-M5 数据桥接成功，PMC v2 展开 94 个 transfer batches 后因缺少可信工位/人员绑定而 `solver_status=blocked`、`production_blocked=true`。
- WIP 来源审计：[`WIP_PMC_SOURCE_AUDIT_20260903.md`](WIP_PMC_SOURCE_AUDIT_20260903.md)。外置资料有设备编码规则、设备台账、订单、BOM/SOP 和工程文件，但没有可直接用于生产的人员主数据、逐工位绑定表或人员班次日历；`TEST-*` 夹具明确是 `synthetic_fixture` / `test_only`。
- PMC v2 合同：[`../src/yunpai_langgraph/pmc_v2_snapshots.py`](../src/yunpai_langgraph/pmc_v2_snapshots.py)。六类 snapshot 必须有 `snapshot_id`、`revision`、`checksum`；缺审批、资源、工作时段、供应或约束事实时应 `BLOCKED_INPUT`，不能依赖隐式默认。
- 业务目录：`runtime/yunpai-business-catalog.sqlite` 当前约 441 个来源候选，包含 218 个订单、39 个 BOM、22 个 SOP、39 个工程文档/24 个工程图、70 个采购候选和 7 个库存候选；这些记录多为候选/未分类，不能直接当作已批准主数据。
- 微信下载目录全量复核：[`WECHAT_DOWNLOAD_AUDIT_20260904.md`](WECHAT_DOWNLOAD_AUDIT_20260904.md)。覆盖个人微信 `msg/file`（1,078 个文件）和 `msg/attach`（约 30,500 个文件）、`~/Downloads`（约 43,054 个文件）、本机导出目录及企业微信邮件附件；确认真实制造资料存在，同时确认没有可直接放行的全厂人员/技能/工位绑定、生产班次日历、当前 WIP 和 MES 执行事件实体表。

## 2. P0：真实 PMC 生产放行前必须补齐

下列任何一类缺失，排程可以做预览或校验，但不能标记为可投产、可派工。

| 数据类 | 当前情况 | 最小字段/关系 | 交付与验收 |
|---|---|---|---|
| 工位/工作中心主数据 | SOP 有“制作工站”，设备清单和手工排产可作线索，但没有 canonical 工位主表及工序绑定 | `station_id/code/name`、site/production_unit、work_center、状态、并行槽位、`calendar_ref`、能力标签、`effective_from/to`；`operation_code -> station_code`、审批号/版本 | 真实订单所有工序都能映射至少一个有效工位；无 `TEST-*`、无默认工位 |
| 人员主数据与资格 | 有押出部计件/工资的约 18 条人员岗位记录和企业微信公司薪酬名册，但没有全厂生产人员、技能证书和逐工位绑定 | `person_id/code/name`、班组、状态、技能码、资格证书、有效期、可操作工序、绑定工位、`max_parallel`、`calendar_ref`、生效期 | 每个需要人员的工序都有有效人员池；证书未过期；缺绑定即阻断；企业微信含敏感 PII 的名册不得直接导入 |
| 工位/人员/设备日历 | 手工排产有日列、生产日报有日期，但没有生产班次和例外日历 | `calendar_id`、时区、班次起止、休息、节假日、加班、请假、维修、停机/不可用区间、版本、来源观测时间、checksum | 排程区间内所有资源都有有效 working interval；不使用 08:00-17:00 兼容默认值 |
| 批准路线/SOP 工序 | 已找到 HDTV/光纤作业指导书，含工站、IE 秒数、投入人数、材料、设备/模治具和质量要求，但未统一成批准 route snapshot | `product_code`、`route_id/version`、`approval_ref/status`、工序码/名/序号、前置关系、`standard_minutes`、setup/cycle 时间、批量/转移批量、并行、良率、所需工位/设备/技能、有效期 | 每个真实订单行命中一个批准且未过期的路线；工序顺序、数量守恒和资源要求可复核 |
| 设备能力与状态 | 已找到一楼、二楼、测试和白宝设备/模具清单，含名称、型号、数量、状态/用途，但缺统一 ID、能力和实时状态 | `equipment_id/code/type`、工位/工作中心、能力标签、容量基准及单位、效率、状态、维修窗口、工具兼容、观测时间 | 设备能力可转换为分钟/数量；容量、效率、不可用窗口来自事实而非 60/h 默认 |
| 生产单元/工厂映射 | 订单、手工排产、日报和楼层设备资料可提供线索，但未形成统一边界 | `production_unit/site_id`、工厂/楼层/产线、订单/工位/设备/仓库映射、跨单元前后依赖、版本、批准人/时间 | 每条订单和工序唯一归属生产单元；跨单元依赖显式可追踪 |

## 3. P1：保证排程正确性和闭环所需数据

| 数据类 | 当前不足 | 建议字段/规则 |
|---|---|---|
| 订单控制事实 | 多个 XLSX/CSV 和订单压缩包有订单号、日期、交期、数量、已交/未交列，但没有稳定的行级发布控制 | 行级 `order_line_id`、客户、产品别名、需求/确认数量、`release_at`、`due_at`、优先级、状态（hold/cancel/frozen）、站点、UOM 换算、来源系统/版本/观测时间 |
| WIP/当前执行状态 | 生产日报和手工排产提供历史日期/产出/已交未交汇总；仍没有 MES 当前事实、批次边和工序状态 | 订单行/工序/批次 ID、已完成/剩余量、当前工位/人员/设备、开始/结束、前置完成时间、hold/质量状态、`earliest_ready_at`、WIP edge、来源和观测时间 |
| 物料库存与齐套 | 微信附件和 `真实数据.zip` 有 `库存.xls`、采购入库表及订单库存列，但都是即时/汇总值，不能说明可用批次 | 物料码、仓库/库位/批次、现存/可用/已分配/锁定、QC 放行状态、保质期、需求量、分配单、库存快照版本/checksum/观测时间；在途必须有 ETA 和可信度 |
| 采购供应 | 有供应商名录、采购合同/申请和采购入库资料；仍缺逐 PO 行结构化承诺交期、在途和收货/QC 状态 | `supplier_id/name`、PO/行号、物料码、承诺日期、ETA、数量、发运/收货、质检/冻结、来源观测时间和证据；禁止用供应商默认值 |
| 工装/夹具/模具与换型 | 未形成资源快照和换型约束 | 工装码/类型、数量、适用产品/工序、当前占用、状态、维护窗口、`from_family -> to_family` 换型分钟矩阵 |
| 约束与目标 | SOP/IE 时间、手工排产日列和设备用途可作为约束线索，但缺冻结窗、锁定工序和业务目标权重 | `setup_matrix`、换型族、最小/最大批量、冻结窗口、锁定计划、加班边界、交期/迟交/换型/WIP 目标权重 |
| 执行回传/MES 事件 | 尚未形成真实派工和实际反馈闭环 | `event_id`、序列/幂等键、订单行/批次/工序、派工确认、开工/完工、良品/报废、停机原因、实际工位/人员/设备、时间戳、来源系统 |

## 4. 已有数据的优化项

### 4.1 真实订单 XLSX

- 保留原始单元格、sheet、行列位置和文件哈希，同时生成规范化 `order_header` / `order_line` 两层表；不要把表头日期复制成所有订单行事实。
- 稳定区分 `order_id`、`order_line_id`、产品编码和产品名称；维护产品别名表，禁止以名称模糊匹配路线。
- 数量、单价、金额、包装数统一为数值类型，明确空值与零的区别；单位和包装换算写入 `uom_conversion`。
- 将行级交期、发布时间、优先级、冻结/暂停/取消状态补入输入；当前文件只有订单级日期，不能表达同一订单不同产品行的控制要求。
- 库存列改成“库存快照引用”，补仓库、批次、可用/锁定/QC 和观测时间；`in_transit` 不得直接计入可用库存。

### 4.2 BOM 与物料目录

- 目录中虽有 BOM 和成本字段，但存在物料码、用量、供应商等空值及成本表/结构表混杂；拆分物料主表、BOM 头、BOM 行和价格/供应商历史。
- 每个 BOM 行补 `parent_code`、`child_code`、`qty_per`、损耗/良率、单位、替代料、工序消耗点、版本、生效/失效时间和批准状态。
- 统一物料编码和别名，去重同物异码；价格、库存和采购建议都通过 canonical material ID 关联。

### 4.3 SOP、工程文件与路线

- 22 个 SOP、39 个工程文档和 24 个工程图应转成可审计的 `route_snapshot` / `operation` 表，而不是只保留文件候选。
- 每个工序必须保留页码/sheet/cell 或段落证据，并明确标准、准备、循环时间、批量、前置关系、质量门和资源要求。
- 路线发布使用 `route_version + approval_ref + effective_from/to`；新版本不能覆盖历史排程使用的版本。

### 4.4 设备、人员和利用率

- 设备台账需要与工位主表合并 canonical ID，补能力、容量单位、效率、维护和状态历史；当前 `TEST-*` 设备/工位只能留在测试命名空间。
- 利用率分母应使用真实班次、休息、维护和并行槽位；不能用固定 horizon 或兼容默认时间计算“可用率”。
- 人员利用率必须能回溯到人员班次和实际事件，区分计划占用、有效生产、等待、培训和不可用。

### 4.5 采购、来源和质量

- 订单/BOM/SOP/设备/采购候选需增加 `review_status`、canonical revision、冲突处理结果和来源优先级，候选记录不能自动晋级生产事实。
- 所有实体统一保存 `source_system`、`source_ref`、`source_observed_at`、`ingested_at`、`effective_from/to`、`revision`、`checksum`、`approved_by/at`、`confidence` 和 `freshness_sla`。
- 时间统一 ISO-8601 并携带 `+08:00` 或显式时区；不同系统分别保留观测时间，不能共用一个导入时间冒充实时性。

### 4.6 排程参数与生命周期

- `transfer_batch_size` / `batch_size` 应来自批准包装数量、工艺约束或 MES 规则，禁止继续使用 500/10 等测试值；校验拆批后总数量、良率和交期守恒。
- 目标函数至少接收交期、优先级、换型、冻结窗、锁定工序和 WIP 等业务权重；否则结果只能说明“可行”，不能宣称“更优”。
- 计划数据增加 `plan_version`、父版本/CAS、场景用途、校验结果、审批、发布、派工和执行事件引用，支持 draft → approved → released → execution 的可追踪生命周期。

## 5. 建议交付包

第一批建议按下列文件或 API 表交付，字段可用 CSV/JSON，但必须带统一元数据列：`tenant/site`、`source_system`、`source_version`、`observed_at`、`effective_from/to`、`revision`、`checksum`、`approval_ref`。

1. `station_master.csv`、`operation_station_binding.csv`
2. `worker_master.csv`、`worker_qualification.csv`、`worker_station_binding.csv`、`worker_calendar.csv`
3. `equipment_master.csv`、`equipment_calendar.csv`、`tooling_master.csv`、`changeover_matrix.csv`
4. `approved_route.csv` / `sop_operation.csv`
5. `order_lines.csv`（含行级 release/due/priority/status）
6. `inventory_snapshot.csv`、`open_po_supply.csv`、`wip_snapshot.csv`
7. `production_unit_mapping.csv`
8. `execution_events.jsonl` 或 MES 事件 API 合同

## 6. 真实 PMC 验收门槛

补数后固定一个真实订单和时间窗口，必须同时满足：

- 所有订单行均映射到批准且有效的路线、工序、工位、人员/技能、设备和日历；缺失映射不得自动填默认。
- 物料需求均有可用/分配/预计到料状态，库存快照、在途 ETA 和采购承诺可追溯；未知不得当作零或可用。
- 排程满足前置关系、日历边界、资源不重叠、并行槽位、换型和冻结约束，拆批后数量与良率守恒。
- 结果至少为 `solver_status=feasible`，目标验证通过时才可标记 `optimal`；同时 `production_blocked=false`，不含 `BLOCKED_INPUT`、隐式资源或 `TEST-*`。
- 计划具有版本、审批和发布记录；派工确认、开完工、良品/报废和停机事件能回写并与计划对账。
- 同一输入快照重复运行结果可复现，所有 snapshot 有 `snapshot_id/revision/checksum`，并记录来源和新鲜度。

在上述门槛满足前，真实 PMC 的结论应继续标记为“候选/草稿/数据阻断”，不能作为生产排程或派工依据。
