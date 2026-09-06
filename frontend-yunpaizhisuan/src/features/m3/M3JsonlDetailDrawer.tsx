import { Alert, Descriptions, Drawer, Space, Table, Tabs, Tag, Typography } from 'antd';
import type { M3JsonlResult } from './jsonl';

type M3JsonlDetailDrawerProps = {
  result: M3JsonlResult | null;
  onClose: () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const records = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (!isRecord(value)) {
    return [];
  }
  if (Array.isArray(value.items)) {
    return value.items.filter(isRecord);
  }
  const values = Object.values(value);
  return values.every(isRecord) ? values : [];
};

const componentRecords = (value: unknown) => {
  if (!isRecord(value) || Array.isArray(value.items)) {
    return records(value);
  }
  return Object.entries(value).flatMap(([parentMaterialCode, children]) =>
    Array.isArray(children)
      ? children
          .filter(isRecord)
          .map((child) => ({ parent_material_code: parentMaterialCode, ...child }))
      : [],
  );
};

const text = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return String(value);
};

const tableTitle = (title: string, count: number) => (
  <Typography.Title level={5}>
    {title}（{count}）
  </Typography.Title>
);

export function M3JsonlDetailDrawer({ result, onClose }: M3JsonlDetailDrawerProps) {
  const payload = result?.payload ?? {};
  const directOrder = isRecord(payload.order) ? payload.order : null;
  const m2Package = isRecord(payload.m2_package) ? payload.m2_package : null;
  const bomHeaderValue = m2Package?.bom_header;
  const m2BomHeader = isRecord(bomHeaderValue)
    ? bomHeaderValue
    : Array.isArray(bomHeaderValue) && isRecord(bomHeaderValue[0])
      ? bomHeaderValue[0]
      : null;
  const order = directOrder ?? m2BomHeader ?? {};
  const bom = isRecord(payload.bom) ? payload.bom : {};
  const bomLines = records(bom.lines ?? m2Package?.bom_lines);
  const componentBom = componentRecords(payload.component_bom);
  const inventory = records(payload.inventory_snapshot);
  const openPurchaseOrders = records(payload.open_purchase_orders);
  const historicalUsage = records(payload.historical_usage);
  const plan = result && isRecord(result.envelope.data) ? result.envelope.data : {};
  const procurementLines = records(plan.lines);
  const warnings = Array.isArray(plan.warnings)
    ? plan.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];

  return (
    <Drawer
      title={`M3 计算详情 · ${result?.orderId || `第 ${result?.lineNumber ?? '-'} 行`}`}
      open={result !== null}
      onClose={onClose}
      width="min(1180px, calc(100vw - 16px))"
    >
      {result && !result.envelope.success ? (
        <Alert
          type="error"
          showIcon
          message="该行执行失败"
          description={result.envelope.errors[0]?.message ?? 'M3 请求失败'}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Tabs
        items={[
          {
            key: 'order-bom',
            label: '订单与 BOM',
            children: (
              <Space direction="vertical" size={20} className="page-stack">
                <Typography.Title level={5}>订单信息</Typography.Title>
                <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
                  <Descriptions.Item label="订单号">{text(order.order_id)}</Descriptions.Item>
                  <Descriptions.Item label="项目编号">{text(order.project_id)}</Descriptions.Item>
                  <Descriptions.Item label="客户">{text(order.customer_name)}</Descriptions.Item>
                  <Descriptions.Item label="产品">{text(order.product_name ?? bom.product_name)}</Descriptions.Item>
                  <Descriptions.Item label="订单数量">{text(order.order_qty)}</Descriptions.Item>
                  <Descriptions.Item label="需求日期">{text(order.due_date)}</Descriptions.Item>
                  <Descriptions.Item label="BOM 编号">{text(order.bom_id ?? bom.bom_id)}</Descriptions.Item>
                  <Descriptions.Item label="采购计划">{text(order.procurement_plan_id)}</Descriptions.Item>
                </Descriptions>

                {tableTitle('主 BOM', bomLines.length)}
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row) => text(row.line_id ?? `${row.material_code}-${row.source_row}`)}
                  dataSource={bomLines}
                  scroll={{ x: 1000 }}
                  columns={[
                    { title: '行号', dataIndex: 'line_id', width: 120, render: text },
                    { title: '物料编码', dataIndex: 'material_code', width: 140, render: text },
                    { title: '物料名称', dataIndex: 'material_name', width: 200, render: text },
                    { title: '原始用量', dataIndex: 'qty_raw', width: 100, render: text },
                    { title: '单件用量', dataIndex: 'qty_per', width: 100, render: text },
                    { title: '单位', dataIndex: 'uom', width: 80, render: text },
                    { title: '损耗率', dataIndex: 'loss_rate', width: 90, render: text },
                    {
                      title: '需采购',
                      dataIndex: 'requires_procurement',
                      width: 90,
                      render: (value) => (
                        <Tag color={value === false ? 'default' : 'blue'}>{value === false ? '否' : '是'}</Tag>
                      ),
                    },
                  ]}
                />

                {tableTitle('子 BOM', componentBom.length)}
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row) => `${text(row.parent_material_code)}-${text(row.child_material_code)}`}
                  dataSource={componentBom}
                  scroll={{ x: 820 }}
                  columns={[
                    { title: '父物料', dataIndex: 'parent_material_code', width: 150, render: text },
                    { title: '子物料', dataIndex: 'child_material_code', width: 150, render: text },
                    { title: '子物料名称', dataIndex: 'child_material_name', width: 220, render: text },
                    { title: '父项用量', dataIndex: 'qty_per_parent', width: 110, render: text },
                    { title: '单位', dataIndex: 'uom', width: 80, render: text },
                    { title: '损耗率', dataIndex: 'loss_rate', width: 90, render: text },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'inventory-po',
            label: '库存与在途',
            children: (
              <Space direction="vertical" size={20} className="page-stack">
                {tableTitle('库存快照', inventory.length)}
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row) => `${text(row.material_code)}-${text(row.lot_no)}`}
                  dataSource={inventory}
                  scroll={{ x: 1050 }}
                  columns={[
                    { title: '物料编码', dataIndex: 'material_code', width: 140, render: text },
                    { title: '物料名称', dataIndex: 'material_name', width: 190, render: text },
                    { title: '仓库', dataIndex: 'warehouse', width: 100, render: text },
                    { title: '批次', dataIndex: 'lot_no', width: 180, render: text },
                    { title: '账面库存', dataIndex: 'available_qty', width: 100, render: text },
                    { title: '锁定库存', dataIndex: 'locked_qty', width: 100, render: text },
                    { title: '安全库存', dataIndex: 'base_stock_reserved', width: 100, render: text },
                    { title: '质检状态', dataIndex: 'qc_status', width: 100, render: text },
                    { title: '入库日期', dataIndex: 'received_at', width: 120, render: text },
                  ]}
                />

                {tableTitle('在途采购', openPurchaseOrders.length)}
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row) => `${text(row.material_code)}-${text(row.promise_date)}-${text(row.supplier_id)}`}
                  dataSource={openPurchaseOrders}
                  scroll={{ x: 680 }}
                  columns={[
                    { title: '物料编码', dataIndex: 'material_code', width: 160, render: text },
                    { title: '在途数量', dataIndex: 'open_po_qty', width: 120, render: text },
                    { title: '承诺日期', dataIndex: 'promise_date', width: 140, render: text },
                    { title: '供应商', dataIndex: 'supplier_id', width: 180, render: text },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'usage',
            label: '历史用量',
            children: (
              <Space direction="vertical" size={20} className="page-stack">
                {tableTitle('历史用量与安全库存参数', historicalUsage.length)}
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row) => text(row.material_code)}
                  dataSource={historicalUsage}
                  scroll={{ x: 820 }}
                  columns={[
                    { title: '物料编码', dataIndex: 'material_code', width: 160, render: text },
                    { title: '统计天数', dataIndex: 'days', width: 100, render: text },
                    { title: '历史总用量', dataIndex: 'total_usage_qty', width: 130, render: text },
                    { title: '安全库存比例', dataIndex: 'safety_stock_ratio', width: 130, render: text },
                    { title: '用量标准差', dataIndex: 'usage_std', width: 120, render: text },
                    { title: '历史提前期', dataIndex: 'lead_time_days', width: 120, render: text },
                    { title: '安全系数', dataIndex: 'safety_factor', width: 100, render: text },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: 'procurement',
            label: '采购计算结果',
            children: (
              <Space direction="vertical" size={20} className="page-stack">
                <Typography.Title level={5}>采购计划</Typography.Title>
                <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
                  <Descriptions.Item label="采购计划">{text(plan.procurement_plan_id)}</Descriptions.Item>
                  <Descriptions.Item label="订单号">{text(plan.order_id)}</Descriptions.Item>
                  <Descriptions.Item label="状态">{text(plan.status)}</Descriptions.Item>
                  <Descriptions.Item label="齐套状态">{text(plan.availability_status)}</Descriptions.Item>
                  <Descriptions.Item label="需求日期">{text(plan.due_date)}</Descriptions.Item>
                  <Descriptions.Item label="计划版本">{text(plan.plan_version)}</Descriptions.Item>
                  <Descriptions.Item label="采购物料">{procurementLines.length}</Descriptions.Item>
                  <Descriptions.Item label="Trace ID">{text(result?.envelope.trace_id)}</Descriptions.Item>
                </Descriptions>

                {warnings.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    message={`计算警告（${warnings.length}）`}
                    description={warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  />
                ) : null}

                {tableTitle('采购需求明细', procurementLines.length)}
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(row) => text(row.line_id ?? row.material_code)}
                  dataSource={procurementLines}
                  scroll={{ x: 1550 }}
                  columns={[
                    { title: '物料编码', dataIndex: 'material_code', width: 140, fixed: 'left', render: text },
                    { title: '物料名称', dataIndex: 'material_name', width: 200, render: text },
                    { title: '单位', dataIndex: 'uom', width: 80, render: text },
                    { title: '单件用量', dataIndex: 'qty_per', width: 100, render: text },
                    { title: '损耗率', dataIndex: 'loss_rate', width: 90, render: text },
                    { title: '毛需求', dataIndex: 'gross_required_qty', width: 110, render: text },
                    { title: '可用库存', dataIndex: 'available_qty', width: 110, render: text },
                    { title: '锁定库存', dataIndex: 'locked_qty', width: 110, render: text },
                    { title: '安全库存', dataIndex: 'base_stock_reserved', width: 110, render: text },
                    { title: '在途数量', dataIndex: 'open_po_qty', width: 110, render: text },
                    { title: '净需求', dataIndex: 'net_required_qty', width: 110, render: text },
                    { title: '短缺数量', dataIndex: 'shortage_qty', width: 110, render: text },
                    {
                      title: '建议采购',
                      dataIndex: 'suggest_purchase_qty',
                      width: 120,
                      fixed: 'right',
                      render: text,
                    },
                    {
                      title: '状态',
                      dataIndex: 'readiness',
                      width: 100,
                      fixed: 'right',
                      render: (value) => (
                        <Tag color={value === 'ready' ? 'green' : value === 'shortage' ? 'red' : 'gold'}>
                          {text(value)}
                        </Tag>
                      ),
                    },
                  ]}
                />
              </Space>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
