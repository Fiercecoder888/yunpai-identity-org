import type { MasterTableConfig } from './MasterTableCrud';

/**
 * m0 主数据表 → 列配置（字段名/中文标题/类型/是否必填/是否可编辑）。
 * 与 m0/domain/models.py 的 12 张 MASTER_TABLE_* 表对应；列名必须与后端表结构一致。
 * 未在此列出的表（或列结构变化）由 MasterTableCrud 用「动态列（读第一行 keys）」兜底。
 */
export const MASTER_TABLE_CONFIGS: MasterTableConfig[] = [
  {
    table: 'm0_master_machine',
    label: '机器',
    columns: [
      { key: 'machine_code', title: '设备编码', required: true },
      { key: 'machine_name', title: '设备名称' },
      { key: 'machine_type', title: '设备类型' },
      { key: 'line', title: '车间/线体' },
      { key: 'status', title: '状态' },
      { key: 'params_json', title: '参数(JSON)', type: 'textarea' },
      { key: 'code_source', title: '编码来源' },
    ],
  },
  {
    table: 'm0_master_warehouse',
    label: '仓库',
    columns: [
      { key: 'warehouse_code', title: '仓库编码', required: true },
      { key: 'warehouse_name', title: '仓库名称' },
      { key: 'location', title: '库位' },
      { key: 'status', title: '状态' },
      { key: 'code_source', title: '编码来源' },
    ],
  },
  {
    table: 'm0_master_asset',
    label: '资产',
    columns: [
      { key: 'asset_code', title: '资产编码' },
      { key: 'asset_type', title: '资产类型' },
      { key: 'asset_name', title: '资产名称' },
      { key: 'spec', title: '规格' },
      { key: 'tags_json', title: '标签(JSON)', type: 'textarea' },
      { key: 'status', title: '状态' },
      { key: 'code_source', title: '编码来源' },
    ],
  },
  {
    table: 'm0_master_yield',
    label: '良率/损耗',
    columns: [
      { key: 'material_code', title: '物料编码', required: true },
      { key: 'material_name', title: '物料名称' },
      { key: 'process_id', title: '工序' },
      { key: 'station', title: '工位' },
      { key: 'yield_rate', title: '良率', type: 'number' },
      { key: 'loss_rate', title: '损耗率', type: 'number' },
      { key: 'effective_from', title: '生效日期' },
      { key: 'source', title: '来源' },
    ],
  },
  {
    table: 'm0_master_piece_rate',
    label: '计件单价',
    columns: [
      { key: 'order_id', title: '订单号', required: true },
      { key: 'product_id', title: '产品编码' },
      { key: 'product_name', title: '产品名称' },
      { key: 'operation_id', title: '工位/工序', required: true },
      { key: 'station', title: '工位名' },
      { key: 'unit_price', title: '计件单价(元)', type: 'number', required: true },
      { key: 'uom', title: '单位(件/米/其他)', required: true },
      { key: 'effective_from', title: '生效日期' },
      { key: 'source', title: '来源' },
    ],
  },
  {
    table: 'm0_master_inventory',
    label: '库存',
    columns: [
      { key: 'material_code', title: '物料编码', required: true },
      { key: 'material_name', title: '物料名称' },
      { key: 'warehouse', title: '仓库' },
      { key: 'warehouse_code', title: '仓库编码' },
      { key: 'qty', title: '数量', type: 'number' },
      { key: 'uom', title: '单位' },
      { key: 'spec', title: '规格' },
      { key: 'status', title: '状态' },
    ],
  },
  {
    table: 'm0_master_order',
    label: '订单',
    columns: [
      { key: 'order_no', title: '订单号', required: true },
      { key: 'product_name', title: '产品名称' },
      { key: 'model', title: '型号' },
      { key: 'qty', title: '数量', type: 'number' },
      { key: 'uom', title: '单位' },
      { key: 'due_date', title: '交期' },
      { key: 'customer', title: '客户' },
      { key: 'status', title: '状态' },
    ],
  },
  {
    table: 'm0_master_bom_header',
    label: 'BOM头',
    columns: [
      { key: 'bom_id', title: 'BOM编号', required: true },
      { key: 'product_name', title: '产品名称' },
      { key: 'model', title: '型号' },
      { key: 'version', title: '版本' },
      { key: 'status', title: '状态' },
    ],
  },
  {
    table: 'm0_master_bom_line',
    label: 'BOM行',
    columns: [
      { key: 'bom_header_id', title: 'BOM头ID', type: 'number' },
      { key: 'material_code', title: '物料编码', required: true },
      { key: 'material_name', title: '物料名称' },
      { key: 'qty_per', title: '单件用量', type: 'number' },
      { key: 'uom', title: '单位' },
      { key: 'loss_rate', title: '损耗率', type: 'number' },
      { key: 'status', title: '状态' },
    ],
  },
  {
    table: 'm0_master_purchase',
    label: '采购',
    columns: [
      { key: 'kind', title: '类型' },
      { key: 'doc_no', title: '单据号' },
      { key: 'supplier', title: '供应商' },
      { key: 'material_code', title: '物料编码' },
      { key: 'material_name', title: '物料名称' },
      { key: 'qty', title: '数量', type: 'number' },
      { key: 'uom', title: '单位' },
      { key: 'due_date', title: '交期' },
      { key: 'status', title: '状态' },
    ],
  },
  {
    table: 'm0_master_document',
    label: '文档',
    columns: [
      { key: 'domain', title: '内容域' },
      { key: 'doc_no', title: '文档号' },
      { key: 'title', title: '标题' },
      { key: 'doc_type', title: '文档类型' },
      { key: 'status', title: '状态' },
    ],
  },
  {
    table: 'm0_station_equipment',
    label: '工位设备',
    columns: [
      { key: 'station_id', title: '工位' },
      { key: 'equipment_code', title: '设备编码' },
      { key: 'routing_step', title: '工序步骤' },
      { key: 'effective_from', title: '生效日期' },
      { key: 'note', title: '备注' },
    ],
  },
  {
    table: 'm0_asset_tags',
    label: '资产标签',
    columns: [
      { key: 'asset_id', title: '资产ID', type: 'number' },
      { key: 'tag', title: '标签', required: true },
      { key: 'dimension', title: '维度' },
    ],
  },
];

export const masterTableConfigFor = (table: string): MasterTableConfig | undefined =>
  MASTER_TABLE_CONFIGS.find((config) => config.table === table);
