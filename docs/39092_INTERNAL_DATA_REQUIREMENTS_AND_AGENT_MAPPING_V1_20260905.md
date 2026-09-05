# 39092 内部数据需求、规范字段与 Agent 能力映射（V1）

版本：V1.0  
日期：2026-09-05  
用途：内部 Tool/Skill/Agent、M0 canonical、M2 工程、M3/M4 物料供应、M5 PMC 的共同数据基线。

> 这是一份执行版，不是生产数据库 migration。39092 当前实际可写入的是 M0 的导入批次、来源文档、候选、审批、canonical 版本、ledger 和 outbox；M1–M5 的完整业务表仍以各模块服务和版本化快照为准。未经过审批的提取结果只能是 candidate，不能当作生产事实。

## 1. 共同封装：任何事实都必须带的元数据

每一个文件、表、记录和派生事实都要保留：

| 字段 | 类型/格式 | 必填 | 规则 |
|---|---|---:|---|
| tenant_id | string | 是 | 39092 运行上下文提供，不从文件猜测 |
| task_id | string | 是 | 根 Tracking TaskID，跨 M0–M5 传播 |
| source_filename | string | 是 | 原始文件名 |
| source_sha256 | string | 是 | 原始字节 SHA-256 |
| source_system | enum | 是 | erp/mes/wms/plm/manual/微信导出等 |
| observed_at | datetime | 是 | 事实在来源系统的观察时间 |
| schema_version | string | 是 | 如 `m0.bom.v1`、`m1.document.v2` |
| revision | string/integer | 条件必填 | 业务版本，不等同于导入次数 |
| effective_from/to | date/datetime | 条件必填 | 版本生效区间 |
| evidence_ref | object | 是 | 页码、Sheet、行列、单元格或 CAD 图号 |
| approval_status | enum | 是 | candidate/approved/rejected/superseded |
| idempotency_key | string | 是 | 同一来源重传不得重复生成事实 |

当前 M0 PostgreSQL 以 `source_documents.content_json` 和 `canonical_entity_versions.payload_json` 保存业务载荷，并以 `canonical_ledger`、`canonical_outbox` 记录发布和下游事件。

## 2. 规范实体与关系

### 2.1 稳定身份

| 实体 | 稳定键 | 主要版本事实 |
|---|---|---|
| product | product_code | 名称、规格、状态、单位 |
| material | material_code | 名称、规格、单位、替代料 |
| bom | product_code + bom_revision | BOM 行、用量、损耗、生效期 |
| route | route_code + revision | 工序序列、工位、资源、工时 |
| operation | operation_code | 名称、标准工时、质量要求 |
| drawing | drawing_no + revision | 文件、尺寸、公差、材料、变更 |
| inventory_lot | material_code + warehouse + lot_no + snapshot | 数量、质量状态、可用时间 |
| equipment | equipment_code | 能力、状态、日历 |
| tooling | tooling_code | 适用工序、寿命、状态 |
| person | person_code | 技能、资格、薪资规则（敏感） |
| piece_rate | product_code + operation_code + revision | 计件单价和规则 |

### 2.2 关键关系

```text
product ──has_version──> bom ──contains──> material
product ──uses_route──> route ──has_step──> operation
operation ──runs_on──> station/equipment
operation ──requires──> tooling
material ──stocked_as──> inventory_lot
operation ──performed_by──> person/skill
product + operation ──priced_by──> piece_rate
drawing ──describes──> product/material/operation
```

## 3. BOM：`m0.bom.v1` → M2/M3/M5

### 3.1 规范 JSON 样式

```json
{
  "schema_version": "m0.bom.v1",
  "document_type": "bom",
  "document_subtype": "engineering_bom",
  "product": {
    "product_code": "P-USB-C-001",
    "product_name": "USB-C线材",
    "specification": "100W 2m",
    "uom": "PCS"
  },
  "bom": {
    "bom_code": "BOM-P-USB-C-001",
    "revision": "A",
    "effective_from": "2026-09-01",
    "status": "approved",
    "lines": [
      {
        "line_no": 10,
        "material_code": "MAT-CABLE-002",
        "material_name": "镀锡铜线",
        "specification": "22AWG",
        "qty_per": 2.05,
        "uom": "M",
        "scrap_rate": 0.025,
        "requires_procurement": true,
        "substitute_material_codes": []
      }
    ]
  }
}
```

### 3.2 提取和校验规则

- 必须提取产品编码、BOM 版本、物料编码、单位、单台用量；没有这些值不能标记 ready。
- `qty_per` 必须为正数；`scrap_rate` 必须在 0–1；同一产品版本的 `line_no` 不重复。
- 子 BOM 必须形成有向关系，不能把组件名称当作物料编码。
- 产品编码、物料编码、BOM 版本冲突时进入人工 Gate。
- 当前代码：`business_catalog.py` 可从表格生成 `m0.bom.v1` 候选；`m2_fact_validation.py` 校验产品、BOM 行、版本和生效区间。

## 4. SOP/IE：`m0.route.v1` / `m0.sop.v1` → M2/M5

### 4.1 规范 JSON 样式

```json
{
  "schema_version": "m0.route.v1",
  "product_code": "P-USB-C-001",
  "route_code": "RT-USB-C-001",
  "revision": "A",
  "effective_from": "2026-09-01",
  "operations": [
    {
      "sequence": 30,
      "operation_code": "OP-CRIMP-030",
      "operation_name": "端子压接",
      "standard_minutes": 0.85,
      "time_basis": "per_piece",
      "worker_count": 1,
      "station_code": "ST-03",
      "equipment_codes": ["EQ-CRIMP-02"],
      "tooling_codes": ["FIX-CRIMP-01"],
      "quality_requirements": ["拉力>=80N"],
      "sop_document_ref": "SOP-USB-C-A.pdf#page=3"
    }
  ]
}
```

### 4.2 必须区分

- IE 标准工时（分钟/件）；
- 换型、首件、批次准备等非单件时间；
- 投入人数、产能口径和设备节拍；
- 工序顺序与前置工序；
- SOP 文本中的质量要求、检验点和异常处理。

没有 `operation_code`、`standard_minutes`、`station_code` 或必要的设备/模治具编码，不能直接进入生产排程。当前 `m2_fact_validation.py` 会将缺失项标记为 `incomplete`；M5 的 `routing_steps` 要求工序、顺序和可执行资源。

## 5. 工程图：`m0.drawing.v1` → M0/M2

### 5.1 规范 JSON 样式

```json
{
  "schema_version": "m0.drawing.v1",
  "drawing_no": "DWG-USB-C-001",
  "revision": "B",
  "drawing_type": "part",
  "subject_code": "MAT-SHELL-001",
  "product_code": "P-USB-C-001",
  "unit": "mm",
  "material": "铝合金6061",
  "tolerances": {"general": "ISO2768-m"},
  "critical_characteristics": [
    {"name": "孔径", "nominal": 3.2, "lower": -0.05, "upper": 0.05, "unit": "mm"}
  ],
  "change_notice": "ECN-20260820",
  "source_file": "DWG-USB-C-001-B.pdf"
}
```

### 5.2 能力边界

- Agent 可以可靠保存文件、图号、版本、文件类型、页码和文字表格中的尺寸；
- CAD/DWG/STEP 的几何语义、隐含公差、图层关系不能仅靠通用文档解析器确认；
- 尺寸、公差、材料和变更必须保留证据锚点；涉及制造放行必须人工确认；
- 工程图不能自动替代 BOM 或 SOP，三者关系需要按编码和版本匹配。

## 6. 库存：`m0.inventory.v1` / M3-M5 snapshot

### 6.1 规范 JSON 样式

```json
{
  "schema_version": "m0.inventory.v1",
  "snapshot_id": "INV-20260905-0800",
  "observed_at": "2026-09-05T08:00:00+08:00",
  "warehouse_code": "WH-01",
  "rows": [
    {
      "material_code": "MAT-CABLE-002",
      "warehouse_code": "WH-01",
      "location_code": "A-03-02",
      "lot_no": "LOT-20260830-01",
      "on_hand_qty": 1250,
      "available_qty": 1180,
      "locked_qty": 70,
      "uom": "M",
      "qc_status": "passed",
      "received_at": "2026-08-30",
      "available_at": "2026-08-30"
    }
  ]
}
```

### 6.2 规则

- `available_qty + locked_qty` 不得大于 `on_hand_qty`；
- 同一快照中物料、仓库、批次、库位组合唯一；
- 质量冻结、待检和不合格库存不能直接作为可用库存；
- 仅有“库存数量”而没有快照时间、单位、批次或质量状态，只能进入候选，不能用于 M3/M5 计算；
- 当前 `m3_m4_fact_validation.py` 校验物料覆盖、仓库、批次、可用量和质量状态。

## 7. 配套主数据

### 7.1 设备与机器可用

```json
{
  "equipment_code": "EQ-CRIMP-02",
  "name": "2号压接机",
  "status": "available",
  "work_center": "WC-CRIMP",
  "capability_tags": ["crimp", "22awg"],
  "calendar_id": "CAL-FACTORY-A",
  "available_windows": [
    {"start": "2026-09-05T08:00:00+08:00", "end": "2026-09-05T17:00:00+08:00"}
  ],
  "source_system": "mes",
  "observed_at": "2026-09-05T07:30:00+08:00"
}
```

机器编码是排程可用事实的必要键；“2号机可用”不能代替 `equipment_code`。

### 7.2 模治具

`tooling_code、name、type、compatible_operation_codes、compatible_product_codes、status、location、life_limit、used_count、maintenance_due、calibration_due、replacement_tooling_code`。

### 7.3 人员工资

`person_code、岗位、班组、skill_codes、qualification_valid_to、pay_basis、base_rate、overtime_rule、effective_from/to`。

工资、身份证、银行卡属于敏感资料，进入系统时必须单独权限控制；工资值不能用于推断人员技能。

### 7.4 产品计件工资

`product_code、operation_code、revision、effective_from、piece_uom、piece_rate、allocation_rule、good_rate_rule、scrap_rule、overtime_factor、approved_by`。

## 8. Agent/Tool 能力矩阵

| 资料 | M1 可提取 | M0 可形成候选 | 人工前可校验 | 进入 M2/M3/M5 的前置条件 |
|---|---|---|---|---|
| BOM XLSX/CSV | 产品、物料、用量、单位、版本 | 是 | 编码、单位、正数、版本 | BOM 版本 approved |
| SOP XLSX/PDF/DOCX | 工序、顺序、文本、部分工时 | 是 | 工序编码、IE 分钟、工位 | 每道关键工序有工时和资源 |
| 工程图 PDF | 图号、版本、文字尺寸、证据位置 | 是 | 公差、材料、变更 | 工程确认，不能仅凭图像自动放行 |
| DWG/DXF/STEP | 文件和元数据 | 是 | 几何语义 | 需 CAD/工程复核 |
| 库存 XLSX/CSV | 物料、仓库、批次、数量、质量状态 | 是 | 数量关系、快照时间 | 形成可信 inventory snapshot |
| 设备表 | 编码、能力、状态、窗口 | 是 | 日历和状态 | `equipment_code` 与 calendar 完整 |
| 模治具表 | 编码、适用工序、状态 | 是 | 寿命/校验有效期 | 工序引用能匹配 |
| 人员工资表 | 结构化字段可提取 | 是 | 敏感字段授权 | 工资不直接证明排程能力 |
| 产品计件工资 | 产品/工序/单价/版本 | 是 | 单价、生效区间 | 审批后用于计件计算 |

## 9. 当前真实限制与 Gate

1. M0 PostgreSQL 当前是通用 canonical envelope；完整 BOM、SOP、工程图和薪资的强类型业务表尚未全部冻结。
2. 文件上传成功不等于事实可用：M1 解析结果先进入候选，必须有来源证据、版本、稳定编码和审批。
3. 人工批准只能覆盖业务审核状态，不能凭空补出缺失的编码、工时、设备、库存或日历。
4. M2 缺 BOM/SOP/IE 时为 `incomplete`；M3 缺物料覆盖、库存/供应事实时为 `incomplete`；M5 缺资源、日历、WIP 或生产单元映射时为 `data_incomplete`。
5. 任何模型推断必须标记 `inferred=true`，不能覆盖原始观察值；生产事实必须能回到文件页码、Sheet、行列或接口记录。

## 10. 版本冻结建议

在正式批量导入前，需要冻结：

- `m0.bom.v1`、`m0.route.v1`、`m0.drawing.v1`、`m0.inventory.v1` 的 JSON Schema；
- 设备、模治具、人员、计件工资的字段字典和敏感级别；
- Excel 模板列名与别名；
- 每类资料的最小必填集合和人工 Gate；
- M0 canonical payload 到 M2/M3/M4/M5 snapshot 的映射；
- 一份真实工厂样本的端到端回放验收记录。
