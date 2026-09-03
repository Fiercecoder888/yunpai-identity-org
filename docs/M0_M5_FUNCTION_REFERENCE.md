# M0-M5 完整功能与接口参考

> 本文由 `scripts/generate_capability_reference.py` 从 `registry/tool-manifests/*.json` 生成。JSON manifest 是完整机器可读合同，本文用于人工检索。

当前共收录 **114** 个工具。所有写操作必须透传根 `X-Yunpai-Task-ID`；模块响应仍受 manifest 输出 Schema、租户、幂等、revision/checksum 和人工 Gate 约束。

| 模块 | 数量 | 领域职责 |
|---|---:|---|
| M0 | 27 | 数据导入、canonical 事实、来源/证据、版本与回滚 |
| M1 | 17 | 多模态文件解析、订单字段、审核和解析任务查询 |
| M2 | 7 | BOM/SOP 历史检索、受控生成和制品查询 |
| M3 | 17 | MRP、物料匹配、缺料、齐套与需求反馈 |
| M4 | 26 | 采购建议、PO 审核、供应商回复、ETA 和预警 |
| M5 | 20 | PMC 排程、重排、知识、消息、派工和报工 |

## M0 能力

默认服务地址：`http://m0:8010`。完整 Schema：`registry/tool-manifests/m0.json`。

### `data_import_run`

m0 数据建设：统一接收多文件（多格式×多内容类型：订单/采购/BOM/SOP/工程图/ID图/库存/设备/模具/规格书/混合归档），按 七层管道 摄入→分类→解析→实体→匹配 建批次。压缩包自动解压递归；伪扩展名/坏文件隔离不中止整批；低置信与实体冲突进入待人工确认。返回批次 id 与状态。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/import/upload?wait=false`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `files` | `array` | 是 | Base64 文件对象数组；每个对象转换为同名 files multipart 字段。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `string` | 否 | - |
| `status` | `string` | 否 | ready \| awaiting_review \| failed |

### `data_import_status`

查询导入批次状态与文档级结果（格式×内容类型×置信度×隔离）。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/import/batch/{batch_id}`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batch_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batch` | `object` | 否 | - |
| `documents` | `array` | 否 | - |
| `stats` | `object` | 否 | - |

### `data_import_preview`

入库前预览：数据行、实体冲突、匹配候选、隔离区、台账。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/import/batch/{batch_id}/preview`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batch_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `documents` | `array` | 否 | - |
| `rows` | `array` | 否 | - |
| `entities` | `array` | 否 | - |
| `mappings` | `array` | 否 | - |
| `quarantine` | `array` | 否 | - |

### `data_import_resolve`

人工裁决：批准/拒绝实体冲突（同码不同名/同码不同单位）或匹配候选。裁决后批次状态重算。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/import/batch/{batch_id}/resolve/{kind}`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batch_id` | `string` | 是 | - |
| `kind` | `string` | 是 | - |
| `id` | `integer` | 是 | - |
| `action` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `status` | `string` | 否 | - |

### `data_import_commit`

提交入库：approved 行写入 v1 主数据（订单/库存/BOM/文档），全程 ledger 可回滚。存在未裁决冲突/低置信文档时拒绝。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/import/batch/{batch_id}/commit`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batch_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `status` | `string` | 否 | - |
| `master_counts` | `object` | 否 | - |

### `data_import_rollback`

按 ledger 回滚批次全部主数据写入，证据文件保留。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/import/batch/{batch_id}/rollback`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batch_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `status` | `string` | 否 | - |
| `rolled_back` | `integer` | 否 | - |

### `data_import_history`

历史导入批次列表。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/import/batches`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batches` | `array` | 否 | - |

### `data_import_quarantine`

隔离区文件列表（坏文件/伪扩展名/未分类）。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/import/quarantine`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `batch_id` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | `array` | 否 | - |

### `data_catalog_ingest_validate`

校验 m0.ingest.v1 标准数据，不写数据库。检查稳定编码、版本、来源哈希、证据、审核状态、产品引用、产品族关系和 TaskID 范围内幂等冲突，返回 dry-run 报告。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/catalog/ingest/validate`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `data_catalog_ingest_publish`

发布已审核的 m0.ingest.v1 标准数据。在一个事务内写入规范实体版本、来源证据、产品索引关系和 Tracking Outbox；相同 TaskID+幂等键+载荷返回 duplicate，不同载荷返回冲突。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/catalog/ingest/publish`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_products_import`

M0 canonical 产品导入 facade。只接受已审核的 m0.ingest.v1 product 记录，并在 PostgreSQL canonical transaction 中写入实体、版本、来源、索引和 projection Outbox。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/products/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_orders_import`

M0 canonical 订单导入 facade。订单行和产品引用在同一 PostgreSQL transaction 中校验并写入。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/orders/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_boms_import`

M0 canonical BOM 导入 facade。BOM 头、物料身份、BOM 行、来源证据和 projection Outbox 使用同一事务。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/boms/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_materials_import`

M0 canonical 物料导入 facade。物料编码为稳定身份（不可带版本），name/unit/spec/aliases 进入同一 canonical 事务；发布后可通过 where-used 反查使用该物料的 BOM 与产品。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/materials/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_suppliers_import`

M0 canonical 供应商导入 facade。供应商编码为稳定身份，name/legal_id/status 与声明的供应物料编码（material_codes）进入同一 canonical 事务；物料入规范后自动回填 supplied_by 关系。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/suppliers/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_equipment_import`

M0 canonical 设备导入 facade。设备编码为稳定身份，name/equipment_type/line/status 进入同一 canonical 事务；工艺路线与工序实体接入后用于工序-设备反查。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/equipment/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_routes_import`

M0 canonical 工艺路线导入 facade。route_code+revision 为版本化身份，product_code 必须已是规范实体；operations 携带 sequence_no、工序/物料/设备/工装编码，未入规范的端点关系静默降级。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/routes/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_operations_import`

M0 canonical 工序导入 facade。工序编码为稳定身份，name/standard_time/status 进入同一 canonical 事务；发布后回填 has_operation 及工序-物料/设备/工装边。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/operations/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `m0_tooling_import`

M0 canonical 工装导入 facade。工装编码为稳定身份，name/tooling_type/status 进入同一 canonical 事务；发布后回填 requires_tooling 边。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/v1/tooling/import`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `records` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `data_catalog_file_validate`

把版本化 CSV/Excel 模板转换为 m0.ingest.v1 后执行 dry-run。支持 m0.product.v1、m0.product-family.v1、m0.order.v1、m0.bom.v1、m0.document.v1、m0.material.v1、m0.supplier.v1、m0.equipment.v1、m0.route.v1、m0.operation.v1、m0.tooling.v1；缺稳定编码、修订或未知列时拒绝，不从文件名或 Sheet 名猜业务身份。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/catalog/ingest/files/validate`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file` | `object` | 是 | - |
| `template_version` | `string` | 是 | - |
| `source_system` | `string` | 是 | - |
| `source_external_id` | `string` | 是 | - |
| `review_status` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `data_catalog_file_publish`

把已审核的版本化 CSV/Excel 模板先转换为 m0.ingest.v1，再在同一规范发布服务中写实体版本、证据、产品索引关系和 Tracking Outbox。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/catalog/ingest/files/publish`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file` | `object` | 是 | - |
| `template_version` | `string` | 是 | - |
| `source_system` | `string` | 是 | - |
| `source_external_id` | `string` | 是 | - |
| `review_status` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `data_catalog_document_candidate_validate`

把 m0.document-candidate.v1 解析候选转换为 m0.ingest.v1 文档记录并 dry-run。文档号、修订、角色、产品编码和证据缺一即拒绝，不按标题、文件名或名称猜产品。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/catalog/ingest/document-candidates/validate`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `candidates` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `data_catalog_document_candidate_publish`

把已审核的 m0.document-candidate.v1 候选规范化并发布，建立产品到承认书、SOP 或工程图的版本化证据关系。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m0/catalog/ingest/document-candidates/publish`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `candidates` | `array` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `get_m0_product_overview`

按稳定产品编码查询订单、承认书、BOM 各修订、SOP、工程图、产品族和同系列产品索引，并返回版本、来源证据和同系列产品的索引数量。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/catalog/products/{product_code}/overview`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `product_code` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `get_m0_product_graph`

按产品编码查询 1-3 跳规范关系图；默认两跳可看到产品族和同系列产品，三跳可继续看到同系列产品的订单/BOM/承认书/SOP/工程图。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/catalog/products/{product_code}/graph`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `product_code` | `string` | 是 | - |
| `depth` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `list_m0_documents`

按订单/物料/产品查询 M0 已入库的工程文档（工程图 engineering_drawing、工艺方法 process_method、包装方法 packing_method、测试方法 test_method 等），返回 doc_id、doc_type、标题、状态与绑定实体。当用户问某订单/产品的工程图、图纸、工程文档时使用本工具（M0 文档库按 order/material/product 绑定），优先于 M1 文档检索。返回的 doc_id 可让前端用 /api/m0/documents/{doc_id}/file 预览或下载。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/documents`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order` | `string` | 否 | 订单号（如 SO-HIST-20260724-005），返回绑定到该订单的文档。 |
| `material` | `string` | 否 | 物料编码过滤（可选）。 |
| `product` | `string` | 否 | 产品编码/名称过滤（可选）。 |
| `doc_type` | `string` | 否 | 文档类型过滤（可选），如 engineering_drawing。 |
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `list_m0_inventory`

查询 M0 已入库的原料库存（m0_master_inventory），返回物料编码、物料名称、数量、单位、规格、仓库。当用户问原料库存、物料库存、有什么料、某物料还剩多少、库存数量时使用本工具；可按 material_code 精确过滤单个物料。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m0/import/master/m0_master_inventory`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `material_code` | `string` | 否 | 物料编码过滤（可选），精确匹配。 |
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

## M1 能力

默认服务地址：`http://m1:8080`。完整 Schema：`registry/tool-manifests/m1.json`。

### `ingest_document`

上传 PDF、图片、XLSX/XLSM/XLS/CSV、DOCX、DXF/DWG 或 ZIP/TAR/RAR/7Z。普通文档同步返回 m1.document.v2；归档自动分流为批次并返回可轮询的父子任务。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /ingest/sync`，超时 `240s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file` | `oneOf` | 是 | - |
| `doc_type_hint` | `string` | 否 | 可选文档大类提示；只影响分类，不覆盖源文件事实。 |
| `document_subtype_hint` | `string` | 否 | 可选文档子类型提示；只影响分类，不覆盖源文件事实。 |
| `semantic_enrichment` | `boolean` | 否 | 是否保留订单行的名称归一化、产品分类和名称属性等可选语义字段；关闭时仍执行 MinerU/Instructor 权威基础事实提取，但这些可选字段不会进入结果。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |
| `status` | `string` | 是 | - |
| `processing_stage` | `string` | 否 | - |
| `schema_version` | `string | null` | 否 | Compatibility alias for document_schema_version; null before a v2 document exists. |
| `document_schema_version` | `string | null` | 否 | - |
| `document_subtype` | `string` | 否 | - |
| `needs_review` | `boolean` | 否 | - |
| `overall_confidence` | `number | null` | 否 | - |
| `document` | `object | null` | 否 | - |
| `extraction` | `object | null` | 否 | - |
| `scored_result` | `object | null` | 否 | - |

### `ingest_m1_archive`

异步上传 ZIP/TAR/RAR/7Z 归档，安全递归展开并为父归档与每个叶子文档建立可查询任务。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /ingest/archive`，超时 `240s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file` | `oneOf` | 是 | - |
| `doc_type_hint` | `string` | 否 | - |
| `document_subtype_hint` | `string` | 否 | - |
| `semantic_enrichment` | `boolean` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |
| `status` | `string` | 是 | - |
| `processing_stage` | `string` | 否 | - |
| `child_count` | `integer` | 是 | - |
| `child_ids` | `array` | 是 | - |
| `async` | `boolean` | 否 | - |

### `get_m1_task`

查询单个 M1 任务的阶段、终态、失败原因、完整 v2 文档和兼容结果；用于同步上传超时后的轮询。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /tasks/{task_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |
| `status` | `string` | 是 | - |
| `processing_stage` | `string` | 否 | - |
| `error` | `string | null` | 否 | - |
| `document_schema_version` | `string | null` | 否 | - |
| `document` | `object | null` | 否 | - |

### `get_m1_batch`

轮询归档或混合批次，返回父任务、全部子任务和完成/失败/待审核计数。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /batch/{parent_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `parent_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `parent` | `object` | 是 | - |
| `children` | `array` | 是 | - |
| `child_count` | `integer` | 是 | - |
| `done_count` | `integer` | 是 | - |
| `failed_count` | `integer` | 是 | - |
| `review_count` | `integer` | 是 | - |
| `pending_count` | `integer` | 是 | - |

### `get_m1_document`

按任务 ID 获取完整的 m1.document.v2 文档。返回确定性源文件事实、标准化订单行、字段证据与校验问题；旧 extraction/scored_result/fields/bom 字段继续保留。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /tasks/{task_id}/document`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | M1 任务 ID。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | `string` | 否 | - |
| `source` | `any` | 是 | - |
| `document_type` | `string` | 否 | 文档大类，例如 order、inventory、equipment、mold、technical_document。 |
| `document_subtype` | `string` | 否 | 细分模板类型，例如 stocking_order、customer_purchase_order、inventory_snapshot。 |
| `header` | `any` | 否 | - |
| `lines` | `array` | 否 | - |
| `totals` | `any` | 否 | - |
| `field_meta` | `object` | 否 | JSONPath 到字段证据和置信度的映射。 |
| `validation_issues` | `array` | 否 | - |
| `needs_review` | `boolean` | 否 | - |
| `extraction` | `object` | 否 | 旧版抽取结果，兼容保留。 |
| `scored_result` | `object` | 否 | 旧版置信度结果，兼容保留。 |
| `fields` | `array` | 否 | 旧版字段列表，兼容保留。 |
| `bom` | `array` | 否 | 订单行兼容别名；与 lines 同步。 |

### `search_m1_orders`

按订单号、型号、产品名称、类别或日期范围检索 M1 的订单明细行。直接返回命中的完整行和 task_id，适合 Agent 回答订单字段与产品查询。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /orders/search`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_number` | `string` | 否 | - |
| `model` | `string` | 否 | - |
| `name` | `string` | 否 | - |
| `interface` | `string` | 否 | 接口类型（HDMI/USB/DP），匹配 name_attributes.interface |
| `length` | `string` | 否 | 线材长度（如 20M），匹配 name_attributes.cable_length |
| `color` | `string` | 否 | 颜色，匹配 name_attributes.color |
| `connector` | `string` | 否 | 连接器/插头，匹配 name_attributes.plug |
| `conductor` | `string` | 否 | 线芯/导体，匹配 name_attributes.conductor |
| `od` | `string` | 否 | 线径（如 7.0mm），匹配 name_attributes.od |
| `category` | `string` | 否 | - |
| `date_from` | `string` | 否 | - |
| `date_to` | `string` | 否 | - |
| `limit` | `integer` | 否 | - |
| `offset` | `integer` | 否 | - |

输出：

无固定顶层字段；以 JSON Schema 的组合约束为准。

### `export_m1_order`

获取标准订单 Excel 的下载链接。链接对应包含订单头、产品明细、校验问题、原始证据四个 Sheet 的 .xlsx 文件。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /tasks/{task_id}/exports/order`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |
| `filename` | `string` | 是 | - |
| `content_type` | `string` | 是 | - |
| `download_url` | `string` | 是 | - |
| `generated` | `boolean` | 是 | - |

### `search_m1_documents`

检索 M1 已持久化的 m1.document.v2 文档。支持全文、文档类型、子类型以及任意 JSON 字段路径和值过滤；返回显式摘要命中，随后可用 get_m1_document 获取完整文档。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /documents/search`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `q` | `string` | 否 | 标题、正文、订单号、文件名等全文关键词。 |
| `document_type` | `string` | 否 | - |
| `document_subtype` | `string` | 否 | - |
| `field_path` | `string` | 否 | 要检索的 JSONPath，例如 $.lines[*].model。 |
| `field_value` | `string` | 否 | 字段值关键词，与 field_path 配合使用。 |
| `limit` | `integer` | 否 | - |
| `offset` | `integer` | 否 | - |

输出：

无固定顶层字段；以 JSON Schema 的组合约束为准。

### `list_m1_tasks`

查询 M1 已识别的文档任务列表，可按状态过滤（created/parsing/extracting/scoring/needs_review/done/failed）。当用户问‘识别过哪些文档’‘有哪些待审核’‘之前那份图识别完了吗’时使用。返回任务摘要（id/文件名/状态/置信度）。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /tasks`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `status` | `string` | 否 | 可选状态过滤，如 needs_review、done。留空返回全部（不含子任务）。 |
| `limit` | `integer` | 否 | 可选每页任务数；省略时为兼容旧调用返回全部。 |
| `offset` | `integer` | 否 | 分页偏移量；提供时必须同时提供 limit。 |

输出：

无固定顶层字段；以 JSON Schema 的组合约束为准。

### `list_m1_review_queue`

查询 M1 当前所有待人工审核（needs_review）的任务。当用户问‘有哪些识别结果需要我确认’‘待审核队列’时使用。这是 HITL 闭环的入口——返回的任务都等着人工修正或确认。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /review/queue`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `limit` | `integer` | 否 | 可选每页待审核任务数；省略时为兼容旧调用返回全部。 |
| `offset` | `integer` | 否 | 分页偏移量；提供时必须同时提供 limit。 |

输出：

无固定顶层字段；以 JSON Schema 的组合约束为准。

### `submit_m1_review`

对 M1 某个待审核任务提交人工审核结果（通过/驳回 + 字段修正）。当人工确认了识别结果、或修正了错误字段后，用此工具闭合 HITL 环节，任务转入 done。approve=true 表示通过，false 表示驳回；corrections 是字段名→新值的映射。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /review/{task_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |
| `approve` | `boolean` | 否 | - |
| `reviewer` | `string` | 否 | - |
| `comment` | `string` | 否 | - |
| `corrections` | `object` | 否 | 字段名→修正值的映射。修正过的字段置信度置为 1.0。 |
| `header_corrections` | `object` | 否 | 订单头 JSON 字段名到审核值的映射。 |
| `line_corrections` | `anyOf` | 否 | 按 line_id 提交的明细行修正。 |
| `issue_resolutions` | `anyOf` | 否 | 校验问题的处理结果。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 否 | - |
| `status` | `string` | 否 | - |
| `scored_result` | `object` | 否 | - |

### `generate_m1_report`

为 M1 某个已识别任务生成 Markdown 综合报告（含字段表、置信度、明细）。当用户问‘给我出一份识别报告’‘导出这份文档的识别结果’时使用。单文件和批次父任务都支持。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /tasks/{task_id}/report`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 是 | - |
| `note` | `string` | 否 | 可选附加说明，会附在报告末尾。 |
| `force` | `boolean` | 否 | 是否强制重新生成（否则用缓存） |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `task_id` | `string` | 否 | - |
| `report_kind` | `string` | 否 | - |
| `report_status` | `string` | 否 | - |
| `message` | `string` | 否 | - |

### `search_m1_knowledge`

在指定租户的 M1 Governed Wiki 中检索已激活知识。返回可追溯的字段索引、相关性分数、来源版本和证据坐标；默认不暴露 candidate/待审核数据。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /knowledge/search`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `q` | `string` | 是 | 必填关键词、订单号、型号、企业或产品名称。 |
| `document_type` | `string` | 否 | - |
| `document_subtype` | `string` | 否 | - |
| `mode` | `string` | 否 | - |
| `min_score` | `number` | 否 | - |
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `tenant_id` | `string` | 是 | - |
| `query` | `string` | 是 | - |
| `include_candidate` | `boolean` | 是 | - |
| `mode` | `string` | 否 | - |
| `min_score` | `number` | 否 | - |
| `hits` | `array` | 是 | - |

### `list_m1_knowledge_entities`

列出指定租户中已激活的标准实体（文档、企业、订单、产品/物料、设备、模具），用于从 Wiki 主数据定位 canonical entity_id。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /knowledge/entities`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `entity_type` | `string` | 否 | - |
| `lifecycle_status` | `string` | 是 | - |
| `limit` | `integer` | 否 | - |
| `offset` | `integer` | 否 | - |

输出：

无固定顶层字段；以 JSON Schema 的组合约束为准。

### `get_m1_knowledge_entity`

按 canonical entity_id 获取一个租户内标准实体及其属性、生命周期、置信度和 ACL。跨租户或无权限时返回不存在。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /knowledge/entities/{entity_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `entity_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `entity_id` | `string` | 是 | - |
| `tenant_id` | `string` | 是 | - |
| `entity_type` | `string` | 是 | - |
| `canonical_key` | `string` | 是 | - |
| `canonical_label` | `string` | 是 | - |
| `attributes` | `object` | 否 | - |
| `lifecycle_status` | `string` | 是 | - |
| `confidence` | `number` | 否 | - |
| `acl` | `object` | 否 | - |
| `valid_from` | `string | null` | 否 | - |
| `valid_to` | `string | null` | 否 | - |

### `get_m1_knowledge_graph`

按 Wiki source_record_id 获取已激活的文档图投影，包含可追溯节点和关系；默认不返回 candidate 图。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /knowledge/graph/{source_record_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `source_record_id` | `string` | 是 | - |
| `version` | `string` | 否 | 可选精确版本；留空取最新版本。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `projection_id` | `string` | 是 | - |
| `tenant_id` | `string` | 是 | - |
| `source_record_id` | `string` | 是 | - |
| `version` | `string` | 是 | - |
| `nodes` | `array` | 是 | - |
| `edges` | `array` | 是 | - |

### `get_m1_knowledge_stats`

返回指定租户的来源、版本、绑定、Wiki 字段事实、实体关系与搜索/图投影计数，用于判断基础资料入库覆盖率和积压。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /knowledge/stats`，超时 `60s`

输入：

无固定顶层字段；以 JSON Schema 的组合约束为准。

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `tenant_id` | `string` | 是 | - |
| `inventory` | `object` | 是 | - |
| `claims` | `object` | 是 | - |
| `projections` | `object` | 是 | - |

## M2 能力

默认服务地址：`http://m2:8765`。完整 Schema：`registry/tool-manifests/m2.json`。

### `run_bom_sop_workflow`

BOM/SOP 生成 Agent。接受结构化产品信息（产品名/编码/规格），检索历史 BOM 记录，生成草稿 BOM（物料清单）和 SOP（标准作业指导书 Word 文档）。核心流程：① 分析历史 BOM 模板 ② 入库历史数据 ③ 多维度相似度检索历史 BOM ④ 受控生成草稿 BOM（规则+可选LLM）⑤ 生成 80806-129 格式 SOP Word 文档（含工序流程图）。当用户需要根据产品需求生成 BOM 物料清单或 SOP 工艺文档时使用。所有输出为草稿状态(draft_created/human_input_required)，需人工审核。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/run`，超时 `300s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `product_profile` | `object` | 是 | Product profile. |
| `requirement_text` | `string` | 否 | - |
| `rule_package_path` | `string` | 否 | 受控 BOM 和物料编码规则包目录或 ZIP；禁用 demo 时必填。 |
| `history_bom_paths` | `array` | 否 | - |
| `use_demo_sources` | `boolean` | 否 | - |
| `template_confirmation` | `object` | 否 | 模板确认记录；confirmed=false 时流程保持人工 Gate。 |
| `customer_answers` | `object` | 否 | 按 open_customer_questions.field 提交的明确答案；只解除同字段问题。 |
| `routing_steps` | `array` | 否 | - |
| `machine_hints` | `array` | 否 | - |
| `station` | `string` | 否 | - |
| `enable_bom_model` | `boolean` | 否 | - |
| `enable_sop_model` | `boolean` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `status` | `string` | 否 | draft_created \| human_input_required \| failed |
| `run_id` | `string` | 否 | - |
| `workflow_sequence` | `array` | 否 | 执行的步骤序列。 |
| `bom_generation` | `object` | 否 | BOM 生成结果（bom_lines + assumptions + evidence）。 |
| `sop_generation` | `object` | 否 | SOP 生成结果（Word 文档路径 + 流程图）。 |
| `open_customer_questions` | `array` | 否 | 需要人工确认的开放问题。 |
| `artifacts` | `object` | 否 | 产物文件路径。 |

### `search_m2_bom_history`

Search historical BOM library. Multi-dimensional similarity matching, returns reuse candidates + open questions.

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/bom/history/search`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `product_name` | `string` | 是 | - |
| `history_paths` | `array` | 否 | - |
| `keywords` | `array` | 否 | - |
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `results` | `array` | 否 | - |

### `generate_m2_bom_controlled`

Controlled draft BOM generation. Based on historical BOM + rule package + product requirements.

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/bom/generate-controlled`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `product_profile` | `object` | 是 | - |
| `rule_package_path` | `string` | 是 | - |
| `history_paths` | `array` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `standard_bom` | `object` | 否 | - |

### `onboard_m2_bom_template`

Analyze historical BOM files, extract column structure and numbering rules, generate template proposals.

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/bom/templates/onboard`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `rule_package_path` | `string` | 是 | - |
| `history_paths` | `array` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `proposals` | `array` | 否 | - |

### `generate_m2_sop`

Generate 80806-129 format SOP Word document with process flowchart.

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/sop/generate`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `product_name` | `string` | 是 | - |
| `part_no` | `string` | 是 | - |
| `document_no` | `string` | 是 | - |
| `bom_items` | `array` | 否 | - |
| `routing_steps` | `array` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `status` | `string` | 否 | - |
| `artifacts` | `object` | 否 | - |

### `list_m2_runs`

只读列出 M2 已生成的 BOM/SOP run（读 workflow_manifest.json 摘要）。可按产品编码/产品名/订单号过滤。当用户问某订单/产品的 BOM 或 SOP 是否已生成、要查看已有制品时使用；返回 run_id、状态、order_id/product_code、制品链接（artifact_paths 值可直接传给前端 /api/m2/artifact?path= 下载或预览）。若按 order_id/product_code 过滤没有结果，必须去掉过滤条件再调用一次本工具列出全部 run，不要直接回答无结果。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/runs`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `product_code` | `string` | 否 | 产品编码过滤（可选）。 |
| `product_name` | `string` | 否 | 产品名称模糊过滤（可选）。 |
| `order_id` | `string` | 否 | 订单号过滤（可选），生成时已写入 manifest。 |
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

### `get_m2_run`

只读获取单个 M2 BOM/SOP run 详情（workflow_manifest.json + 制品文件清单）。当用户要看某个已生成 run 的具体制品（BOM xlsx/json、SOP Word/流程图 PNG、校验 JSON）时使用；run_id 由 list_m2_runs 返回。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/runs/{run_id}`，超时 `30s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `run_id` | `string` | 是 | M2 run_id，来自 list_m2_runs。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |

## M3 能力

默认服务地址：`http://m3:8000`。完整 Schema：`registry/tool-manifests/m3.json`。

### `run_m3_procurement_requirements`

正式 M3 工具。接收订单和完整 BOM/子 BOM，由 M3 自行查询库存、在途采购与历史用量，经过可审计物料匹配后计算交给 M4 的采购需求。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/m3/procurement-requirements:run-json`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `tenant_id` | `string` | 否 | 租户 ID；正式 Orchestrator 流程必须传入。 |
| `order` | `object` | 否 | - |
| `bom` | `object` | 否 | - |
| `component_bom` | `array | object` | 否 | 已展开或可递归展开的子 BOM 关系。 |
| `inventory_snapshot` | `array` | 否 | 旧调用兼容字段；正式计算忽略该字段并查询 M3 Provider。 |
| `open_purchase_orders` | `array` | 否 | 旧调用兼容字段；正式计算忽略该字段并查询 M3 Provider。 |
| `historical_usage` | `array` | 否 | 旧调用兼容字段；正式计算忽略该字段并查询 M3 Provider。 |
| `m2_package` | `object` | 否 | 兼容当前 M2 输出的数据包。 |
| `m2_package_dir` | `string` | 否 | 兼容已有本地 M2 产物目录。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `run_mrp_procurement_plan`

[LEGACY] 根据订单、BOM、库存、在途采购和采购参数计算旧版聚合采购计划、审批任务和下游草稿。仅供已有调用兼容；新流程必须使用 run_m3_procurement_requirements。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/m3/procurement-plan:run-json`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `tenant_id` | `string` | 否 | 租户 ID；正式 Orchestrator 流程必须传入。 |
| `source_module` | `string` | 否 | 上游模块，例如 M1 或 M2。 |
| `source_package_id` | `string` | 否 | 上游数据包、任务或产物包 ID。 |
| `project_id` | `string` | 否 | - |
| `order` | `object` | 否 | - |
| `bom` | `object` | 否 | - |
| `approval_context` | `object` | 否 | 上游业务、工程、财务、法务审核状态。不确定或 blocked 会进入 M3 质量报告和人工审核。 |
| `m2_package` | `object` | 否 | M2 兼容包，包含 bom_header、bom_lines、assumptions、project_file。M3 会先转换为标准 order + bom。 |
| `m2_package_dir` | `string` | 否 | 兼容已有本地 M2 产物目录调用；跨服务调用优先使用 m2_package。 |
| `inventory_snapshot` | `array` | 否 | - |
| `procurement_params` | `array` | 否 | - |
| `open_purchase_orders` | `array` | 否 | - |
| `historical_usage` | `array` | 否 | - |
| `component_bom` | `array | object` | 否 | - |
| `procurement_adjustments` | `array` | 否 | - |
| `substitute_materials` | `array` | 否 | - |
| `inventory_transactions` | `array` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | 采购计划主体，包含 procurement_plan_id、availability_status、lines、shortage_lines。 |
| `errors` | `array` | 是 | - |
| `order_id` | `string` | 是 | - |
| `cache` | `object` | 是 | - |
| `quality_report` | `object` | 是 | - |
| `approval_tasks` | `array` | 是 | - |
| `behavior_controls` | `object` | 是 | - |
| `execution_log` | `array` | 是 | - |
| `pr_po_drafts` | `object` | 是 | - |
| `inventory_reservation_drafts` | `object` | 是 | - |
| `data_completion_tasks` | `array` | 是 | - |
| `material_readiness_handoff` | `object` | 是 | - |
| `supplier_message_drafts` | `array` | 是 | - |
| `inventory_transaction_ledger` | `object` | 是 | - |
| `inventory_audit_clues` | `object` | 是 | - |
| `substitute_material_suggestions` | `object` | 是 | - |
| `upstream_context` | `object` | 否 | - |
| `trace_id` | `string` | 是 | - |

### `list_m3_orders`

[LEGACY] 查询旧 M3 数据提供器中的订单列表，仅供已有调用兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/orders`，超时 `60s`

输入：

无固定顶层字段；以 JSON Schema 的组合约束为准。

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `array` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `get_m3_order`

[LEGACY] 查询旧 M3 数据提供器中的单个订单，仅供已有调用兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/orders/{order_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `get_m3_procurement_plan`

[LEGACY] 查询并运行旧版聚合采购计划，仅供已有调用兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/procurement-plan`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_id` | `string` | 是 | 要查计划的目标订单 ID。 |
| `expand_bom` | `boolean` | 否 | 是否展开多层级 BOM 明细行。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `get_persisted_m3_plan`

[LEGACY] 读取旧版持久化采购计划全量 bundle，仅供已有调用兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/persisted/procurement-plans/{plan_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `get_material_readiness_snapshot`

正式 M5 物料齐套快照：按订单生成/查询逐料齐备快照（material readiness snapshot），返回订单级齐套状态（ready/partial/shortage/quality_hold/unknown）、最早可齐套时间、逐料 required/allocated/shortage 数量与 trusted ready time、每个库存 lot 或采购行的 allocation 明细（source/quantity/available_at/confidence/checksum）及固定输入版本。回答“某订单物料齐不齐、缺什么料、什么时候能齐”时使用本工具。订单号示例：ORD-DEMO-M3-0001。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/material-readiness-snapshot`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_id` | `string` | 是 | 目标订单 ID，例如 ORD-DEMO-M3-0001。 |
| `tenant_id` | `string` | 是 | 必填租户 ID；仅查询该租户的持久化计划。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_material_readiness`

[LEGACY] 查询旧版物料齐套和 PMC 交接结果；该职责不再属于正式 M3，请改用 get_material_readiness_snapshot。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/material-readiness`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `get_pr_po_drafts`

[LEGACY] 查询旧版 PR/PO 草稿；采购执行职责应迁移到 M4。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/pr-po-drafts`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `get_m3_approval_tasks`

[LEGACY] 查询旧版 M3 审批任务；正式 M3 不再产生审批任务。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/approval-tasks`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `array` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `approve_m3_task`

[LEGACY] 审批旧版 M3 任务，仅供已有流程兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/m3/approval-tasks/{approval_id}:approve`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `approval_id` | `string` | 是 | - |
| `order_id` | `string` | 是 | - |
| `actor_user` | `string` | 是 | - |
| `actor_role` | `string` | 是 | - |
| `comment` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `reject_m3_task`

[LEGACY] 驳回旧版 M3 任务，仅供已有流程兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/m3/approval-tasks/{approval_id}:reject`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `approval_id` | `string` | 是 | - |
| `order_id` | `string` | 是 | - |
| `actor_user` | `string` | 是 | - |
| `actor_role` | `string` | 是 | - |
| `comment` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `request_change_m3_task`

[LEGACY] 请求修改旧版 M3 任务，仅供已有流程兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/m3/approval-tasks/{approval_id}:request-change`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `approval_id` | `string` | 是 | - |
| `order_id` | `string` | 是 | - |
| `actor_user` | `string` | 是 | - |
| `actor_role` | `string` | 是 | - |
| `comment` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `approve_to_send_m3_task`

[LEGACY] 批准并发送旧版供应商消息；该职责应迁移到 M4。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/m3/approval-tasks/{approval_id}:approve_to_send`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `approval_id` | `string` | 是 | - |
| `order_id` | `string` | 是 | - |
| `actor_user` | `string` | 是 | - |
| `actor_role` | `string` | 是 | - |
| `comment` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `object` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `get_m3_m4_handoffs`

[LEGACY] 查询旧版 M3 到 M4 handoff 记录，仅供已有流程兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/procurement-plan/{plan_id}/m4-handoffs`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 否 | - |
| `data` | `array` | 否 | - |
| `trace_id` | `string` | 否 | - |

### `export_m3_procurement_suggestions`

[LEGACY] 导出旧版采购建议供 Orchestrator 转发 M4，仅供已有流程兼容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/m3/procurement-plan/{plan_id}/export-suggestions`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_id` | `string` | 是 | 采购计划 ID。 |
| `tenant_id` | `string` | 是 | 由已认证 Orchestrator 传入的租户 ID。 |
| `version_id` | `string` | 是 | 当前 M3 运行返回的不可变采购计划版本 ID。 |
| `source_plan_checksum` | `string` | 是 | 当前 M3 运行返回的原始计划内容 SHA-256。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_id` | `string` | 否 | - |
| `procurement_plan_id` | `string` | 否 | - |
| `procurement_plan_version_id` | `string` | 否 | - |
| `version_id` | `string` | 否 | - |
| `source_plan_checksum` | `string` | 否 | - |
| `observed_at` | `string` | 否 | 不可变采购计划快照的创建时间；同一 version_id 重复导出保持不变。 |
| `tenant_id` | `string` | 否 | - |
| `tracking_task_id` | `string` | 否 | 从 X-Yunpai-Task-ID 原样校验并返回的业务追踪 ID。 |
| `suggestions` | `array` | 否 | 采购建议行数组,每条含 item_code/item_name/quantity/unit/supplier_name/required_date/project_code。 |
| `count` | `integer` | 否 | - |

### `receive_m3_material_demand`

接收 M5 排程发布后的 material-demand 反馈（经 orchestrator bridge 转交 M3）。幂等受理并持久化（同 task_id+event_id 重放返回同一 feedback_ref）；应用（并入计划缺口）由后续阶段人工/规则确认，本工具只受理记录。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/m3/material-demand/receive`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `feedback_type` | `string` | 是 | - |
| `event_id` | `string` | 是 | - |
| `task_id` | `string` | 是 | - |
| `event_kind` | `string` | 否 | - |
| `event_version` | `integer` | 否 | - |
| `schema_version` | `string` | 否 | - |
| `base_plan_version` | `string | null` | 否 | - |
| `plan_version` | `string` | 是 | - |
| `scenario_id` | `string` | 否 | - |
| `lifecycle_status` | `string` | 否 | - |
| `source_input_hash` | `string` | 否 | - |
| `affected_lines` | `array` | 否 | - |
| `occurred_at` | `string` | 否 | - |
| `observed_at` | `string` | 否 | - |
| `checksum` | `string` | 否 | - |
| `feedback_ref` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

## M4 能力

默认服务地址：`http://m4:8000`。完整 Schema：`registry/tool-manifests/m4.json`。

### `import_m4_purchase_suggestions`

[LEGACY/LOCAL] 导入采购建议 CSV。共享及生产环境默认关闭无租户导入；正式 M3→M4 交接必须使用 import_m4_purchase_suggestions_json，并携带租户、站点、TaskID、版本和授权。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/import-batches`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `file` | `string` | 是 | M3采购建议CSV文件。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer | null` | 否 | - |
| `filename` | `string` | 否 | - |
| `total_rows` | `integer` | 否 | - |
| `valid_rows` | `integer` | 否 | - |
| `invalid_rows` | `integer` | 否 | - |
| `duplicate_rows` | `integer` | 否 | - |
| `status` | `string` | 否 | - |
| `items` | `array` | 否 | - |

### `import_m4_purchase_suggestions_json`

以 JSON 方式导入采购建议到 M4（供 orchestrator 自动化调用，无需 multipart 文件上传）。接受采购建议数组，每条含 item_code、item_name、quantity、unit、supplier_name、required_date、project_code。当 orchestrator 需要把 M3 的采购建议自动流转到 M4 时使用——M3 导出的采购建议可直接作为此工具的 suggestions 参数。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/suggestions/import-json`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `suggestions` | `array` | 是 | 采购建议数组，每条含 item_code、item_name、quantity、unit、supplier_name、required_date、project_code。 |
| `tenant_id` | `string` | 否 | 受信 tenant 标识；提供时必须同时提供 site_id。 |
| `site_id` | `string` | 否 | M4 采购归属站点；提供时必须同时提供 tenant_id，且与 data_scope 含义独立。 |
| `tracking_task_id` | `string` | 否 | 根 Tracking TaskID（X-Yunpai-Task-ID 原样传播，幂等作用域一部分） |
| `idempotency_key` | `string` | 否 | 幂等键：同 (tracking_task_id, idempotency_key) 同正文 replay 返回原批次，异正文 409 |
| `source_module` | `string` | 否 | 来源模块（如 m3） |
| `procurement_plan_id` | `string` | 否 | M3 采购计划 ID |
| `procurement_plan_version_id` | `string` | 否 | M3 采购计划版本 ID |
| `source_plan_checksum` | `string` | 否 | M3 计划内容 checksum（若提供） |
| `order_id` | `string` | 否 | 业务订单 ID |
| `order_version` | `string` | 否 | 订单版本（若提供） |
| `project_id` | `string` | 否 | - |
| `bom_id` | `string` | 否 | - |
| `source_event_id` | `string` | 否 | 来源事件 ID（稳定、可追溯） |
| `observed_at` | `string` | 否 | - |
| `actor` | `string` | 否 | 受信主体（展示/审计用，RBAC 收紧在后续 MR） |
| `data_scope` | `string` | 否 | 来源命令的数据可见范围审计值，不作为 site_id。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer | null` | 否 | - |
| `filename` | `string` | 否 | - |
| `total_rows` | `integer` | 否 | - |
| `valid_rows` | `integer` | 否 | - |
| `invalid_rows` | `integer` | 否 | - |
| `duplicate_rows` | `integer` | 否 | - |
| `status` | `string` | 否 | - |
| `tenant_id` | `string | null` | 否 | - |
| `site_id` | `string | null` | 否 | - |
| `tracking_task_id` | `string | null` | 否 | - |
| `idempotency_key` | `string | null` | 否 | - |
| `source_plan_id` | `string | null` | 否 | - |
| `source_plan_version` | `string | null` | 否 | - |
| `source_plan_checksum` | `string | null` | 否 | - |
| `source_order_id` | `string | null` | 否 | - |
| `payload_digest` | `string | null` | 否 | - |
| `items` | `array` | 否 | - |

### `list_m4_purchase_suggestions`

查询 M4 已导入的采购建议清单，可按批次、供应商、物料编码和校验状态过滤。当需要查看哪些采购建议有效、哪些需要修正时使用。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/suggestions`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `batch_id` | `integer` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `item_code` | `string` | 否 | - |
| `validation_status` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | `array` | 否 | - |
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `total` | `integer` | 否 | - |

### `generate_m4_purchase_orders`

根据同一导入批次的有效采购建议生成采购单草稿。tenant/site 省略时继承批次归属；显式提供时必须与批次一致。已追踪批次要求 X-Yunpai-Task-ID 与批次完全一致，生成结果持久化来源批次和同一 TaskID。历史无归属/无 TaskID 批次不会补造身份。同一完整建议 ID 集合重放返回原采购单；作用域、来源、TaskID 不一致或部分/混合复用返回冲突。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/purchase-orders/generate`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `suggestion_item_ids` | `array` | 是 | - |
| `tenant_id` | `string` | 否 | 可选；提供时必须同时提供 site_id，作为新采购单的 M4 归属。 |
| `site_id` | `string` | 否 | 可选；提供时必须同时提供 tenant_id，作为新采购单的 M4 归属。 |

输出：

无固定顶层字段；以 JSON Schema 的组合约束为准。

### `list_m4_purchase_orders`

查询 M4 采购单列表，可按状态和供应商过滤。当用户需要查看采购单草稿、审核中、已批准或已发送的采购单时使用。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/purchase-orders`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `status` | `string` | 否 | - |
| `supplier_name` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | `array` | 否 | - |
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `total` | `integer` | 否 | - |

### `get_m4_purchase_order`

查询单个采购单的完整明细（含采购单号、供应商、状态、需求日期和行项）。当用户问‘这张采购单具体情况’‘采购单明细’‘这张单到哪个状态了’时使用。在审批或发送前用此确认采购单内容。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/purchase-orders/{purchase_order_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `purchase_order_id` | `integer` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `purchase_order_no` | `string` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `status` | `string` | 否 | - |
| `required_date` | `string | null` | 否 | - |
| `items` | `array` | 否 | - |

### `submit_m4_purchase_order_review`

将受控采购单草稿提交人工审核（draft/request_changes → pending_review）。必须绑定根 TaskID 以及当前采购单 revision/checksum；过期写入返回 409。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/purchase-orders/{purchase_order_id}/submit-review`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `purchase_order_id` | `integer` | 是 | - |
| `expected_revision` | `integer` | 是 | - |
| `expected_checksum` | `string` | 是 | - |
| `comment` | `string` | 否 | 可选送审备注。 |
| `operated_by` | `string` | 否 | 可选操作人。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `purchase_order_no` | `string` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `status` | `string` | 否 | - |
| `required_date` | `string | null` | 否 | - |
| `items` | `array` | 否 | - |

### `approve_m4_purchase_order`

人工批准受控采购单（pending_review → approved_for_message）。必须绑定根 TaskID 以及待审采购单的准确 revision/checksum；批准仅允许生成供应商邮件草稿，不代表已发送或已入库。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/purchase-orders/{purchase_order_id}/approve`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `purchase_order_id` | `integer` | 是 | - |
| `expected_revision` | `integer` | 是 | - |
| `expected_checksum` | `string` | 是 | - |
| `comment` | `string` | 否 | 可选审批备注。 |
| `operated_by` | `string` | 否 | 可选审批人。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `purchase_order_no` | `string` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `status` | `string` | 否 | - |
| `required_date` | `string | null` | 否 | - |
| `items` | `array` | 否 | - |

### `request_changes_m4_purchase_order`

人工将受控采购单退回修改（pending_review → request_changes）。必须绑定根 TaskID 以及待审采购单的准确 revision/checksum，并保留退回原因。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/purchase-orders/{purchase_order_id}/request-changes`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `purchase_order_id` | `integer` | 是 | - |
| `expected_revision` | `integer` | 是 | - |
| `expected_checksum` | `string` | 是 | - |
| `comment` | `string` | 否 | 可选驳回原因。 |
| `operated_by` | `string` | 否 | 可选审批人。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `purchase_order_no` | `string` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `status` | `string` | 否 | - |
| `required_date` | `string | null` | 否 | - |
| `items` | `array` | 否 | - |

### `generate_m4_purchase_inquiry_message`

基于已人工批准的采购单生成供应商邮件草稿。必须绑定采购单 revision/checksum，并保存人工核对的收件人和附件快照；仅生成草稿，不对外发送，也不产生到货或库存事实。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/purchase-orders/{purchase_order_id}/inquiry-message`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `purchase_order_id` | `integer` | 是 | - |
| `expected_po_revision` | `integer` | 是 | - |
| `expected_po_checksum` | `string` | 是 | - |
| `recipient_snapshot` | `object` | 是 | 人工核对的收件人快照；模拟验收必须明确 simulation_only=true。 |
| `attachment_snapshot` | `array` | 否 | - |
| `channel` | `string` | 否 | - |
| `language` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `message_id` | `integer` | 否 | - |
| `subject` | `string | null` | 否 | - |
| `content` | `string` | 否 | - |
| `channel` | `string` | 否 | - |
| `recipient` | `string | null` | 否 | - |
| `send_status` | `string` | 否 | - |
| `model_name` | `string | null` | 否 | - |
| `prompt_version` | `string | null` | 否 | - |

### `send_m4_purchase_order`

[LEGACY/LOCAL] 旧版采购单发送记录，仅供无 TaskID 的本地兼容流程；39085 受控流程禁止调用。受控流程必须使用采购单审核、独立邮件审核和 record-simulated，且不得据此生成到货或库存事实。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/purchase-orders/{purchase_order_id}/send`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `purchase_order_id` | `integer` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `purchase_order_no` | `string` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `status` | `string` | 否 | - |
| `items` | `array` | 否 | - |

### `create_m4_supplier_reply`

保存供应商回复原文，用于后续 AI 解析交期、价格和异常。适用于采购员收到邮件、微信、钉钉等供应商回复后录入 M4。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/replies`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `purchase_order_id` | `integer` | 是 | - |
| `purchase_order_no` | `string` | 是 | - |
| `supplier_name` | `string` | 是 | - |
| `reply_content` | `string` | 是 | - |
| `received_at` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `purchase_order_id` | `integer` | 否 | - |
| `purchase_order_no` | `string` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `reply_content` | `string` | 否 | - |
| `received_at` | `string | null` | 否 | - |

### `parse_m4_supplier_reply`

解析供应商回复，提取承诺交期、价格、币种、税含标记和异常说明。低置信度结果会标记 need_human_review，需要人工确认。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/replies/{reply_id}/parse`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `reply_id` | `integer` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `delivery_date` | `string | null` | 否 | - |
| `unit_price` | `number | string | null` | 否 | - |
| `currency` | `string` | 否 | - |
| `tax_included` | `boolean | null` | 否 | - |
| `exception_type` | `string | null` | 否 | - |
| `exception_description` | `string | null` | 否 | - |
| `confidence` | `number` | 否 | - |
| `need_human_review` | `boolean` | 否 | - |

### `confirm_m4_supplier_reply`

人工确认或修正供应商回复的 AI 解析结果。parse_m4_supplier_reply 标记 need_human_review=true 时，用此工具提交确认后的交期/价格/异常等字段，闭合 HITL 环节。确认后的结果才作为正式承诺写入追踪。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/replies/{reply_id}/confirm`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `reply_id` | `integer` | 是 | - |
| `delivery_date` | `string | null` | 否 | 确认后的承诺交期（YYYY-MM-DD）。 |
| `unit_price` | `number | string | null` | 否 | 确认后的单价。 |
| `currency` | `string` | 否 | - |
| `tax_included` | `boolean | null` | 否 | - |
| `exception_type` | `string | null` | 否 | - |
| `exception_description` | `string | null` | 否 | - |
| `confidence` | `number` | 否 | 确认后的置信度，通常置为 1.0。 |
| `need_human_review` | `boolean` | 是 | 是否仍需人工复核；人工确认时一般传 false。 |
| `confirmed_by` | `string` | 否 | 可选确认人。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `delivery_date` | `string | null` | 否 | - |
| `unit_price` | `number | string | null` | 否 | - |
| `currency` | `string` | 否 | - |
| `tax_included` | `boolean | null` | 否 | - |
| `exception_type` | `string | null` | 否 | - |
| `exception_description` | `string | null` | 否 | - |
| `confidence` | `number` | 否 | - |
| `need_human_review` | `boolean` | 否 | - |

### `list_m4_suppliers`

查询 M4 供应商主数据列表，可按供应商名称模糊过滤。当用户问‘有哪些供应商’‘某供应商的联系方式’‘供应商主数据’时使用。返回分页供应商信息（名称、联系人、邮箱、电话、默认渠道、状态）。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/suppliers`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `supplier_name` | `string` | 否 | 可选供应商名称过滤。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | `array` | 否 | - |
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `total` | `integer` | 否 | - |

### `create_m4_supplier`

新建供应商主数据。当采购需要登记一个新供应商（含联系人、邮箱、电话、默认沟通渠道）时使用。新建后的供应商可用于采购单和询价消息。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/suppliers`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `supplier_name` | `string` | 是 | - |
| `contact_name` | `string` | 否 | - |
| `email` | `string` | 否 | - |
| `phone` | `string` | 否 | - |
| `default_channel` | `string` | 否 | 默认沟通渠道，如 email/wechat/dingtalk。 |
| `remark` | `string` | 否 | - |
| `status` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `contact_name` | `string | null` | 否 | - |
| `email` | `string | null` | 否 | - |
| `phone` | `string | null` | 否 | - |
| `default_channel` | `string` | 否 | - |
| `remark` | `string | null` | 否 | - |
| `status` | `string` | 否 | - |

### `update_m4_supplier`

更新供应商主数据（联系人、邮箱、电话、默认渠道、状态等）。当供应商信息变更（换联系人、改邮箱、停用）时使用。status 常用于启用/停用供应商。

- 类型：`tool`
- 执行：`sync`
- HTTP：`PATCH /api/m4/suppliers/{supplier_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `supplier_id` | `integer` | 是 | - |
| `supplier_name` | `string` | 否 | - |
| `contact_name` | `string` | 否 | - |
| `email` | `string` | 否 | - |
| `phone` | `string` | 否 | - |
| `default_channel` | `string` | 否 | - |
| `remark` | `string` | 否 | - |
| `status` | `string` | 否 | 如 active/inactive。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | `integer` | 否 | - |
| `supplier_name` | `string` | 否 | - |
| `contact_name` | `string | null` | 否 | - |
| `email` | `string | null` | 否 | - |
| `phone` | `string | null` | 否 | - |
| `default_channel` | `string` | 否 | - |
| `remark` | `string | null` | 否 | - |
| `status` | `string` | 否 | - |

### `list_m4_tracking`

查询采购追踪结果，包括供应商承诺交期、价格、异常、到货状态和是否超期。当 M5 或项目总览需要了解采购执行状态时使用。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/tracking`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | `array` | 否 | - |
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `total` | `integer` | 否 | - |

### `scan_m4_purchase_alerts`

触发 M4 采购预警扫描，生成超期、临期和供应商异常等预警。当需要刷新采购风险看板或联动催单时使用。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/alerts/scan`，超时 `60s`

输入：

无固定顶层字段；以 JSON Schema 的组合约束为准。

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `scanned` | `integer` | 否 | - |
| `created` | `integer` | 否 | - |

### `list_m4_purchase_alerts`

查询 M4 采购预警列表，可按状态和预警类型过滤。当用户需要查看超期、临期、异常供应商回复或催单对象时使用。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/alerts`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `status` | `string` | 否 | - |
| `alert_type` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `items` | `array` | 否 | - |
| `page` | `integer` | 否 | - |
| `page_size` | `integer` | 否 | - |
| `total` | `integer` | 否 | - |

### `generate_m4_urge_message`

为指定采购预警生成催单话术草稿（AI 生成，不直接发送）。只允许 open 状态预警调用；生成成功会覆盖该预警的催单文本，按 alert_type 区分已超期/临期/供应商异常措辞。当需要对超期或临期采购生成催单文本时使用。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/alerts/{alert_id}/urge-message`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `alert_id` | `integer` | 是 | - |
| `channel` | `string` | 否 | - |
| `language` | `string` | 否 | 可选目标输出语言，如 zh-CN、en-US、ja-JP。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `alert_id` | `integer` | 否 | - |
| `urge_message` | `string` | 否 | - |
| `channel` | `string` | 否 | - |
| `model_name` | `string | null` | 否 | - |
| `prompt_version` | `string | null` | 否 | - |

### `query_m4_material_supply_snapshot`

按期望租户、站点、物料和观测窗口读取 M4 当前采购供应投影。tenant_id 必须与认证 principal 完全一致，返回 snapshot 也以 checksum 绑定该 scope。只返回具有 M4 tenant/site 归属的采购单行；无收货权威时 received/open 均为 null，未知 ETA 和 arrival confidence 保持 null，不能据此释放排程。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/material-supply-snapshots:query`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | `any` | 是 | - |
| `scenario_id` | `string` | 是 | - |
| `tenant_id` | `string` | 是 | - |
| `site_id` | `string` | 是 | - |
| `material_ids` | `array` | 是 | - |
| `as_of` | `string` | 是 | - |
| `horizon_end` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | `any` | 是 | - |
| `snapshot_id` | `string` | 是 | - |
| `snapshot_version` | `integer` | 是 | - |
| `scenario_id` | `string` | 是 | - |
| `tenant_id` | `string` | 是 | - |
| `site_id` | `string` | 是 | - |
| `as_of` | `string` | 是 | - |
| `horizon_end` | `string` | 是 | - |
| `generated_at` | `string` | 是 | - |
| `observed_at` | `string` | 是 | - |
| `entity_version` | `string` | 是 | - |
| `lines` | `array` | 是 | - |
| `completeness` | `object` | 是 | - |
| `input` | `object` | 是 | - |
| `input_checksum` | `string` | 是 | - |
| `checksum` | `string` | 是 | - |

### `list_m4_material_supply_events`

按认证 tenant/site scope 和版本游标增量读取 M4 物料供应变化事件。用于排程发现供应商确认、ETA、发运、收货、质量冻结或取消后的确定性变化，并支持在同一 tenant/site 流内断点续取。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/material-supply-events`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `site_id` | `string` | 是 | - |
| `after_version` | `integer` | 否 | - |
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | `any` | 是 | - |
| `site_id` | `string` | 是 | - |
| `after_version` | `integer` | 是 | - |
| `items` | `array` | 是 | - |
| `has_more` | `boolean` | 是 | - |
| `next_after_version` | `integer` | 是 | - |

### `get_m4_material_supply_snapshot`

按 snapshot_id 和 snapshot_version 精确读取一份已持久化的 M4 供应快照。用于重试、审计或恢复排程输入；绝不以最新版本替代请求的不可变版本。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/m4/material-supply-snapshots/{snapshot_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `snapshot_id` | `string` | 是 | - |
| `snapshot_version` | `integer` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | `any` | 是 | - |
| `snapshot_id` | `string` | 是 | - |
| `snapshot_version` | `integer` | 是 | - |
| `scenario_id` | `string` | 是 | - |
| `tenant_id` | `string` | 是 | - |
| `site_id` | `string` | 是 | - |
| `as_of` | `string` | 是 | - |
| `horizon_end` | `string` | 是 | - |
| `generated_at` | `string` | 是 | - |
| `observed_at` | `string` | 是 | - |
| `entity_version` | `string` | 是 | - |
| `lines` | `array` | 是 | - |
| `completeness` | `object` | 是 | - |
| `input` | `object` | 是 | - |
| `input_checksum` | `string` | 是 | - |
| `checksum` | `string` | 是 | - |

### `confirm_m4_supplier_fact`

由已授权人员确认供应商回复的当前解析版本到一条 M4 采购单行。只在人工核对承诺日期或供应异常后使用；调用方不能提供确认人或确认时间，重复确认返回原结果，改变同一回复版本的事实返回冲突。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/replies/{reply_id}/supply-facts/confirm`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `reply_id` | `integer` | 是 | - |
| `schema_version` | `any` | 是 | - |
| `purchase_order_item_id` | `integer` | 是 | - |
| `supplier_reply_version` | `integer` | 是 | - |
| `result` | `object` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | `any` | 是 | - |
| `id` | `integer` | 是 | - |
| `purchase_order_item_id` | `integer` | 是 | - |
| `supplier_reply_id` | `integer` | 是 | - |
| `supplier_reply_version` | `integer` | 是 | - |
| `confirmed_by` | `string` | 是 | - |
| `confirmed_at` | `string` | 是 | - |
| `parse_confidence` | `string | null` | 是 | - |
| `delivery_date` | `string | null` | 是 | - |
| `exception_type` | `string | null` | 是 | - |
| `exception_description` | `string | null` | 是 | - |
| `result_payload` | `object` | 是 | - |
| `checksum` | `string` | 是 | - |

### `receive_m4_schedule_impact_proposal`

接收 M5 排程需求变更建议（schedule-impact proposal，经 orchestrator bridge 转交 M4）。幂等受理并持久化（同 task_id+proposal_id 或同 task_id+idempotency_key 重放返回同一结果）；应用（调整采购建议/PO）由后续人工/规则确认，本工具只受理记录。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/m4/schedule-impact-proposals`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schema_version` | `string` | 是 | - |
| `proposal_id` | `string` | 是 | - |
| `plan_version` | `string` | 是 | - |
| `scenario_id` | `string` | 否 | - |
| `material_id` | `string` | 是 | - |
| `required_quantity` | `string` | 否 | - |
| `uom` | `string` | 否 | - |
| `previous_required_at` | `string` | 否 | - |
| `required_at` | `string` | 否 | - |
| `impact_type` | `string` | 否 | - |
| `affected_orders` | `array` | 否 | - |
| `reason_code` | `string` | 否 | - |
| `m3_readiness_version` | `string` | 否 | - |
| `m4_supply_version` | `string` | 否 | - |
| `evidence` | `array` | 否 | - |
| `feedback_ref` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `received` | `boolean` | 是 | - |
| `proposal_id` | `string` | 是 | - |
| `replayed` | `boolean` | 是 | - |

## M5 能力

默认服务地址：`http://m5-api:8000`。完整 Schema：`registry/tool-manifests/m5.json`。

### `solve_scheduling`

幂等求解并持久化一版 M5 排程候选。输入真实订单、已审批工艺/工时、资源、班次及幂等键，输出 draft 计划、校验报告和版本号。生产排程、后续人工审批/发布或动态重排必须使用本工具；缺少外部事实时失败关闭。缺权威数据（订单/工艺/资源/物料可用性/生产单元映射）时由编排层返回可恢复 data_incomplete（数据未完善）；本工具不补造默认库存、批次或生产单元。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/schedule-candidates`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `idempotency_key` | `string` | 是 | 调用方生成的稳定幂等键；同键不同输入返回 409。 |
| `expected_head_plan_version` | `string | null` | 否 | 场景已有计划时必须给出预期 head；首次创建为 null。 |
| `scenario_id` | `string` | 是 | - |
| `scenario_purpose` | `string` | 否 | 机器可读的生命周期身份；pressure_only 只允许诊断求解，不得审批、发布或派工。 |
| `production_units` | `array` | 否 | 调用方声明的稳定生产单元映射；生产生命周期要求可信适配器核验且完整覆盖订单、资源、日历和仓库。 |
| `cross_unit_order_dependencies` | `array` | 否 | 不得在分区时静默截断的显式跨单元订单依赖。 |
| `planning_start` | `string` | 是 | - |
| `solver` | `string` | 否 | - |
| `explain_with_llm` | `boolean` | 否 | 遗留兼容字段，核心求解路径忽略该开关且只返回规则解释；需要 LLM 说明时调用 run_m5_intelligent_schedule。 |
| `source_systems` | `array` | 否 | 本次规划事实的来源系统；包含非 manual 来源时必须提供逐来源观测时间。 |
| `observed_at` | `string | null` | 否 | 兼容旧调用的整包观测时间；未提供 source_observed_at 时应用于全部已声明外部来源。 |
| `source_observed_at` | `object` | 否 | 逐来源权威观测时间；每个外部来源分别接受 24 小时 freshness 校验，新来源不能刷新其他来源。 |
| `orders` | `array` | 是 | - |
| `routing_steps` | `array` | 是 | - |
| `resources` | `array` | 是 | - |
| `tooling_resources` | `array` | 否 | 模具、治具、工装主数据：tooling_id/name/quantity_available/status/compatible_product_ids/compatible_setup_families。 |
| `tooling_requirements` | `array` | 否 | 工序所需模治具：operation_id/tooling_id/product_id/quantity。 |
| `changeover_rules` | `array` | 否 | 相邻任务换型矩阵：from_setup_family/to_setup_family/changeover_minutes，可按 resource_id 限定。 |
| `missing_changeover_policy` | `string` | 否 | 缺少换型规则时默认禁止该切换。 |
| `labor_skills` | `array` | 否 | 稳定技能主数据：skill_id/version/effective interval/production_unit_ids/capacity_unit/source classification。 |
| `labor_requirements` | `array` | 否 | 工序技能需求：operation_id/skill_id/skill_version/production_unit_id/quantity，可按 product_id 限定。 |
| `labor_capacity_windows` | `array` | 否 | 人员能力窗口：skill_id/skill_version/production_unit_id/capacity_source_id/aggregation_mode/start_time/end_time/capacity/is_overtime。 |
| `labor_capacity_adjustments` | `array` | 否 | 缺勤或临时能力调整：adjustment_id/skill/version/unit/start/end/capacity_delta/reason_code。 |
| `calendar_windows` | `array` | 否 | - |
| `resource_unavailability` | `array` | 否 | 设备/产线停机窗口：resource_id/start_time/end_time/reason/confirmed。 |
| `order_kitting` | `array` | 否 | 订单齐套状态与最早齐套时间。 |
| `wip_status` | `array` | 否 | 一线在制状态：中间工序必须提供 route_version 和完整 completed_operation_ids 证据。 |
| `manual_locks` | `array` | 否 | 人工锁单：order_id/operation_id/resource_id/start_time/end_time/reason/locked_by；start_time 和 end_time 必须相对 planning_start 为整分钟。planning_start 可带秒或微秒。 |
| `frozen_windows` | `array` | 否 | 计划冻结窗口：start_time/end_time/reason，可按 resource_id 限定。 |
| `material_availability` | `array` | 否 | - |
| `material_substitutions` | `array` | 否 | - |
| `product_bom_items` | `array` | 否 | - |
| `pmc_rules` | `array` | 否 | - |
| `material_policy` | `object` | 否 | - |
| `predicted_operation_parameters` | `array` | 否 | - |
| `optimization_weights` | `object` | 否 | 目标权重：makespan/tardiness/setup_time/resource_preference/changeover_time/changeover_count/labor_overtime。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_m5_schedule`

按 plan_version 查询权威持久化计划详情、lifecycle_status、校验状态、父版本、触发事件和输入哈希。审批、发布、派工或重排前用于确认当前版本状态。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/schedules/{plan_version}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_version` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_m5_pmc_progress`

按不可变 plan_version 查询可在正式 Agent 展示的 M5 生产上下文。仅接受 production、released、validation-passed 且为当前 scenario head 的计划；否则拒绝。返回 PMC 计算计划、M5 资源主数据、已接受的非 simulation 执行证据及人工维护的订单级人员绑定。人员绑定不代表 HR、考勤或实时在岗。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/pmc/progress`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_version` | `string` | 是 | 要查询的权威排程版本号。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `replan_m5_schedule`

从已持久化的权威计划输入应用一个幂等生产事件并动态重排。服务端恢复原始输入，校验场景 head，禁止客户端用陈旧或伪造的完整快照覆盖当前状态。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/schedules/{base_plan_version}/replan-from-version`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `base_plan_version` | `string` | 是 | 当前场景的权威 head 版本。 |
| `idempotency_key` | `string` | 是 | - |
| `expected_head_plan_version` | `string | null` | 否 | 省略时等于 base_plan_version。 |
| `event` | `object` | 是 | - |
| `freeze_policy` | `object | null` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_m5_integration_contracts`

查询 M5 与 M1-M4、M6-M8 按方向和交付项拆分的接口需求、readiness（available/partial/proposed/blocked/current_none）及缺口。返回的 JSON Schema 只是 M5 侧载荷结构，不代表对端接口、生成、持久化、投递或回执已经可用。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/contracts`，超时 `60s`

输入：

无固定顶层字段；以 JSON Schema 的组合约束为准。

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `list_m5_schedules`

查询 M5 历史排程版本列表，可按 scenario_id 过滤、限制返回条数。scenario_id 遵循约定格式 scenario-{订单号}（例如订单 SO-HIST-20260724-005 的场景是 scenario-SO-HIST-20260724-005）；当用户问某订单的排程/排程版本/历史排程时，优先用该格式构造场景过滤，或先用 get_business_order_trace 获取订单排程摘要中的 plan_version。返回排程版本摘要（不含完整 operations，避免响应过大）。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/schedules`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `scenario_id` | `string` | 否 | 可选场景过滤。 |
| `limit` | `integer` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_m5_material_readiness`

查询某场景是否具备生产排程所需事实，并返回逐检查项的 pass/warn/fail；其中 material-or-kitting 仅汇总判断是否提供物料可用量或订单齐套证据。它不返回逐物料到位/缺料清单或预计到料时间；需要逐料采购缺口与需求时间时调用 generate_m5_material_procurement_plan。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/integrations/snapshots/{scenario_id}/readiness`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `scenario_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `search_m5_knowledge`

检索 M5 内置知识库中与给定特征相似的历史排程案例（RAG）。当用户问‘类似订单以前怎么排的’‘有没有相似场景的经验’‘这种产品排程要注意什么’时使用。输入特征描述当前场景，返回 top_k 个最相似的历史案例及结果。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/knowledge/search`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `features` | `object` | 是 | 当前场景的特征描述（产品类型、订单规模、交期紧迫度等），用于检索相似历史案例。 |
| `top_k` | `integer` | 否 | - |
| `outcome_filter` | `string` | 否 | 可选：只返回某结果类型的案例。 |
| `tag_filter` | `string` | 否 | 可选：按标签过滤。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `record_m5_knowledge`

把一个已持久化的 M5 排程版本沉淀为知识案例。只提交 plan_version、标签和备注；输入、结果及案例哈希由 M5 从数据库权威版本读取。版本或权威载荷缺失时返回“数据未完善”，不会使用调用方副本补造事实。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/knowledge/record`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_version` | `string` | 是 | - |
| `tags` | `array` | 否 | - |
| `note` | `string` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `prepare_m5_department_message`

根据排程、异常或执行反馈的结构化证据起草企业部门消息并持久化为 pending_approval。LLM 只可生成 subject/body；部门、渠道、收件人、证据与幂等键由调用方提供。本工具不会审批或直接发送。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/messages/prepare`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `department` | `string` | 是 | - |
| `channel` | `string` | 是 | - |
| `recipient_targets` | `array` | 是 | - |
| `message_kind` | `string` | 是 | - |
| `event_summary` | `string` | 是 | - |
| `required_action` | `string` | 是 | - |
| `evidence` | `array` | 是 | - |
| `idempotency_key` | `string` | 是 | - |
| `template_key` | `string | null` | 否 | - |
| `template_variables` | `object` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_m5_department_message`

查询部门消息草稿及人工审批状态。消息只有 approved 后才会进入耐久 Outbox；LLM 或 Agent 无权代替审批人。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/messages/{draft_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `draft_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_m5_department_message_delivery`

查询已批准部门消息的耐久 Outbox 投递状态、尝试次数和 provider message id。不会触发重试或绕过审批。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/messages/outbox/{outbox_id}`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `outbox_id` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `advise_m5_schedule`

基于已有排程结果给出 PMC 辅助决策建议——催料、加班、协商交期等软约束优化方向。当排程结果准交率不理想或存在延期，用户问‘怎么办’‘怎么改善’‘能不能优化’时使用。输入是排程结果（ScheduleResponse），输出是建议动作清单。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/schedules/advise`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `scenario_id` | `string` | 是 | - |
| `scenario_purpose` | `string` | 是 | - |
| `plan_version` | `string` | 是 | - |
| `solver_status` | `string` | 是 | - |
| `operations` | `array` | 是 | - |
| `metrics` | `object` | 是 | - |
| `validation_report` | `object` | 是 | - |
| `risks` | `array` | 否 | - |
| `messages` | `array` | 否 | - |
| `order_kitting` | `array` | 否 | - |
| `prediction_summary` | `object | null` | 否 | - |
| `predicted_operation_parameters` | `array` | 否 | - |
| `solver_diagnostics` | `object | null` | 否 | - |
| `explanation` | `object | null` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `run_m5_intelligent_schedule`

对排程输入执行非持久化分析，并可选生成 LLM 解释、审计文字和决策建议。它不会创建可审批计划；生产生命周期必须先调用 solve_scheduling 持久化候选。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/schedules/intelligent`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `schedule_request` | `object` | 是 | 基础排程请求；外部来源必须带 source_systems 与逐来源观测时间。此入口只做非持久化分析，不接受重排事件或冻结策略。 |
| `enable_audit` | `boolean` | 否 | 是否生成审计报告。 |
| `enable_advise` | `boolean` | 否 | 是否生成决策建议。 |
| `enable_knowledge_record` | `boolean` | 否 | 兼容开关；智能排程不会写入未绑定案例。请先持久化计划，再调用 record_m5_knowledge。 |
| `auto_replan_on_validation_fail` | `boolean` | 否 | 兼容字段；校验失败现在会失败关闭，不再隐式切换到 baseline。 |
| `knowledge_tags` | `array` | 否 | 兼容字段；本工具不直接沉淀，标签应传给 record_m5_knowledge。 |
| `knowledge_note` | `string` | 否 | 兼容字段；本工具不直接沉淀，备注应传给 record_m5_knowledge。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `dispatch_m5_schedule`

为 lifecycle_status=released 的计划创建 M5 本地耐久待派工记录。必须显式给出工序键和幂等键；当前 M5 没有 MES sender/Provider worker，本调用不会把记录发送到 MES，初始状态只能是 pending。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/schedules/{plan_version}/dispatch`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_version` | `string` | 是 | 要派工的排程版本（路径参数）。 |
| `target_system` | `string` | 否 | 目标系统，当前固定 mes。 |
| `requested_by` | `string` | 否 | 可选兼容字段；服务端审计身份始终取认证 principal，不信任调用方自报值。 |
| `idempotency_key` | `string` | 是 | 稳定幂等键；同键异内容返回冲突。 |
| `operation_keys` | `array` | 是 | 显式工序键，格式 order_id:operation_id；未知、空或重复均拒绝。 |
| `payload` | `object` | 否 | 可选附加下发载荷。 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `get_m5_execution_summary`

仅汇总该计划版本中已经通过执行事件接口持久化的数据：事件数、最新事件发生时间、可计算的开始/结束偏差、延期工序数、异常数和报废原始值。它不采集现场数据，也不证明车间完整执行；不返回良品完工、人工/设备/setup/工装/能耗分项，不能替代 m5.actual-operation-evidence.v1 或 m5.cost-consumption.v1 交付。

- 类型：`tool`
- 执行：`sync`
- HTTP：`GET /api/v1/schedules/{plan_version}/execution-summary`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `plan_version` | `string` | 是 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `ingest_m5_planning_snapshot`

把上游（ERP/MES/WMS/PLM 或人工）的规划数据快照写入 M5：订单、工艺路线、资源、工装等。当需要把外部系统的最新主数据/订单数据灌进 M5 再排程时使用，是 M5 接收上游数据的集成入口。replace_existing=true 会覆盖同 scenario 的旧快照。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/integrations/snapshots`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `scenario_id` | `string` | 是 | - |
| `scenario_purpose` | `string` | 否 | 机器可读的生命周期身份；pressure_only 快照生成的计划不得审批、发布或派工。 |
| `production_units` | `array` | 否 | 调用方声明的稳定生产单元映射；生产生命周期另行核验。 |
| `cross_unit_order_dependencies` | `array` | 否 | - |
| `planning_start` | `string` | 否 | - |
| `solver` | `string` | 否 | - |
| `explain_with_llm` | `boolean` | 否 | - |
| `source_systems` | `array` | 否 | - |
| `observed_at` | `string | null` | 否 | 兼容旧调用的整包观测时间；未提供 source_observed_at 时应用于全部已声明外部来源。 |
| `source_observed_at` | `object` | 否 | 逐来源权威观测时间；增量合并分别保存并校验，缺失或陈旧来源会失败关闭。 |
| `replace_existing` | `boolean` | 否 | true 整包替换该场景；false 按业务稳定键增量合并，未提供的实体保持不变。 |
| `orders` | `array` | 否 | - |
| `routing_steps` | `array` | 否 | 工艺路线；eligible_resources 支持 processing_minutes/setup_minutes/cycle_minutes/batch_size/cavity_count/yield_rate，setup_family 用于换型。 |
| `resources` | `array` | 否 | 设备/产线资源；支持 status 与计划开始时已安装模具 initial_setup_family。 |
| `tooling_resources` | `array` | 否 | - |
| `tooling_requirements` | `array` | 否 | - |
| `changeover_rules` | `array` | 否 | from_setup_family/to_setup_family/changeover_minutes/resource_id。 |
| `missing_changeover_policy` | `string` | 否 | - |
| `labor_skills` | `array` | 否 | skill_id/version/effective interval/production_unit_ids/capacity_unit/source classification。 |
| `labor_requirements` | `array` | 否 | operation_id/skill_id/skill_version/production_unit_id/quantity/product_id。 |
| `labor_capacity_windows` | `array` | 否 | skill_id/skill_version/production_unit_id/capacity_source_id/aggregation_mode/start_time/end_time/capacity/is_overtime。 |
| `labor_capacity_adjustments` | `array` | 否 | adjustment_id/skill/version/unit/start/end/capacity_delta/reason_code。 |
| `calendar_windows` | `array` | 否 | - |
| `resource_unavailability` | `array` | 否 | - |
| `material_availability` | `array` | 否 | - |
| `order_kitting` | `array` | 否 | - |
| `wip_status` | `array` | 否 | order_id/operation_id/resource_id/actual_start_time/estimated_remaining_minutes/completed_quantity/status。 |
| `manual_locks` | `array` | 否 | 人工锁单时间必须相对 planning_start 为整分钟；planning_start 可带秒或微秒。 |
| `frozen_windows` | `array` | 否 | - |
| `pmc_rules` | `array` | 否 | - |
| `material_substitutions` | `array` | 否 | - |
| `product_bom_items` | `array` | 否 | - |
| `optimization_weights` | `object` | 否 | - |
| `material_policy` | `object` | 否 | - |
| `predicted_operation_parameters` | `array` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `generate_m5_material_procurement_plan`

基于排程请求生成物料采购计划（哪些料够、哪些要采、采多少、何时要）。当用户问‘排这单要采购哪些料’‘算一下采购需求’‘物料采购计划’时使用。输入与 solve_scheduling 相同的订单/工艺/资源，输出采购计划视角的结果。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/materials/procurement-plan`，超时 `120s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `scenario_id` | `string` | 是 | - |
| `scenario_purpose` | `string` | 否 | - |
| `production_units` | `array` | 否 | 调用方声明的稳定生产单元映射；生产生命周期另行核验。 |
| `cross_unit_order_dependencies` | `array` | 否 | - |
| `planning_start` | `string` | 否 | - |
| `solver` | `string` | 否 | - |
| `explain_with_llm` | `boolean` | 否 | - |
| `source_systems` | `array` | 否 | - |
| `observed_at` | `string | null` | 否 | - |
| `source_observed_at` | `object` | 否 | - |
| `orders` | `array` | 是 | - |
| `routing_steps` | `array` | 是 | - |
| `resources` | `array` | 是 | - |
| `calendar_windows` | `array` | 否 | - |
| `optimization_weights` | `object` | 否 | - |
| `material_availability` | `array` | 否 | - |
| `material_substitutions` | `array` | 否 | - |
| `product_bom_items` | `array` | 否 | - |
| `material_policy` | `object` | 否 | - |
| `order_kitting` | `array` | 否 | - |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `report_workload`

【报工工具，必须调用】工人或组长用自然语言报工并落库。只要用户表达了开工、完工、报产、报废、工时等信息，就必须调用本工具真正落库，不要只用文字回应或谎称已记录。触发语（含但不限于）：「开工」「开始做」「完工」「做完了」「报数 200」「报废 5 个」「做了 8 小时」「今天 SO-xxx 做了 300 个，花了 6 小时」。参数从用户原话提取：worker_id=工号，order_id=订单号，event_type：开工=actual_start，完工=actual_finish，报产=quantity_report，报废=scrap，异常=exception；reported_quantity 只表示本次新增产量（不是累计快照），reported_unit 必须从原话提取并标准化，scrap_quantity=报废数，actual_min=工时分钟，shift_date=日期。若数量/单位疑似错位、单位不确定或无法与计划匹配，先审核澄清，不得猜测落库。服务端仅在数量单位、权威排程订单产品与单位三者验证一致后计入 PMC 实际量。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/worker/report`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `worker_id` | `string` | 是 | 报工工人工号，如 worker-001；组长替组员报工时代入该组员工号 |
| `plan_version` | `string | null` | 否 | 工人任务接口返回的 released 场景头计划版本；多工序报工时与 operation_id、resource_id 一并原样提交 |
| `order_id` | `string` | 是 | 订单号，如 SO-HIST-20260724-001 |
| `operation_id` | `string | null` | 否 | 用户明确说出的工序键；多工序订单未绑定唯一工位时必须提供。 |
| `resource_id` | `string | null` | 否 | 工人任务接口返回的权威排程资源键；多工序报工时与 plan_version、operation_id 一并原样提交 |
| `station` | `string | null` | 否 | 工位展示名称，用于计件归类；工序和资源身份仍以 operation_id、resource_id 为准 |
| `event_type` | `string` | 是 | 报工事件类型；「开工/开始做」→actual_start，「完工/做完了」→actual_finish，「做了 N 个/报数」→quantity_report，「报废 N 个」→scrap，「异常」→exception |
| `reported_quantity` | `number | null` | 否 | 本次报工新增的产出量（delta，不是累计快照）；quantity_report 时提供，并用 reported_unit 显式声明单位 |
| `reported_unit` | `string | null` | 否 | reported_quantity 的单位；必须从用户原话提取并标准化（如 个/件→pcs、米→m），且与权威排程订单单位一致。不确定或疑似字段错位时先审核，禁止猜测后落库。 |
| `scrap_quantity` | `number` | 否 | 报废数量（scrap 时提供） |
| `actual_min` | `number | null` | 否 | 实际工时（分钟）；用户说「6 小时」应换算为 360 分钟 |
| `shift_date` | `string | null` | 否 | 报工日期 YYYY-MM-DD；缺省为今天 |
| `reason` | `string | null` | 否 | 异常/报废原因 |
| `idempotency_key` | `string | null` | 否 | 幂等键；同一次报工重复提交用同一键避免重复落库 |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |

### `bind_worker_to_order`

组长给生产订单绑定组内工人（订单级绑定，用于工人自助报工的订单隔离）。当用户说「把 SO-xxx 订单绑定给王五、李四」「给这个订单分配工人」时使用。需要订单号 order_id、工人列表 worker_ids、班组 team_id。

- 类型：`tool`
- 执行：`sync`
- HTTP：`POST /api/v1/leader/bindings`，超时 `60s`

输入：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `order_id` | `string` | 是 | 订单号 |
| `worker_ids` | `array` | 是 | 要绑定的工人工号列表，如 ["worker-001", "worker-002"] |
| `team_id` | `string` | 是 | 班组 id（组长自己的班组） |
| `resource_id` | `string | null` | 否 | 工位（可选，缺省从排程反推） |
| `station` | `string | null` | 否 | 工序/工位名（可选） |

输出：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `success` | `boolean` | 是 | - |
| `data` | `object` | 是 | - |
| `errors` | `array` | 是 | - |
| `trace_id` | `string` | 是 | - |
