# PostgreSQL Canonical 数据字典（逻辑版）

检查日期：2026-09-04
适用范围：M0 canonical 事实库，以及与 M0 配套的来源、候选、审核和投影发布表。

## 0. 重要说明

本项目仓库没有可执行的 PostgreSQL migration，也没有提供当前生产数据库连接。本文件依据以下内容整理：

- M0-M5 架构文档中规定的 core、knowledge、staging、audit 表族；
- registry/tool-manifests/m0.json 的导入合同；
- M0-M5 功能参考中的实体、版本、来源、证据、ledger、Outbox 约束。

因此，以下是应落地的逻辑数据字典，不是对当前 39092 实例的实际表结构回读。真正实施时应以 Alembic/SQL migration 为准，并补充索引、RLS、分区和枚举定义。

建议统一约定：

- 所有表带 tenant_id，使用 uuid；跨租户查询由 PostgreSQL Row-Level Security 限制。
- 时间使用 timestamptz，统一存 UTC；展示时转换为 Asia/Shanghai。
- 内容摘要和来源指纹使用 char(64) 保存 SHA-256 十六进制值。
- 业务稳定编码使用 text；数据库内部关联使用 uuid。
- 业务事实版本不可覆盖更新，只能新增 revision。
- JSONB 仅承载类型可变的业务 payload；可过滤、关联、权限判断的字段应提升为独立列。
- 敏感字段（人员身份、工资、财务、联系方式）必须列级权限或脱敏存储。

## 1. 表总览

| Schema | 表 | 中文名称 | 数据性质 |
|---|---|---|---|
| core | entities | 规范实体身份表 | canonical |
| core | entity_versions | 实体版本事实表 | canonical |
| core | entity_aliases | 实体别名表 | canonical |
| core | entity_relations | 实体关系表 | canonical |
| knowledge | source_assets | 来源资产表 | 来源证据 |
| knowledge | source_occurrences | 来源出现位置表 | 来源证据 |
| knowledge | evidence_anchors | 证据锚点表 | 来源证据 |
| knowledge | field_claims | 字段声明表 | 候选/事实证据 |
| knowledge | relationship_claims | 关系声明表 | 候选/事实证据 |
| staging | structured_records | 结构化导入记录表 | staging |
| staging | field_candidates | 字段候选表 | staging |
| staging | identity_candidates | 身份匹配候选表 | staging |
| staging | relationship_candidates | 关系匹配候选表 | staging |
| audit | audit_events | 审计事件表 | 只追加审计 |
| audit | ingest_ledgers | 导入台账表 | 发布/回滚 |
| audit | projection_outbox | 投影 Outbox 表 | 异步投影 |

## 2. core.entities：规范实体身份表

一行代表一个长期稳定的业务对象身份，不保存完整可变业务内容。

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| entity_id | uuid | 否 | PK | 实体内部唯一 ID |
| tenant_id | uuid | 否 | FK/索引 | 租户 ID |
| entity_type | text | 否 | 索引 | 实体类型，如 product、order、material、supplier、equipment、route、operation、tooling、station、person、document |
| canonical_key | text | 否 | 与 tenant_id、entity_type 联合唯一 | 稳定业务键，如产品编码、物料编码、订单号 |
| canonical_label | text | 否 | - | 面向用户显示的规范名称 |
| lifecycle_status | text | 否 | 枚举 | 生命周期：draft、active、inactive、retired |
| current_version_id | uuid | 是 | FK 到 entity_versions | 当前有效版本 ID |
| sensitivity_level | text | 否 | 枚举 | public、internal、confidential、restricted |
| created_at | timestamptz | 否 | - | 创建时间 |
| created_by | text | 否 | - | 创建主体 |
| updated_at | timestamptz | 否 | - | 最近更新时间 |
| updated_by | text | 否 | - | 最近修改主体 |
| metadata | jsonb | 否 | 默认 {} | 非核心扩展元数据 |

metadata 内部元素：

| 元素 | 类型 | 中文含义 |
|---|---|---|
| external_systems | jsonb array | 外部系统映射摘要 |
| tags | text array | 标签 |
| data_owner | text | 业务数据负责人 |
| retention_until | timestamptz | 数据保留截止时间 |

## 3. core.entity_versions：实体版本事实表

一行代表一个实体在某个 revision 下的不可变事实版本。

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| entity_version_id | uuid | 否 | PK | 版本内部唯一 ID |
| entity_id | uuid | 否 | FK | 所属实体身份 |
| tenant_id | uuid | 否 | FK/索引 | 租户 ID |
| revision | integer | 否 | 同 entity_id 联合唯一，>0 | 版本号 |
| schema_version | text | 否 | 如 m0.product.v1 | payload 结构版本 |
| payload | jsonb | 否 | JSON Schema 校验 | 该版本业务字段 |
| payload_checksum | char(64) | 否 | SHA-256 | payload 内容摘要 |
| source_set_id | uuid | 是 | FK/索引 | 该版本引用的来源集合 |
| approval_status | text | 否 | candidate、approved、rejected、expired | 审核状态 |
| approval_ref | text | 是 | - | 审批单、审批号或 Gate 引用 |
| approved_by | text | 是 | - | 审批人/审批服务 |
| approved_at | timestamptz | 是 | - | 审批时间 |
| effective_from | timestamptz | 是 | - | 生效时间 |
| effective_to | timestamptz | 是 | - | 失效时间，空表示未设定 |
| task_id | text | 否 | 索引 | 根 Tracking TaskID |
| idempotency_key | text | 否 | 与 tenant_id、task_id 联合索引 | 幂等键 |
| created_at | timestamptz | 否 | - | 写入时间 |
| created_by | text | 否 | - | 写入主体 |

payload 通用元素：

| 元素 | 类型 | 中文含义 |
|---|---|---|
| source_system | text | 来源系统 |
| source_ref | text | 来源系统中的记录号 |
| observed_at | timestamptz | 来源事实观察时间 |
| status | text | 该业务对象状态 |
| revision | integer | 对外版本号 |
| effective_from | timestamptz | 业务生效时间 |
| effective_to | timestamptz | 业务失效时间 |
| approval_ref | text | 审批引用 |
| attributes | jsonb object | 类型专属扩展属性 |

## 4. core.entity_aliases：实体别名表

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| alias_id | uuid | 否 | PK | 别名记录 ID |
| tenant_id | uuid | 否 | FK | 租户 ID |
| entity_id | uuid | 否 | FK | 对应规范实体 |
| alias_type | text | 否 | 如 external_code、legacy_code、name | 别名类型 |
| alias_value | text | 否 | 同租户/类型/值唯一 | 外部编码或历史名称 |
| source_system | text | 否 | - | 别名来源系统 |
| source_ref | text | 是 | - | 来源记录号 |
| status | text | 否 | active、deprecated、rejected | 别名状态 |
| valid_from | timestamptz | 是 | - | 别名生效时间 |
| valid_to | timestamptz | 是 | - | 别名失效时间 |
| evidence_id | uuid | 是 | FK | 证据锚点 |
| created_at | timestamptz | 否 | - | 创建时间 |

## 5. core.entity_relations：实体关系表

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| relation_id | uuid | 否 | PK | 关系 ID |
| tenant_id | uuid | 否 | FK | 租户 ID |
| relation_type | text | 否 | 关系类型定义 FK | 关系名称 |
| source_entity_id | uuid | 否 | FK | 起点实体 |
| source_entity_version_id | uuid | 是 | FK | 起点使用的版本 |
| target_entity_id | uuid | 否 | FK | 终点实体 |
| target_entity_version_id | uuid | 是 | FK | 终点使用的版本 |
| sequence_no | integer | 是 | >=0 | 关系顺序，如路线工序序号 |
| quantity | numeric(20,6) | 是 | >=0 | 关系数量，如 BOM 用量 |
| unit | text | 是 | - | 数量单位 |
| attributes | jsonb | 否 | 默认 {} | 关系扩展属性 |
| status | text | 否 | active、inactive、rejected | 关系状态 |
| effective_from | timestamptz | 是 | - | 关系生效时间 |
| effective_to | timestamptz | 是 | - | 关系失效时间 |
| evidence_id | uuid | 是 | FK | 关系证据 |
| created_at | timestamptz | 否 | - | 创建时间 |
| created_by | text | 否 | - | 创建主体 |

attributes 常用元素：

| 元素 | 类型 | 中文含义 |
|---|---|---|
| scrap_rate | numeric | 损耗率 |
| yield_rate | numeric | 良率 |
| dependency_type | text | 前置、替代、供应、包含等依赖类型 |
| capability_required | text array | 目标端点所需能力 |
| notes | text | 关系备注 |

## 6. knowledge.source_assets：来源资产表

| 字段 | 类型 | 可空 | 约束 | 中文含义 |
|---|---|---:|---|---|
| source_asset_id | uuid | 否 | PK | 来源资产 ID |
| tenant_id | uuid | 否 | FK | 租户 ID |
| source_system | text | 否 | - | 来源系统，如 ERP、MES、微信导出 |
| external_id | text | 否 | 联合唯一 | 来源系统记录号 |
| uri | text | 是 | - | 文件路径或对象存储 URI |
| filename | text | 是 | - | 原始文件名 |
| mime_type | text | 是 | - | MIME 类型 |
| size_bytes | bigint | 是 | >=0 | 文件大小 |
| checksum | char(64) | 否 | SHA-256 | 原始内容摘要 |
| observed_at | timestamptz | 是 | - | 文件/接口事实观察时间 |
| ingested_at | timestamptz | 否 | - | 进入系统时间 |
| classification | text | 是 | - | order、bom、sop、inventory 等分类 |
| extractor_version | text | 是 | - | 解析器版本 |
| sensitivity | text | 否 | - | 数据敏感级别 |
| retention_class | text | 是 | - | 保存策略 |
| metadata | jsonb | 否 | 默认 {} | 来源扩展信息 |

## 7. knowledge.source_occurrences：来源出现位置表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| occurrence_id | uuid PK | 否 | 出现位置 ID |
| source_asset_id uuid FK | 否 | 否 | 所属来源资产 |
| page_no | integer | 是 | PDF 页码 |
| sheet_name | text | 是 | Excel Sheet 名 |
| row_no | integer | 是 | 表格行号 |
| column_no | integer | 是 | 表格列号 |
| json_path | text | 是 | JSON 字段路径 |
| char_start | integer | 是 | 文本起始字符位置 |
| char_end | integer | 是 | 文本结束字符位置 |
| observed_value | jsonb | 是 | 该位置观察到的原始值 |
| locator | jsonb | 否 | 复合定位信息 |
| observed_at | timestamptz | 是 | 该事实观察时间 |
| created_at | timestamptz | 否 | 记录创建时间 |

locator 元素：page、sheet、row、column、cell_range、paragraph、json_path，分别表示页、Sheet、行、列、单元格范围、段落和 JSON 路径。

## 8. knowledge.evidence_anchors：证据锚点表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| evidence_id uuid PK | 否 | 否 | 证据 ID |
| occurrence_id uuid FK | 否 | 否 | 对应来源出现位置 |
| anchor_type text | 否 | 否 | page、cell、paragraph、api_record 等锚点类型 |
| locator jsonb | 否 | 否 | 精确定位 |
| quote_hash char(64) | 否 | 否 | 证据片段摘要，避免保存敏感原文 |
| evidence_summary text | 是 | 是 | 脱敏证据摘要 |
| confidence numeric(5,4) | 否 | 否 | 证据置信度，0 到 1 |
| created_at timestamptz | 否 | 否 | 创建时间 |
| created_by text | 否 | 否 | 创建主体 |

## 9. knowledge.field_claims：字段声明表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| claim_id uuid PK | 否 | 否 | 字段声明 ID |
| tenant_id uuid | 否 | 否 | 租户 ID |
| entity_id uuid | 是 | 是 | 已解析实体 ID |
| entity_version_id uuid | 是 | 是 | 目标实体版本 |
| candidate_record_id uuid | 是 | 是 | 来源候选记录 |
| field_path text | 否 | 否 | 规范字段路径，如 product.name |
| raw_value jsonb | 否 | 否 | 原始抽取值 |
| normalized_value jsonb | 是 | 是 | 归一化值 |
| physical_type text | 否 | 否 | string、number、date、object 等物理类型 |
| semantic_type text | 是 | 是 | product_code、quantity、due_date 等语义类型 |
| unit text | 是 | 是 | 单位 |
| confidence numeric(5,4) | 否 | 否 | 字段置信度 |
| claim_status text | 否 | 否 | candidate、approved、rejected、superseded |
| evidence_id uuid | 是 | 是 | 证据锚点 |
| source_priority integer | 是 | 是 | 来源优先级 |
| valid_from/to timestamptz | 是 | 是 | 声明有效区间 |
| resolved_by/at | 是 | 是 | 裁决主体和时间 |
| created_at timestamptz | 否 | 否 | 创建时间 |

## 10. knowledge.relationship_claims：关系声明表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| relationship_claim_id uuid PK | 否 | 否 | 关系声明 ID |
| tenant_id uuid | 否 | 否 | 租户 ID |
| source_identity jsonb | 否 | 否 | 起点候选身份 |
| relation_type text | 否 | 否 | 关系类型 |
| target_identity jsonb | 否 | 否 | 终点候选身份 |
| attributes jsonb | 否 | 否 | 关系属性，如数量、序号、单位 |
| confidence numeric(5,4) | 否 | 否 | 关系置信度 |
| claim_status text | 否 | 否 | candidate、approved、rejected、superseded |
| evidence_id uuid | 是 | 是 | 关系证据 |
| resolved_by/at | 是 | 是 | 裁决主体和时间 |
| created_at timestamptz | 否 | 否 | 创建时间 |

source_identity/target_identity 元素：entity_type（实体类型）、canonical_key（候选业务键）、label（显示名称）、source_ref（来源引用）。

## 11. staging.structured_records：结构化导入记录表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| record_id uuid PK | 否 | 否 | 导入记录 ID |
| batch_id uuid | 否 | 否 | 导入批次 ID |
| source_asset_id uuid | 否 | 否 | 来源资产 ID |
| tenant_id uuid | 否 | 否 | 租户 ID |
| template_version text | 否 | 否 | 模板版本，如 m0.bom.v1 |
| entity_type text | 否 | 否 | 目标实体类型 |
| row_key text | 否 | 否 | 来源行稳定键 |
| raw_record jsonb | 否 | 否 | 原始行数据 |
| normalized_record jsonb | 是 | 是 | 归一化后的行数据 |
| parse_status text | 否 | 否 | parsed、failed、partial |
| review_status text | 否 | 否 | candidate、approved、rejected |
| validation_issues jsonb | 否 | 否 | 校验问题数组 |
| task_id text | 否 | 否 | 根 TaskID |
| idempotency_key text | 否 | 否 | 幂等键 |
| created_at timestamptz | 否 | 否 | 创建时间 |

## 12. staging.field_candidates：字段候选表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| field_candidate_id uuid PK | 否 | 否 | 字段候选 ID |
| record_id uuid FK | 否 | 否 | 所属导入记录 |
| field_path text | 否 | 否 | 目标规范字段路径 |
| source_column text | 是 | 是 | 来源列名或字段名 |
| raw_value jsonb | 否 | 否 | 原始值 |
| normalized_value jsonb | 是 | 是 | 归一化值 |
| physical_type text | 否 | 否 | 物理类型 |
| semantic_type text | 是 | 是 | 业务语义类型 |
| unit text | 是 | 是 | 单位 |
| confidence numeric(5,4) | 否 | 否 | 置信度 |
| mapping_status text | 否 | 否 | proposed、confirmed、rejected |
| evidence_id uuid | 是 | 是 | 字段证据 |
| validation_issues jsonb | 否 | 否 | 字段校验问题 |
| created_at timestamptz | 否 | 否 | 创建时间 |

## 13. staging.identity_candidates：身份匹配候选表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| identity_candidate_id uuid PK | 否 | 否 | 身份候选 ID |
| record_id uuid FK | 否 | 否 | 所属导入记录 |
| entity_type text | 否 | 否 | 实体类型 |
| proposed_key text | 否 | 否 | 建议规范业务键 |
| proposed_label text | 是 | 是 | 建议名称 |
| matched_entity_id uuid | 是 | 是 | 匹配到的已有实体 |
| match_method text | 是 | 是 | exact、alias、manual、fuzzy |
| match_score numeric(5,4) | 是 | 是 | 匹配分数 |
| conflict_type text | 是 | 是 | 同码异名、同码异单位等 |
| review_status text | 否 | 否 | pending、approved、rejected |
| resolved_by/at | 是 | 是 | 裁决主体和时间 |
| evidence_id uuid | 是 | 是 | 身份证据 |
| created_at timestamptz | 否 | 否 | 创建时间 |

## 14. staging.relationship_candidates：关系匹配候选表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| relationship_candidate_id uuid PK | 否 | 否 | 关系候选 ID |
| record_id uuid FK | 否 | 否 | 所属导入记录 |
| source_candidate_id uuid | 否 | 否 | 起点身份候选 |
| relation_type text | 否 | 否 | 关系类型 |
| target_candidate_id uuid | 否 | 否 | 终点身份候选 |
| attributes jsonb | 否 | 否 | 数量、序号、单位等关系属性 |
| confidence numeric(5,4) | 否 | 否 | 置信度 |
| review_status text | 否 | 否 | pending、approved、rejected |
| evidence_id uuid | 是 | 是 | 关系证据 |
| validation_issues jsonb | 否 | 否 | 校验问题 |
| created_at timestamptz | 否 | 否 | 创建时间 |

## 15. audit.audit_events：审计事件表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| audit_event_id uuid PK | 否 | 否 | 审计事件 ID |
| tenant_id uuid | 否 | 否 | 租户 ID |
| task_id text | 否 | 否 | 根 TaskID |
| event_type text | 否 | 否 | ingest、review、publish、revoke、rollback、permission_decision 等 |
| actor_type text | 否 | 否 | user、agent、service |
| actor_id text | 否 | 否 | 操作主体 |
| entity_type text | 是 | 是 | 关联实体类型 |
| entity_id uuid | 是 | 是 | 关联实体 ID |
| entity_version_id uuid | 是 | 是 | 关联版本 ID |
| before_checksum char(64) | 是 | 是 | 变更前摘要 |
| after_checksum char(64) | 是 | 是 | 变更后摘要 |
| event_payload jsonb | 否 | 否 | 脱敏事件详情 |
| correlation_id text | 是 | 是 | 请求/链路关联 ID |
| occurred_at timestamptz | 否 | 否 | 事件发生时间 |
| result text | 否 | 否 | success、rejected、failed |
| created_at timestamptz | 否 | 否 | 入库时间 |

event_payload 元素：reason（原因）、changed_fields（变更字段）、approval_ref（审批引用）、source_ref（来源引用）、error_code（错误码）。

## 16. audit.ingest_ledgers：导入台账表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| ledger_id uuid PK | 否 | 否 | 台账 ID |
| tenant_id uuid | 否 | 否 | 租户 ID |
| batch_id uuid | 否 | 否 | 导入批次 |
| task_id text | 否 | 否 | 根 TaskID |
| idempotency_key text | 否 | 否 | 幂等键 |
| operation text | 否 | 否 | insert、update、rollback |
| entity_version_id uuid | 是 | 是 | 写入的版本 |
| write_checksum char(64) | 否 | 否 | 写入载荷摘要 |
| status text | 否 | 否 | prepared、committed、rolled_back、failed |
| committed_at timestamptz | 是 | 是 | 提交时间 |
| rolled_back_at timestamptz | 是 | 是 | 回滚时间 |
| rollback_reason text | 是 | 是 | 回滚原因 |
| created_at timestamptz | 否 | 否 | 创建时间 |

## 17. audit.projection_outbox：投影 Outbox 表

| 字段 | 类型 | 可空 | 中文含义 |
|---|---|---:|---|
| outbox_id uuid PK | 否 | 否 | Outbox 事件 ID |
| tenant_id uuid | 否 | 否 | 租户 ID |
| aggregate_type text | 否 | 否 | 投影聚合类型 |
| aggregate_id uuid | 否 | 否 | 被投影实体 ID |
| aggregate_version_id uuid | 是 | 是 | 被投影版本 |
| event_type text | 否 | 否 | entity_published、relation_changed 等 |
| payload jsonb | 否 | 否 | 投影事件载荷 |
| payload_checksum char(64) | 否 | 否 | 事件载荷摘要 |
| task_id text | 否 | 否 | 根 TaskID |
| status text | 否 | 否 | pending、processing、delivered、failed |
| attempts integer | 否 | 否 | 投递尝试次数 |
| next_attempt_at timestamptz | 是 | 是 | 下次重试时间 |
| last_error text | 是 | 是 | 最近失败原因 |
| created_at timestamptz | 否 | 否 | 创建时间 |
| delivered_at timestamptz | 是 | 是 | 成功投递时间 |

## 18. 各业务实体 payload 字段

以下元素位于 core.entity_versions.payload，具体字段必须受 schema_version 对应的 JSON Schema 校验。

### 18.1 product 产品

| 元素 | 类型 | 必填 | 中文含义 |
|---|---|---:|---|
| product_code | string | 是 | 产品稳定编码 |
| name | string | 是 | 产品名称 |
| family_code | string | 否 | 产品族编码 |
| specification | string/object | 否 | 规格参数 |
| uom | string | 是 | 产品单位 |
| status | string | 是 | 产品状态 |
| revision | integer/string | 是 | 产品业务版本 |
| effective_from/to | datetime | 是/否 | 生效和失效时间 |
| aliases | array[string] | 否 | 产品别名 |

### 18.2 order 与 order_line 订单

order 元素：

| 元素 | 类型 | 必填 | 中文含义 |
|---|---|---:|---|
| order_id | string | 是 | 订单稳定编号 |
| customer_code/name | string | 是 | 客户编码和名称 |
| order_date | date | 是 | 下单日期 |
| release_at | datetime | 是 | 允许生产时间 |
| due_at | datetime | 是 | 交付时间 |
| priority | integer | 是 | 优先级 |
| status | string | 是 | draft、released、hold、cancelled、closed |
| site_code | string | 是 | 工厂/生产地点 |
| lines | array | 是 | 订单行数组 |

order line 元素：

| 元素 | 类型 | 必填 | 中文含义 |
|---|---|---:|---|
| order_line_id | string | 是 | 订单行稳定 ID |
| product_code | string | 是 | 产品编码 |
| required_qty | numeric | 是 | 需求数量 |
| uom | string | 是 | 数量单位 |
| release_at/due_at | datetime | 是 | 行级释放/交期 |
| priority | integer | 是 | 行级优先级 |
| status | string | 是 | 行状态 |
| inventory_snapshot_ref | string | 否 | 库存快照引用 |
| notes | string | 否 | 行备注 |

### 18.3 material 与 BOM

material 元素：

| 元素 | 类型 | 必填 | 中文含义 |
|---|---|---:|---|
| material_code | string | 是 | 物料稳定编码 |
| name | string | 是 | 物料名称 |
| specification | string/object | 否 | 规格 |
| uom | string | 是 | 基本单位 |
| material_type | string | 否 | 原料、半成品、包材等 |
| aliases | array[string] | 否 | 别名/旧料号 |
| status | string | 是 | 物料状态 |

bom 元素：

| 元素 | 类型 | 必填 | 中文含义 |
|---|---|---:|---|
| bom_code | string | 是 | BOM 编码 |
| product_code | string | 是 | 所属产品 |
| revision | integer/string | 是 | BOM 版本 |
| approval_ref | string | 是 | 批准引用 |
| effective_from/to | datetime | 是/否 | 生效区间 |
| lines | array | 是 | BOM 行 |

bom line 元素：

| 元素 | 类型 | 必填 | 中文含义 |
|---|---|---:|---|
| line_no | integer | 是 | 行号 |
| parent_code | string | 是 | 父件编码 |
| child_material_code | string | 是 | 子物料编码 |
| qty_per | numeric | 是 | 单位用量 |
| uom | string | 是 | 用量单位 |
| scrap_rate | numeric | 否 | 损耗率 |
| substitute_codes | array[string] | 否 | 替代料 |
| operation_code | string | 否 | 投料工序 |
| issue_warehouse | string | 否 | 发料仓库 |

### 18.4 supplier、equipment、tooling

supplier 元素：supplier_code（供应商编码）、name（名称）、legal_id（统一法律主体标识）、status（状态）、material_codes（可供物料编码数组）、contacts（受控联系方式）、payment_terms（付款条件）。

equipment 元素：equipment_code（设备编码）、name（设备名称）、equipment_type（设备类型）、station_code（所属工位）、line_code（产线）、capacity（能力数值）、capacity_uom（能力单位）、efficiency（效率）、status（设备状态）、maintenance_windows（维修窗口数组）。

tooling 元素：tooling_code（工装编码）、name（名称）、tooling_type（模具/夹具等）、quantity（数量）、compatible_products（适用产品数组）、compatible_operations（适用工序数组）、status（状态）、maintenance_windows（维护窗口数组）。

### 18.5 route、operation、station

route 元素：route_code（路线编码）、revision（路线版本）、product_code（产品编码）、approval_ref（批准引用）、effective_from/to（有效期）、operations（工序数组）。

operation 元素：operation_code（工序编码）、name（工序名称）、sequence_no（顺序）、standard_minutes（标准工时）、setup_minutes（准备/换型时间）、yield_rate（良率）、station_codes（可执行工位）、equipment_codes（设备要求）、tooling_codes（工装要求）、skill_codes（技能要求）、predecessors（前置工序）。

station 元素：station_code（工位编码）、name（工位名称）、production_unit（生产单元）、work_center（工作中心）、parallel_slots（并行槽位数）、calendar_ref（日历引用）、capability_tags（能力标签）、status（状态）。

### 18.6 person、inventory_snapshot、supply_snapshot、wip_snapshot

person 元素：person_id（人员编码）、team（班组）、status（在职/停用）、skill_codes（技能编码数组）、qualification_refs（资格证及有效期）、station_codes（绑定工位）、calendar_ref（班次日历）、max_parallel（最大并行任务数）。姓名、身份证、工资等敏感元素不应进入普通查询 payload。

inventory_snapshot 元素：snapshot_id（快照 ID）、revision（快照版本）、observed_at（观察时间）、warehouse（仓库）、lots（库存批次数组）。lots 内含 material_code、lot_no、on_hand_qty、available_qty、allocated_qty、qc_status、available_at、expiry_at。

supply_snapshot 元素：snapshot_id、observed_at、order_line_id、material_code、required_qty、allocated_qty、shortage_qty、readiness、earliest_ready_at、source_ref、confidence、checksum。

wip_snapshot 元素：snapshot_id、observed_at、order_line_id、batch_id、operation_code、station_code、completed_qty、remaining_qty、status、earliest_ready_at、hold_reason、source_ref、checksum。

## 19. 发布事务与校验顺序

1. 校验 tenant、主体权限、TaskID 和 idempotency_key。
2. 校验 schema_version、稳定业务键、字段类型、单位、必填项和枚举。
3. 写入或复用 core.entities。
4. 新增 core.entity_versions，不覆盖历史版本。
5. 写入 source_assets、source_occurrences、evidence_anchors 和关系。
6. 写入 audit_events 与 ingest_ledgers。
7. 同一 PostgreSQL 事务写入 projection_outbox。
8. 提交后由投影 worker 投递 Neo4j/全文/向量索引；投影失败只重试投影，不回滚已提交 canonical。
9. 回读 entity、entity_version、source、ledger、outbox 和 rollback 状态，全部成功才可判定发布完成。

## 20. 当前状态与实施限制

- 当前仓库实际可检查的 SQLite 没有上述 PostgreSQL canonical 表。
- M0 生产 PostgreSQL 的连接、migration、审核权限和回读接口尚未提供。
- 候选 SQLite 中的 unclassified/needs_review 记录不能直接写成 approved canonical。
- 没有 entity/version、source、ledger、Outbox 的回读证据时，不得声称生产数据已落库。

