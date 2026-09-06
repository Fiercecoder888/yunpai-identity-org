import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Typography,
} from 'antd';

import { StructuredSection } from '../components/StructuredJson';

import {
  getBusinessCostVariance,
  getBusinessFlowTrace,
  getBusinessMaterialTrace,
  getBusinessOrderTrace,
  publishBusinessFact,
  publishExecutionOutput,
  type JsonRecord,
} from '../services/businessTraceApi';
import { getBusinessTaskTrace } from '../services/businessFlowRunApi';
import { EngineeringDocumentsCard } from '../features/m0/EngineeringDocumentsCard';


const { Title, Paragraph } = Typography;


function OrderTraceTab() {
  const [orderId, setOrderId] = useState('SO-VERIFY-RECALC-FINAL4');
  const [queryMode, setQueryMode] = useState<'order' | 'run' | 'task'>('order');
  const [trace, setTrace] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const value = orderId.trim();
      if (!value) {
        setError('请输入查询标识');
        return;
      }
      const result =
        queryMode === 'run'
          ? await getBusinessFlowTrace(value)
          : queryMode === 'task'
            ? await getBusinessTaskTrace(value)
            : await getBusinessOrderTrace(value);
      setTrace(result);
    } catch (err) {
      setError(String(err));
      setTrace(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        <Segmented
          aria-label="查询方式"
          value={queryMode}
          onChange={(value) => setQueryMode(value as 'order' | 'run' | 'task')}
          options={[
            { label: '订单号', value: 'order' },
            { label: 'Run ID', value: 'run' },
            { label: 'TaskID', value: 'task' },
          ]}
        />
      </Space>
      <Space.Compact style={{ width: 520 }}>
        <Input
          placeholder={
            queryMode === 'run'
              ? 'Run ID（如 flow_xxxxxxxx）'
              : queryMode === 'task'
                ? 'TaskID（如 task_xxxxxxxx）'
                : '订单号（如 SO-VERIFY-RECALC-FINAL4）'
          }
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
          onPressEnter={run}
        />
        <Button type="primary" loading={loading} onClick={run}>查询全链路</Button>
      </Space.Compact>
      {error && <Alert type="error" message={error} />}
      {trace && <StructuredSection title="订单全链路追溯（订单/物料/库存/采购/排程/事实账本）" data={trace} />}
    </Space>
  );
}


function MaterialTraceTab() {
  const [searchParams] = useSearchParams();
  const [materialId, setMaterialId] = useState(
    searchParams.get('material') ?? 'MAT-1',
  );
  const [trace, setTrace] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (value?: string) => {
    setLoading(true);
    setError(null);
    try {
      setTrace(await getBusinessMaterialTrace((value ?? materialId).trim()));
    } catch (err) {
      setError(String(err));
      setTrace(null);
    } finally {
      setLoading(false);
    }
  };

  const lots = useMemo(() => (Array.isArray(trace?.lots) ? trace.lots as JsonRecord[] : []), [trace]);
  const yieldSummary = useMemo(
    () => (Array.isArray(trace?.yield_summary) ? trace.yield_summary as JsonRecord[] : []),
    [trace],
  );
  const consumption = useMemo(
    () =>
      Array.isArray((trace?.facts as JsonRecord | undefined)?.consumption)
        ? ((trace?.facts as JsonRecord | undefined)?.consumption as JsonRecord[])
        : [],
    [trace],
  );
  const production = useMemo(
    () =>
      Array.isArray((trace?.facts as JsonRecord | undefined)?.production_output)
        ? ((trace?.facts as JsonRecord | undefined)?.production_output as JsonRecord[])
        : [],
    [trace],
  );
  const material = trace?.material as JsonRecord | undefined;

  const identityColumns = [
    { title: '字段', dataIndex: 'field' },
    { title: '值', dataIndex: 'value' },
  ];
  const consumptionColumns = [
    { title: '订单', dataIndex: 'order_id' },
    { title: '动作', dataIndex: 'movement_type' },
    { title: '数量', dataIndex: 'quantity' },
    { title: '批次', dataIndex: 'lot_id' },
  ];
  const productionColumns = [
    { title: '订单', dataIndex: 'order_id' },
    { title: '工序', dataIndex: 'operation_id' },
    { title: '产出', dataIndex: 'quantity' },
    { title: '报废', dataIndex: 'defect_quantity' },
    { title: '批次', dataIndex: 'lot_id' },
  ];
  const identityRows = material
    ? [
        ['material_id', material.material_id],
        ['material_code', material.material_code],
        ['name', material.name],
        ['unit', material.unit],
        ['m1_entity_id', material.m1_entity_id],
        ['m3_material_id', material.m3_material_id],
        ['m5_material_id', material.m5_material_id],
        ['lifecycle_status', material.lifecycle_status],
      ].map(([field, value]) => ({ key: String(field), field, value: String(value ?? '-') }))
    : [];

  useEffect(() => {
    if (searchParams.get('material')) {
      void run(searchParams.get('material') ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only auto load from URL
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space.Compact style={{ width: 480 }}>
        <Input
          placeholder="物料编码（如 MAT-1）"
          value={materialId}
          onChange={(event) => setMaterialId(event.target.value)}
          onPressEnter={() => void run()}
        />
        <Button type="primary" loading={loading} onClick={() => void run()}>查询批次追溯</Button>
      </Space.Compact>
      {error && <Alert type="error" message={error} />}
      {trace && (
        <>
          {identityRows.length > 0 && (
            <Card size="small" title="物料精准匹配（跨模块身份映射）" style={{ marginBottom: 12 }}>
              <Table
                rowKey="key"
                size="small"
                columns={identityColumns}
                dataSource={identityRows}
                pagination={false}
              />
            </Card>
          )}
          <Card size="small" title="物料消费（领料/报废/退料）" style={{ marginBottom: 12 }}>
            <Table rowKey={(row, index) => `${row.order_id}-${index}`} size="small" columns={consumptionColumns} dataSource={consumption} pagination={false} />
          </Card>
          <Card size="small" title="物料生产（完工产出/报废/批次）" style={{ marginBottom: 12 }}>
            <Table rowKey={(row, index) => `${row.order_id}-${index}`} size="small" columns={productionColumns} dataSource={production} pagination={false} />
          </Card>
          <StructuredSection title="批次（批次/角色/订单/净量）" data={lots} />
          <StructuredSection title="批次链（领料批次→订单→成品批次）" data={trace.lot_chain} />
          <StructuredSection title="工序良率汇总" data={yieldSummary} />
          <StructuredSection
            title="流水与事实"
            data={{ movements: trace.movements, facts: trace.facts, balances: trace.balances }}
          />
        </>
      )}
    </Space>
  );
}


function ReceiptInspectionTab() {
  const [result, setResult] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await publishBusinessFact(values as JsonRecord);
      setResult(response);
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setSubmitting(false);
    }
  };

  const onReceipt = async (values: Record<string, unknown>) => {
    await submit({
      fact_type: 'receipt',
      aggregate_type: 'material',
      aggregate_id: values.material_id,
      source_module: 'm4',
      source_event_id: `ui-receipt-${Date.now()}`,
      auto_recalculate: false,
      payload: {
        material_id: values.material_id,
        order_id: values.order_id,
        purchase_order_id: values.purchase_order_id,
        location_id: values.location_id,
        quantity: String(values.quantity),
        lot_id: values.lot_id,
      },
    });
  };

  const onInspection = async (values: Record<string, unknown>) => {
    await submit({
      fact_type: 'inspection',
      aggregate_type: 'material',
      aggregate_id: values.material_id,
      source_module: 'm4',
      source_event_id: `ui-inspection-${Date.now()}`,
      auto_recalculate: false,
      payload: {
        material_id: values.material_id,
        order_id: values.order_id,
        location_id: values.location_id,
        inspection_id: values.inspection_id,
        quantity: String(values.quantity),
        result: values.result,
        source: values.source,
        lot_id: values.lot_id,
      },
    });
  };

  const onConsumption = async (values: Record<string, unknown>) => {
    await submit({
      fact_type: 'consumption',
      aggregate_type: 'material',
      aggregate_id: values.material_id,
      source_module: 'mes',
      source_event_id: `ui-consumption-${Date.now()}`,
      auto_recalculate: false,
      payload: {
        material_id: values.material_id,
        order_id: values.order_id,
        location_id: values.location_id,
        movement_type: values.movement_type,
        quantity: String(values.quantity),
        lot_id: values.lot_id,
      },
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="领料 / 消耗（issue→库存扣减并支撑产出）">
        <Form layout="inline" onFinish={onConsumption}>
          <Form.Item name="material_id" label="物料" rules={[{ required: true }]}><Input placeholder="MAT-1" /></Form.Item>
          <Form.Item name="order_id" label="订单" rules={[{ required: true }]}><Input placeholder="SO-1" /></Form.Item>
          <Form.Item name="location_id" label="库位" initialValue="WH-1"><Input /></Form.Item>
          <Form.Item name="movement_type" label="动作" initialValue="issue"><Select options={[{ value: 'issue', label: '领料' }, { value: 'scrap', label: '报废' }, { value: 'return', label: '退料' }]} /></Form.Item>
          <Form.Item name="lot_id" label="批次"><Input placeholder="LOT-001" /></Form.Item>
          <Form.Item name="quantity" label="数量" rules={[{ required: true }]}><InputNumber min={0.01} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={submitting}>提交领料</Button></Form.Item>
        </Form>
      </Card>
      <Card size="small" title="采购收货（收货→待检）">
        <Form layout="inline" onFinish={onReceipt}>
          <Form.Item name="material_id" label="物料" rules={[{ required: true }]}><Input placeholder="MAT-1" /></Form.Item>
          <Form.Item name="order_id" label="订单" rules={[{ required: true }]}><Input placeholder="SO-1" /></Form.Item>
          <Form.Item name="purchase_order_id" label="采购单" rules={[{ required: true }]}><Input placeholder="PO-1" /></Form.Item>
          <Form.Item name="location_id" label="库位" initialValue="WH-1"><Input /></Form.Item>
          <Form.Item name="lot_id" label="批次"><Input placeholder="LOT-001" /></Form.Item>
          <Form.Item name="quantity" label="数量" rules={[{ required: true }]}><InputNumber min={0.01} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={submitting}>收货入待检</Button></Form.Item>
        </Form>
      </Card>
      <Card size="small" title="质检（pass→可用 / fail→冻结）">
        <Form layout="inline" onFinish={onInspection}>
          <Form.Item name="material_id" label="物料" rules={[{ required: true }]}><Input placeholder="MAT-1" /></Form.Item>
          <Form.Item name="order_id" label="订单" rules={[{ required: true }]}><Input placeholder="SO-1" /></Form.Item>
          <Form.Item name="location_id" label="库位" initialValue="WH-1"><Input /></Form.Item>
          <Form.Item name="inspection_id" label="检验单" rules={[{ required: true }]}><Input placeholder="QC-001" /></Form.Item>
          <Form.Item name="lot_id" label="批次"><Input /></Form.Item>
          <Form.Item name="quantity" label="数量" rules={[{ required: true }]}><InputNumber min={0.01} /></Form.Item>
          <Form.Item name="result" label="结果" initialValue="pass"><Select options={[{ value: 'pass', label: '合格' }, { value: 'fail', label: '不合格' }]} /></Form.Item>
          <Form.Item name="source" label="来源" initialValue="purchase_receipt"><Select options={[{ value: 'purchase_receipt', label: '采购收货' }, { value: 'production_output', label: '完工产出' }]} /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={submitting}>提交质检</Button></Form.Item>
        </Form>
      </Card>
      {error && <Alert type="error" message={error} />}
      {result && <StructuredSection title="事实发布结果" data={result} />}
    </Space>
  );
}


function ExecutionOutputTab() {
  const [result, setResult] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await publishExecutionOutput({
        order_id: values.order_id,
        location_id: values.location_id,
        execution_event: {
          event_type: 'actual_finish',
          event_id: `ui-finish-${Date.now()}`,
          external_ref: `UI-${Date.now()}`,
          source: 'mes',
          reported_quantity: Number(values.quantity),
          scrap_quantity: Number(values.scrap_quantity ?? 0),
          operation_id: values.operation_id,
          plan_version: values.plan_version,
          actual_end_time: new Date().toISOString(),
        },
      });
      setResult(response);
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="完工登记（模拟 MES actual_finish → 产出待检 + 良率）">
        <Form layout="inline" onFinish={submit}>
          <Form.Item name="order_id" label="订单" rules={[{ required: true }]}><Input placeholder="SO-1" /></Form.Item>
          <Form.Item name="location_id" label="成品库位" initialValue="FG-WH"><Input /></Form.Item>
          <Form.Item name="quantity" label="完工数量" rules={[{ required: true }]}><InputNumber min={0.01} /></Form.Item>
          <Form.Item name="scrap_quantity" label="报废数" initialValue={0}><InputNumber min={0} /></Form.Item>
          <Form.Item name="operation_id" label="工序" initialValue="OP-10"><Input /></Form.Item>
          <Form.Item name="plan_version" label="计划版本" initialValue="plan-v1"><Input /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={submitting}>登记完工</Button></Form.Item>
        </Form>
      </Card>
      {error && <Alert type="error" message={error} />}
      {result && <StructuredSection title="完工事实发布结果（产出→待检，需质检 pass 才入可用）" data={result} />}
    </Space>
  );
}


function CostVarianceTab() {
  const [period, setPeriod] = useState('2026-08');
  const [report, setReport] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getBusinessCostVariance(period.trim()));
    } catch (err) {
      setError(String(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const lines = useMemo(() => (Array.isArray(report?.lines) ? report.lines as JsonRecord[] : []), [report]);
  const columns = [
    { title: '物料', dataIndex: 'material_code' },
    { title: '名称', dataIndex: 'material_name' },
    { title: '消耗量', dataIndex: 'consumed_quantity' },
    { title: '标准单价', dataIndex: 'standard_unit_cost' },
    { title: '标准成本', dataIndex: 'standard_cost' },
    { title: '实际单价', dataIndex: 'actual_unit_cost' },
    { title: '实际成本', dataIndex: 'actual_cost' },
    { title: '差异', dataIndex: 'variance' },
    { title: '差异率', dataIndex: 'variance_rate' },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space.Compact style={{ width: 360 }}>
        <Input placeholder="期间 YYYY-MM" value={period} onChange={(event) => setPeriod(event.target.value)} onPressEnter={run} />
        <Button type="primary" loading={loading} onClick={run}>生成成本差异</Button>
      </Space.Compact>
      {error && <Alert type="error" message={error} />}
      {report && (
        <>
          <Descriptions size="small" column={3} bordered>
            <Descriptions.Item label="期间">{String(report.period)}</Descriptions.Item>
            <Descriptions.Item label="币种">{String(report.currency)}</Descriptions.Item>
            <Descriptions.Item label="方法">{String(report.method)}</Descriptions.Item>
            <Descriptions.Item label="标准成本合计">{String((report.totals as JsonRecord).standard_cost ?? '-')}</Descriptions.Item>
            <Descriptions.Item label="实际成本合计">{String((report.totals as JsonRecord).actual_cost ?? '-')}</Descriptions.Item>
            <Descriptions.Item label="差异合计">{String((report.totals as JsonRecord).variance ?? '-')}</Descriptions.Item>
          </Descriptions>
          <Table rowKey="material_id" size="small" columns={columns} dataSource={lines} pagination={false} />
          <StructuredSection title="数据质量（mock 价格标记）" data={report.data_quality} />
        </>
      )}
    </Space>
  );
}


export function BusinessTraceWorkbenchPage() {
  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>统一业务追溯工作台</Title>
      <Paragraph type="secondary">
        基于统一事实账本：收货→待检→质检→可用、完工→产出待检→检验、批次链追溯、工序良率与实际/标准成本差异。
        当前数据为确定性 mock，接口输出与真实后端一致。
      </Paragraph>
      <Tabs
        items={[
          { key: 'order', label: '订单追溯', children: <OrderTraceTab /> },
          { key: 'material', label: '物料批次追溯', children: <MaterialTraceTab /> },
          { key: 'receipt', label: '收货与质检', children: <ReceiptInspectionTab /> },
          { key: 'output', label: '完工登记', children: <ExecutionOutputTab /> },
          { key: 'cost', label: '成本差异', children: <CostVarianceTab /> },
          { key: 'documents', label: '工程文档', children: <EngineeringDocumentsCard title="业务页工程文档" /> },
        ]}
      />
    </div>
  );
}

export default BusinessTraceWorkbenchPage;
