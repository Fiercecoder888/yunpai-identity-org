# 云湃项目数据库与基础数据架构报告

检查日期：2026-09-04
检查范围：当前仓库源码、M0-M5 工具合同、runtime/*.sqlite 实际数据库文件及现有验收文档。

## 1. 结论摘要

当前项目采用分层数据库架构：

业务文件/上传
  -> 编排层候选目录 SQLite
  -> 人工审核/Gate
  -> M0 canonical PostgreSQL
  -> ledger / Outbox
  -> Neo4j、搜索等可重建投影

编排运行库 SQLite 独立保存 RunState、步骤、Gate 和 trace。

仓库内真正落地并可直接检查的是两个 SQLite：运行库和业务资料候选库。yunpai-business-catalog.sqlite 只保存来源文件、分类候选和字段证据，不是产品、订单、物料等生产主数据。生产设计以 M0 PostgreSQL 为跨模块权威事实源；M1-M5 应通过 M0 合同消费事实。Neo4j/搜索属于 PostgreSQL 的投影，不能反向成为事实源。

当前候选库没有 canonical 实体表；39092 的 M0 HTTP 接口和生产 PostgreSQL 未在本次环境中完成可验证回读，因此不能宣称基础数据已进入生产 canonical。

## 2. 当前数据库清单

| 数据库 | 技术/位置 | 实际结构 | 用途与边界 |
|---|---|---|---|
| 运行库 | SQLite，runtime/yunpai-runs.sqlite | runs 1 张表 | 保存一次 Agent 运行的完整 RunState JSON、状态、租户、task/run ID；支持重启后恢复 Gate。 |
| 业务资料候选库 | SQLite，runtime/yunpai-business-catalog.sqlite | ingest_batches、source_files、document_candidates、field_observations | 资料识别、哈希、候选抽取、字段证据和人工审核前暂存；不直接发布 canonical。 |
| 验证快照库 | SQLite，runtime/real-*.sqlite | 均只有 runs 表，每个文件 1 条 run | 订单上传/PMC v2 回归验证快照，不是独立业务主数据源。 |
| 生产事实库（设计目标） | PostgreSQL，由 M0 服务持有 | 仓库未包含实际 schema/migration | 保存 canonical 实体、版本、来源、证据、ledger、Outbox，以及 M0-M5 共用的正式事实。 |
| 生产投影（设计目标） | Neo4j、搜索/向量索引 | 仓库未部署 | 从 PostgreSQL 重建的关系/检索投影，不具备事实写入权。 |

所有 SQLite 文件执行 PRAGMA integrity_check 均返回 ok。项目使用标准库 sqlite3，没有在本项目中引入 ORM 或跨模块共享 SQL。

## 3. 已落地 SQLite schema

### 3.1 业务资料候选库

| 表 | 关键字段 | 关系/用途 |
|---|---|---|
| ingest_batches | batch_id、root_path、schema_version、状态、文件数、summary_json | 一次目录/上传导入的批次边界。 |
| source_files | file_id、路径、文件名、扩展名、MIME、大小、修改时间、sha256、file_kind、分类置信度、状态 | 原始来源登记；UNIQUE(absolute_path, sha256) 保证按路径+内容哈希幂等。 |
| document_candidates | document_id、file_id、文档类型、订单号、产品编码、置信度、review_status、payload_json、校验问题 | 一个来源文件对应一个候选文档；候选可进入人工审核，但不等于主数据。 |
| field_observations | observation_id、document_id、字段路径、原值/归一化值、物理/语义类型、单位、置信度、evidence_json | 保存字段级证据定位，支持回看原文件位置和哈希。 |

实测规模：4 个批次；441 个来源文件/441 个候选文档；179 条字段观察。分类为订单 218、采购 70、BOM 39、工程文档 39、工程图 24、SOP 22、库存 7、普通表格 7、普通文档 6、其他 7、压缩包 2。候选审核状态中 440 条为 unclassified，1 条订单为 needs_review，没有已发布 canonical 记录。

### 3.2 运行库

runs 表字段为 run_id 主键、task_id、tenant_id、status、state_json、updated_at。业务实体没有拆成关系表，而是完整保存在 state_json，由 RunState 结构约束：计划、步骤、工具结果、证据、审批、pending_gate、错误和 trace 均随运行保存。

实测规模：yunpai-runs.sqlite 有 18 条运行记录：completed 6、failed 3、queued 5、waiting_human 4。每个 runtime/real-*.sqlite 验证快照含 1 条运行记录。

## 4. 基础数据的目标分层与关联

正式基础数据应在 M0 PostgreSQL 采用“稳定身份 + 可版本化事实 + 来源证据”的模型：

| 基础数据类 | 规范身份/版本建议 | 关键关联 | 消费方 |
|---|---|---|---|
| 产品 | product_code 稳定身份，产品版本/状态单独管理 | 产品 -> BOM、路线、订单行 | M0/M1/M2/M3/M5 |
| 订单 | order_id + 行级 order_line_id | 订单行 -> 产品、需求数量、交期、优先级、发布状态 | M0/M3/M5 |
| 物料 | material_code 稳定身份，名称/规格/单位/别名 | 物料 -> BOM、供应商、库存、采购 | M0/M2/M3/M4 |
| BOM | BOM 头版本 + BOM 行 | 产品 -> BOM；BOM 行 -> 子物料、用量、损耗/替代料 | M0/M2/M3 |
| 供应商 | supplier_code 稳定身份 | 供应商 -> 可供物料、采购订单、承诺交期 | M0/M4 |
| 设备 | equipment_code 稳定身份 | 设备 -> 工位/产线、能力、状态、路线工序 | M0/M5 |
| 工艺路线 | route_code + revision | 产品 -> 批准路线 -> 工序序列 | M0/M2/M5 |
| 工序 | operation_code 稳定身份 | 路线 -> 工序；工序 -> 物料/设备/工装/工位 | M0/M2/M5 |
| 工装/模具 | tooling_code 稳定身份 | 工序 -> 所需工装；工装 -> 状态/占用/换型 | M0/M5 |
| 工位/工作中心 | station_code 稳定身份 | 工序 -> 可执行工位；工位 -> 生产单元/日历 | M0/M5 |
| 人员/资格 | person_id + qualification/有效期 | 人员 -> 技能/工序/工位绑定、班次日历 | M5 |
| 库存/供应/WIP | 快照 ID + revision + checksum | 物料 -> lot/仓库/可用量；订单行/工序 -> WIP 与供应分配 | M3/M4/M5 |
| 生产日历/约束 | calendar/constraint snapshot | 资源 -> 工作时段、停机、维护、冻结窗、换型矩阵 | M5 |
| 执行事件 | event_id/幂等键 | 订单行/批次/工序 -> 派工、开完工、良品/报废、停机 | M5/M3/M4 |

PMC v2 消费带 snapshot_id、revision、checksum 的订单、路线、资源、日历、供应和约束快照。缺少可信快照时应返回 BLOCKED_INPUT，不得填充默认工位、人员、产能或工作时间。

## 5. PostgreSQL 逻辑表格式（逐表）

本节依据项目功能/架构文档和 M0 工具合同整理。仓库没有实际 PostgreSQL migration；以下是 M0 canonical 的逻辑格式和落地建议，不代表 39092 当前已经存在这些表。建议所有表使用 PostgreSQL schema、RLS 租户隔离、UTC timestamptz 和 UUID/业务编码双重标识。

### 5.1 core：规范事实

| 表 | 主键/唯一键 | 字段元素（建议类型） | 作用与约束 |
|---|---|---|---|
| core.entities | entity_id uuid；(tenant_id, entity_type, canonical_key) unique | tenant_id uuid、entity_type text、canonical_key text、canonical_label text、lifecycle_status enum(active/inactive/draft/retired)、current_version_id uuid、created_at/updated_at timestamptz、created_by/updated_by text、metadata jsonb | 稳定实体身份。产品、订单、物料、供应商、设备、路线、工序、工装、工位、人员、文档均可作为 entity_type；不在此表覆盖可变业务字段。 |
| core.entity_versions | entity_version_id uuid；(entity_id, revision) unique | entity_id uuid FK、revision int、schema_version text、payload jsonb、payload_checksum char(64)、effective_from/to timestamptz、approval_status enum(candidate/approved/rejected/expired)、approved_by/approved_at、source_set_id uuid、task_id text、created_at timestamptz | 不可变版本事实。payload 保存该类型的业务字段；禁止原地更新已批准版本，修订必须新增 revision。 |
| core.entity_aliases | alias_id uuid；(tenant_id, alias_type, alias_value) unique | entity_id uuid FK、alias_type text（外部编码/旧料号/名称）、alias_value text、source_system text、valid_from/to timestamptz、status text、evidence_id uuid | 外部系统编码、历史名称和别名映射；禁止用模糊名称直接关联生产事实。 |
| core.entity_relations | relation_id uuid；建议 (tenant_id, relation_type, source_entity_version_id, target_entity_version_id) unique | relation_type text、source_entity_id/version_id uuid、target_entity_id/version_id uuid、quantity numeric、unit text、sequence_no int、effective_from/to timestamptz、status text、evidence_id uuid、metadata jsonb | 有方向关系和边属性。典型关系：产品-BOM、BOM-物料、供应商-物料、路线-工序、工序-设备/工装/工位、人员-技能/工位。端点类型、方向、基数由 relation_type_definitions 校验。 |

### 5.2 knowledge：来源与证据

| 表 | 主键/唯一键 | 字段元素（建议类型） | 作用与约束 |
|---|---|---|---|
| knowledge.source_assets | source_asset_id uuid；(tenant_id, source_system, external_id, checksum) unique | source_system text、external_id text、uri/path text、filename text、mime_type text、size_bytes bigint、checksum char(64)、observed_at timestamptz、ingested_at timestamptz、classification text、retention_class text、sensitivity text、metadata jsonb | 原始文件/接口响应的登记和内容指纹。生产库保存引用和哈希，原始敏感文件按权限存放，不把全文无控制地塞入 canonical。 |
| knowledge.source_occurrences | occurrence_id uuid | source_asset_id uuid FK、page_no/sheet_name/row_no/column_no text/int、json_path text、char_start/end int、observed_value jsonb、observed_at timestamptz、extractor_version text | 同一来源中一次出现的位置；支持精确回溯到页、Sheet、行列或 JSON 路径。 |
| knowledge.evidence_anchors | evidence_id uuid | occurrence_id uuid FK、anchor_type text、locator jsonb、quote_hash char(64)、confidence numeric、created_at timestamptz | 字段/关系声明使用的证据锚点。locator 只保存定位和脱敏摘要，quote_hash 用于校验原文未漂移。 |
| knowledge.field_claims | claim_id uuid | subject_entity_id/version_id uuid、field_path text、value jsonb、normalized_value jsonb、unit text、confidence numeric、claim_status enum(candidate/approved/rejected/superseded)、evidence_id uuid、source_priority int、valid_from/to timestamptz | “某实体某字段取某值”的可审计声明。批准后才可写入 entity_versions.payload；冲突声明并存，不能静默覆盖。 |
| knowledge.relationship_claims | relationship_claim_id uuid | source_identity jsonb、relation_type text、target_identity jsonb、attributes jsonb、confidence numeric、claim_status、evidence_id uuid、valid_from/to timestamptz | 关系候选及其证据；通过实体身份解析后才升级为 core.entity_relations。 |

### 5.3 staging：导入与审核候选

| 表 | 主键/唯一键 | 字段元素（建议类型） | 作用与约束 |
|---|---|---|---|
| staging.structured_records | record_id uuid；(batch_id, source_asset_id, row_key) unique | batch_id uuid、source_asset_id uuid、tenant_id uuid、template_version text、entity_type text、row_key text、raw_record jsonb、normalized_record jsonb、parse_status text、review_status text、validation_issues jsonb、task_id text、created_at | CSV/Excel/JSON 等结构化行的原始与归一化记录；只做 staging，不被 M3-M5 直接消费。 |
| staging.field_candidates | field_candidate_id uuid | record_id uuid FK、field_path text、raw_value jsonb、normalized_value jsonb、physical_type text、semantic_type text、unit text、confidence numeric、mapping_status text、evidence_id uuid、validation_issues jsonb | 字段级抽取、类型和单位候选；用于字段映射和人工修正。 |
| staging.identity_candidates | identity_candidate_id uuid | record_id uuid FK、entity_type text、proposed_key text、matched_entity_id uuid、match_method text、match_score numeric、conflict_type text、review_status text、resolved_by/at | 新实体、别名匹配、同码异名/异单位冲突的裁决队列。 |
| staging.relationship_candidates | relationship_candidate_id uuid | record_id uuid FK、source_candidate_id uuid、relation_type text、target_candidate_id uuid、attributes jsonb、confidence numeric、review_status text、evidence_id uuid | 产品-BOM、BOM-物料、路线-工序等待审核关系；端点未解析前不得发布。 |

### 5.4 audit：审计、批次和发布收据

| 表 | 主键/唯一键 | 字段元素（建议类型） | 作用与约束 |
|---|---|---|---|
| audit.audit_events | audit_event_id uuid | tenant_id uuid、task_id text、event_type text、actor_type enum(user/agent/service)、actor_id text、entity_type/key/version、before_checksum/after_checksum char(64)、payload jsonb（脱敏）、occurred_at timestamptz、correlation_id text、result text | 记录导入、审核、发布、撤回、失效、回滚和权限决定；只追加，不允许删除或覆盖历史审计。 |
| audit.ingest_ledgers | ledger_id uuid（如部署实现拆表） | batch_id uuid、task_id text、idempotency_key text、operation text、entity_version_id uuid、write_checksum char(64)、status text、committed_at/rolled_back_at timestamptz、rollback_reason text | 发布事务的逐笔收据和回滚边界。项目合同明确 ledger 可回滚；若实现为 audit.audit_events 的事件类型，也必须具备同等字段。 |
| audit.projection_outbox | outbox_id uuid | aggregate_type/key/version、event_type text、payload jsonb、payload_checksum char(64)、task_id text、status enum(pending/processing/delivered/failed)、attempts int、next_attempt_at timestamptz、last_error text、created_at/delivered_at | PostgreSQL 提交后驱动 Neo4j/全文/向量投影。投影失败不得回滚 canonical，但必须可重试、可观测。 |

### 5.5 业务 payload 的最小字段集合

通用 core.entity_versions 使用 JSONB，但每种 entity_type 必须绑定 schema_version 和 JSON Schema。建议最小字段如下：

| entity_type | payload 必备元素 |
|---|---|
| product | product_code、name、family_code、uom、status、revision、effective_from/to |
| order | order_id、customer、order_date、release_at、due_at、priority、status、site、lines[] |
| order_line | order_line_id、product_code、required_qty、uom、due_at、release_at、priority、status |
| material | material_code、name、specification、uom、aliases[]、status |
| bom | bom_code、product_code、revision、approval_ref、effective_from/to、lines[] |
| bom_line | line_no、parent_code、child_material_code、qty_per、uom、scrap_rate、substitutes[]、operation_code |
| supplier | supplier_code、name、legal_id、status、material_codes[] |
| equipment | equipment_code、name、equipment_type、station_code、capacity、capacity_uom、efficiency、status |
| route | route_code、revision、product_code、approval_ref、operations[] |
| operation | operation_code、name、sequence_no、standard_minutes、setup_minutes、yield_rate、station_codes[]、equipment_codes[]、tooling_codes[]、skill_codes[] |
| station | station_code、name、production_unit、work_center、parallel_slots、calendar_ref、capability_tags[]、status |
| person | person_id、team、status、skill_codes[]、qualification_refs[]、station_codes[]、calendar_ref |
| inventory_snapshot | snapshot_id、observed_at、warehouse、lots[]（material_code、lot_no、on_hand_qty、available_qty、allocated_qty、qc_status、available_at） |
| supply_snapshot / wip_snapshot | snapshot_id、observed_at、order_line_id、material/operation/batch 标识、required_qty、allocated_qty、remaining_qty、readiness、earliest_ready_at、source_ref |

公共元数据建议不要只放在 payload：tenant_id、source_system、source_ref、observed_at、revision、checksum、approval_ref、created_at、updated_at 应作为可索引列或版本表字段保存；敏感字段单独分级并按 RLS/列权限控制。

## 6. 导入、审核和发布链路

1. M1/business-data-identification 从目录或上传文件识别类型，计算 SHA-256，写入候选目录 SQLite。
2. 解析结果保留 sheet/行/字段路径、原值、归一化值和来源证据；大文件可延迟到 M1 专项解析。
3. Planner/Reviewer 打开 candidate Gate；低置信、冲突或缺字段的候选必须人工裁决。
4. M0 data_catalog_ingest_validate 做 schema、稳定编码、来源哈希、审核状态、引用和幂等冲突校验，不写生产库。
5. M0 data_catalog_ingest_publish 或各实体导入 facade 在一个 PostgreSQL canonical transaction 中写入实体、版本、来源、索引关系和 projection Outbox。
6. 发布产生 ledger，可按批次回滚；候选、原始来源和证据保留。M1-M5 只能消费已审核 canonical 或固定 snapshot。

## 7. 当前缺口与风险

- 候选 SQLite 目前没有产品、订单、物料、供应商、设备、路线、工序、工装、工位、人员、财务或 ledger/outbox canonical 表。
- 39092 当前 M0 HTTP 路径不可达，生产 PostgreSQL 连接、schema/migration、审核权限及回读接口未提供；运行状态中的 committed/master_counts 字段不足以证明真实写入。
- 真实资料虽包含订单、BOM、库存、采购、供应商、设备/模具、SOP/IE 时间和历史排产，但生产人员技能/工位绑定、班次日历、当前 WIP、MES 执行事件仍未形成可放行实体。
- 不能把候选状态 unclassified 当成批准主数据，也不能把测试快照、TEST-* 资源或本地 fixture 当生产事实。
- 运行库将状态整体存为 JSON，适合单机恢复和审计，不适合直接承担跨模块查询、并发事务、主数据约束或生产报表。

## 8. 建议实施优先级

P0：打通 M0 事实链路。提供受控 M0 URL、PostgreSQL schema/migration、租户/RBAC、审核和回读权限；先完成产品、订单、物料、BOM、供应商、设备、路线、工序、工装 canonical 导入；验证幂等冲突、ledger、Outbox、回滚和回读。

P1：补齐可排产基础数据。建立工位/工作中心、人员资格与工位绑定、设备能力、生产单元映射和真实生产日历；将 SOP/IE 资料转成批准的 route/operation snapshot；建立库存 lot、采购承诺、WIP 工序状态和质量冻结快照。

P2：形成执行闭环。接入 MES 派工、开工、完工、良品/报废、停机事件，使用幂等 event_id 回写并与计划对账；PostgreSQL 为唯一写入事实源，Neo4j/搜索按版本和 checksum 增量重建；生产规模下实现 PostgreSQL repository。

## 9. 验收标准

- 所有订单行都能映射到有效产品、批准路线、工序、工位、人员/技能、设备和日历。
- 物料库存、采购在途和 WIP 都有快照版本、观测时间、来源和可用性状态；未知不等于零或可用。
- canonical 发布具备审核、版本、来源、checksum、ledger、Outbox 和回滚证据。
- PMC 输入快照可复现，资源不重叠、数量守恒、日历和换型约束通过；无 BLOCKED_INPUT 或隐式默认资源。
- 执行事件能够按订单行/批次/工序回读，并与已发布计划建立可审计关联。

## 10. 证据来源

- src/yunpai_langgraph/business_catalog.py：候选库 schema、分类、抽取与幂等实现。
- src/yunpai_langgraph/repository.py、models.py：运行库 schema 与 RunState。
- registry/tool-manifests/m0.json、docs/M0_M5_FUNCTION_REFERENCE.md：canonical 导入、版本、证据、ledger/Outbox 合同。
- docs/PRODUCT_AND_FUNCTION_ARCHITECTURE.md、docs/ARCHITECTURE.md：PostgreSQL 权威事实与投影边界。
- docs/M0_GB10_INGEST_RECONCILIATION_20260904.md、docs/DATA_REQUIREMENTS_0903.md：当前 GB10 接入和生产数据缺口结论。
- 本次只读实测：sqlite3 runtime/*.sqlite '.tables'、.schema、PRAGMA integrity_check 及候选/运行记录统计。
