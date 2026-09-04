# 基础数据分层与 PostgreSQL 逻辑表格式

检查日期：2026-09-04

> 本文仅抽取数据库架构报告的第 4、5 部分：基础数据目标分层与关联、PostgreSQL 逻辑表格式（逐表）。其他运行库、导入链路、缺口和验收章节不在本文范围内。

## 1. 基础数据的目标分层与关联

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

## 2. PostgreSQL 逻辑表格式（逐表）

本节是 M0 canonical 的逻辑格式和落地建议，不代表 39092 当前已经存在这些表。建议所有表使用 PostgreSQL schema、RLS 租户隔离、UTC timestamptz 和 UUID/业务编码双重标识。

### 2.1 core.entities：规范实体身份表

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| entity_id | uuid | 否 | PK | 实体内部唯一 ID |
| tenant_id | uuid | 否 | FK/索引 | 租户 ID |
| entity_type | text | 否 | 索引 | 实体类型：product/order/material/supplier/equipment/route/operation/tooling/station/person/document |
| canonical_key | text | 否 | tenant_id + entity_type 联合唯一 | 稳定业务键 |
| canonical_label | text | 否 | - | 规范显示名称 |
| lifecycle_status | text | 否 | draft/active/inactive/retired | 生命周期状态 |
| current_version_id | uuid | 是 | FK | 当前有效版本 ID |
| sensitivity_level | text | 否 | public/internal/confidential/restricted | 敏感级别 |
| created_at | timestamptz | 否 | - | 创建时间 |
| created_by | text | 否 | - | 创建主体 |
| updated_at | timestamptz | 否 | - | 最近更新时间 |
| updated_by | text | 否 | - | 最近修改主体 |
| metadata | jsonb | 否 | 默认 {} | 扩展元数据 |

metadata 元素：external_systems（外部系统映射）、tags（标签数组）、data_owner（数据负责人）、retention_until（保留截止时间）。

### 2.2 core.entity_versions：实体版本事实表

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| entity_version_id | uuid | 否 | PK | 版本 ID |
| entity_id | uuid | 否 | FK | 所属实体 |
| tenant_id | uuid | 否 | FK/索引 | 租户 ID |
| revision | integer | 否 | entity_id 联合唯一，>0 | 版本号 |
| schema_version | text | 否 | JSON Schema 版本 | payload 结构版本 |
| payload | jsonb | 否 | 必须通过 schema 校验 | 业务字段载荷 |
| payload_checksum | char(64) | 否 | SHA-256 | 载荷内容摘要 |
| source_set_id | uuid | 是 | FK | 来源集合 |
| approval_status | text | 否 | candidate/approved/rejected/expired | 审核状态 |
| approval_ref | text | 是 | - | 审批单或 Gate 引用 |
| approved_by | text | 是 | - | 审批主体 |
| approved_at | timestamptz | 是 | - | 审批时间 |
| effective_from | timestamptz | 是 | - | 生效时间 |
| effective_to | timestamptz | 是 | - | 失效时间 |
| task_id | text | 否 | 索引 | 根 Tracking TaskID |
| idempotency_key | text | 否 | 联合索引 | 幂等键 |
| created_at | timestamptz | 否 | - | 写入时间 |
| created_by | text | 否 | - | 写入主体 |

payload 通用元素：source_system（来源系统）、source_ref（来源记录号）、observed_at（观察时间）、status（业务状态）、revision（业务版本）、effective_from/to（生效区间）、approval_ref（审批引用）、attributes（类型扩展属性）。

### 2.3 core.entity_aliases：实体别名表

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| alias_id | uuid | 否 | PK | 别名 ID |
| tenant_id | uuid | 否 | FK | 租户 ID |
| entity_id | uuid | 否 | FK | 对应实体 |
| alias_type | text | 否 | external_code/legacy_code/name | 别名类型 |
| alias_value | text | 否 | 租户、类型、值联合唯一 | 外部编码或历史名称 |
| source_system | text | 否 | - | 来源系统 |
| source_ref | text | 是 | - | 来源记录号 |
| status | text | 否 | active/deprecated/rejected | 别名状态 |
| valid_from | timestamptz | 是 | - | 生效时间 |
| valid_to | timestamptz | 是 | - | 失效时间 |
| evidence_id | uuid | 是 | FK | 证据 ID |
| created_at | timestamptz | 否 | - | 创建时间 |

### 2.4 core.entity_relations：实体关系表

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| relation_id | uuid | 否 | PK | 关系 ID |
| tenant_id | uuid | 否 | FK | 租户 ID |
| relation_type | text | 否 | 关系定义 FK | 关系类型 |
| source_entity_id | uuid | 否 | FK | 起点实体 |
| source_entity_version_id | uuid | 是 | FK | 起点版本 |
| target_entity_id | uuid | 否 | FK | 终点实体 |
| target_entity_version_id | uuid | 是 | FK | 终点版本 |
| sequence_no | integer | 是 | >=0 | 顺序号 |
| quantity | numeric(20,6) | 是 | >=0 | 关系数量 |
| unit | text | 是 | - | 数量单位 |
| attributes | jsonb | 否 | 默认 {} | 关系扩展属性 |
| status | text | 否 | active/inactive/rejected | 关系状态 |
| effective_from | timestamptz | 是 | - | 生效时间 |
| effective_to | timestamptz | 是 | - | 失效时间 |
| evidence_id | uuid | 是 | FK | 关系证据 |
| created_at | timestamptz | 否 | - | 创建时间 |
| created_by | text | 否 | - | 创建主体 |

attributes 元素：scrap_rate（损耗率）、yield_rate（良率）、dependency_type（依赖类型）、capability_required（能力标签数组）、notes（关系备注）。

### 2.5 knowledge.source_assets：来源资产表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| source_asset_id | uuid PK | 否 | 来源资产 ID |
| tenant_id | uuid FK | 否 | 租户 ID |
| source_system | text | 否 | 来源系统 |
| external_id | text | 否 | 来源记录号 |
| uri | text | 是 | 文件或对象存储 URI |
| filename | text | 是 | 原始文件名 |
| mime_type | text | 是 | MIME 类型 |
| size_bytes | bigint | 是 | 文件大小 |
| checksum | char(64) | 否 | SHA-256 |
| observed_at | timestamptz | 是 | 事实观察时间 |
| ingested_at | timestamptz | 否 | 入库时间 |
| classification | text | 是 | order/bom/sop/inventory 等分类 |
| extractor_version | text | 是 | 解析器版本 |
| sensitivity | text | 否 | 敏感级别 |
| retention_class | text | 是 | 保留策略 |
| metadata | jsonb | 否 | 来源扩展信息 |

### 2.6 knowledge.source_occurrences：来源出现位置表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| occurrence_id | uuid PK | 否 | 出现位置 ID |
| source_asset_id | uuid FK | 否 | 来源资产 |
| page_no | integer | 是 | PDF 页码 |
| sheet_name | text | 是 | Excel Sheet |
| row_no | integer | 是 | 行号 |
| column_no | integer | 是 | 列号 |
| json_path | text | 是 | JSON 路径 |
| char_start | integer | 是 | 文本起始位置 |
| char_end | integer | 是 | 文本结束位置 |
| observed_value | jsonb | 是 | 原始观察值 |
| locator | jsonb | 否 | 复合定位 |
| observed_at | timestamptz | 是 | 观察时间 |
| extractor_version | text | 是 | 抽取器版本 |
| created_at | timestamptz | 否 | 创建时间 |

### 2.7 knowledge.evidence_anchors：证据锚点表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| evidence_id | uuid PK | 否 | 证据 ID |
| occurrence_id | uuid FK | 否 | 来源位置 |
| anchor_type | text | 否 | page/cell/paragraph/api_record |
| locator | jsonb | 否 | 精确定位 |
| quote_hash | char(64) | 否 | 证据片段摘要 |
| evidence_summary | text | 是 | 脱敏摘要 |
| confidence | numeric(5,4) | 否 | 置信度，0 到 1 |
| created_at | timestamptz | 否 | 创建时间 |
| created_by | text | 否 | 创建主体 |

### 2.8 knowledge.field_claims：字段声明表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| claim_id | uuid PK | 否 | 声明 ID |
| tenant_id | uuid | 否 | 租户 ID |
| entity_id | uuid | 是 | 实体 ID |
| entity_version_id | uuid | 是 | 版本 ID |
| candidate_record_id | uuid | 是 | 候选记录 |
| field_path | text | 否 | 规范字段路径 |
| value | jsonb | 否 | 声明值 |
| normalized_value | jsonb | 是 | 归一化值 |
| physical_type | text | 否 | string/number/date/object |
| semantic_type | text | 是 | product_code/quantity/due_date 等 |
| unit | text | 是 | 单位 |
| confidence | numeric(5,4) | 否 | 置信度 |
| claim_status | text | 否 | candidate/approved/rejected/superseded |
| evidence_id | uuid | 是 | 证据 ID |
| source_priority | integer | 是 | 来源优先级 |
| valid_from | timestamptz | 是 | 生效时间 |
| valid_to | timestamptz | 是 | 失效时间 |
| resolved_by | text | 是 | 裁决主体 |
| resolved_at | timestamptz | 是 | 裁决时间 |
| created_at | timestamptz | 否 | 创建时间 |

### 2.9 knowledge.relationship_claims：关系声明表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| relationship_claim_id | uuid PK | 否 | 关系声明 ID |
| tenant_id | uuid | 否 | 租户 ID |
| source_identity | jsonb | 否 | 起点候选身份 |
| relation_type | text | 否 | 关系类型 |
| target_identity | jsonb | 否 | 终点候选身份 |
| attributes | jsonb | 否 | 关系属性 |
| confidence | numeric(5,4) | 否 | 置信度 |
| claim_status | text | 否 | candidate/approved/rejected/superseded |
| evidence_id | uuid | 是 | 关系证据 |
| resolved_by | text | 是 | 裁决主体 |
| resolved_at | timestamptz | 是 | 裁决时间 |
| created_at | timestamptz | 否 | 创建时间 |

source_identity/target_identity 元素：entity_type（实体类型）、canonical_key（业务键）、label（显示名称）、source_ref（来源引用）。

### 2.10 staging.structured_records：结构化导入记录表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| record_id | uuid PK | 否 | 记录 ID |
| batch_id | uuid | 否 | 导入批次 |
| source_asset_id | uuid | 否 | 来源资产 |
| tenant_id | uuid | 否 | 租户 |
| template_version | text | 否 | 模板版本 |
| entity_type | text | 否 | 目标实体类型 |
| row_key | text | 否 | 来源行稳定键 |
| raw_record | jsonb | 否 | 原始行数据 |
| normalized_record | jsonb | 是 | 归一化行数据 |
| parse_status | text | 否 | parsed/failed/partial |
| review_status | text | 否 | candidate/approved/rejected |
| validation_issues | jsonb | 否 | 校验问题数组 |
| task_id | text | 否 | 根 TaskID |
| idempotency_key | text | 否 | 幂等键 |
| created_at | timestamptz | 否 | 创建时间 |

### 2.11 staging.field_candidates：字段候选表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| field_candidate_id | uuid PK | 否 | 字段候选 ID |
| record_id | uuid FK | 否 | 导入记录 |
| field_path | text | 否 | 目标字段路径 |
| source_column | text | 是 | 来源列名 |
| raw_value | jsonb | 否 | 原始值 |
| normalized_value | jsonb | 是 | 归一化值 |
| physical_type | text | 否 | 物理类型 |
| semantic_type | text | 是 | 语义类型 |
| unit | text | 是 | 单位 |
| confidence | numeric(5,4) | 否 | 置信度 |
| mapping_status | text | 否 | proposed/confirmed/rejected |
| evidence_id | uuid | 是 | 证据 |
| validation_issues | jsonb | 否 | 校验问题 |
| created_at | timestamptz | 否 | 创建时间 |

### 2.12 staging.identity_candidates：身份匹配候选表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| identity_candidate_id | uuid PK | 否 | 身份候选 ID |
| record_id | uuid FK | 否 | 导入记录 |
| entity_type | text | 否 | 实体类型 |
| proposed_key | text | 否 | 建议业务键 |
| proposed_label | text | 是 | 建议名称 |
| matched_entity_id | uuid | 是 | 已匹配实体 |
| match_method | text | 是 | exact/alias/manual/fuzzy |
| match_score | numeric(5,4) | 是 | 匹配分数 |
| conflict_type | text | 是 | 同码异名/异单位等 |
| review_status | text | 否 | pending/approved/rejected |
| resolved_by | text | 是 | 裁决主体 |
| resolved_at | timestamptz | 是 | 裁决时间 |
| evidence_id | uuid | 是 | 身份证据 |
| created_at | timestamptz | 否 | 创建时间 |

### 2.13 staging.relationship_candidates：关系匹配候选表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| relationship_candidate_id | uuid PK | 否 | 关系候选 ID |
| record_id | uuid FK | 否 | 导入记录 |
| source_candidate_id | uuid | 否 | 起点候选 |
| relation_type | text | 否 | 关系类型 |
| target_candidate_id | uuid | 否 | 终点候选 |
| attributes | jsonb | 否 | 关系属性 |
| confidence | numeric(5,4) | 否 | 置信度 |
| review_status | text | 否 | pending/approved/rejected |
| evidence_id | uuid | 是 | 关系证据 |
| validation_issues | jsonb | 否 | 校验问题 |
| created_at | timestamptz | 否 | 创建时间 |

### 2.14 audit.audit_events：审计事件表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| audit_event_id | uuid PK | 否 | 审计事件 ID |
| tenant_id | uuid | 否 | 租户 |
| task_id | text | 否 | 根 TaskID |
| event_type | text | 否 | ingest/review/publish/revoke/rollback |
| actor_type | text | 否 | user/agent/service |
| actor_id | text | 否 | 操作主体 |
| entity_type | text | 是 | 实体类型 |
| entity_id | uuid | 是 | 实体 ID |
| entity_version_id | uuid | 是 | 版本 ID |
| before_checksum | char(64) | 是 | 变更前摘要 |
| after_checksum | char(64) | 是 | 变更后摘要 |
| event_payload | jsonb | 否 | 脱敏事件详情 |
| correlation_id | text | 是 | 链路关联 ID |
| occurred_at | timestamptz | 否 | 事件发生时间 |
| result | text | 否 | success/rejected/failed |
| created_at | timestamptz | 否 | 入库时间 |

### 2.15 audit.ingest_ledgers：导入台账表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| ledger_id | uuid PK | 否 | 台账 ID |
| tenant_id | uuid | 否 | 租户 |
| batch_id | uuid | 否 | 导入批次 |
| task_id | text | 否 | 根 TaskID |
| idempotency_key | text | 否 | 幂等键 |
| operation | text | 否 | insert/update/rollback |
| entity_version_id | uuid | 是 | 写入版本 |
| write_checksum | char(64) | 否 | 写入摘要 |
| status | text | 否 | prepared/committed/rolled_back/failed |
| committed_at | timestamptz | 是 | 提交时间 |
| rolled_back_at | timestamptz | 是 | 回滚时间 |
| rollback_reason | text | 是 | 回滚原因 |
| created_at | timestamptz | 否 | 创建时间 |

### 2.16 audit.projection_outbox：投影 Outbox 表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| outbox_id | uuid PK | 否 | Outbox 事件 ID |
| tenant_id | uuid | 否 | 租户 |
| aggregate_type | text | 否 | 聚合类型 |
| aggregate_id | uuid | 否 | 聚合实体 ID |
| aggregate_version_id | uuid | 是 | 聚合版本 |
| event_type | text | 否 | entity_published/relation_changed |
| payload | jsonb | 否 | 投影事件载荷 |
| payload_checksum | char(64) | 否 | 载荷摘要 |
| task_id | text | 否 | 根 TaskID |
| status | text | 否 | pending/processing/delivered/failed |
| attempts | integer | 否 | 投递次数 |
| next_attempt_at | timestamptz | 是 | 下次重试时间 |
| last_error | text | 是 | 最近错误 |
| created_at | timestamptz | 否 | 创建时间 |
| delivered_at | timestamptz | 是 | 投递成功时间 |


