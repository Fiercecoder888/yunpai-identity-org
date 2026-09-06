import { EyeOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tabs, Tag, message } from 'antd';
import type { FormInstance } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { isMswDemoMode } from '../app/runtimeMode';
import { useAuthStore } from '../auth/useAuthStore';
import { M0BurstCaptureModal } from './m0/M0BurstCaptureModal';
import { M0BatchOriginalPreviewModal } from './m0/M0BatchOriginalPreviewModal';
import { canApproveM7OverIssue, resolveM7ApprovalRoles } from './m7/m7Permissions';
import {
  formatM7MissingField,
  formatM7RecognitionWarning,
  formatM7ReferenceField,
} from './m7/m7RecognitionMessages';
import { useCurrentRole } from './roles/useCurrentRole';
import {
  allocateM7InventoryToOrder, approveM7OverIssue, confirmM7Inspection, createM7DeliveryNote, createM7MaterialIssue, createM7OverIssue,
  listM7DeliveryNotes, listM7MaterialIssues, listM7PendingInspections, queryM7Inventory,
  sampleM7Inspection, scanM7DeliveryNote, signM7DeliveryNote,
  upsertM7OrderMaterialRequirement,
  type M7DeliveryNote, type M7DeliveryScan, type M7InspectionLot, type M7InventoryBalance, type M7MaterialIssue,
} from '../services/m7Api';

const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败';

export type M7WarehouseTab = 'delivery' | 'qc' | 'issue' | 'inventory';

export const buildM7InventoryAllocationRequest = (
  balance: M7InventoryBalance,
  values: { quantity: number; order_id: string },
) => ({
  warehouse_id: balance.warehouse_id,
  material_id: balance.material_id,
  material_code: balance.material_code,
  batch_no: balance.batch_no,
  quantity: values.quantity,
  uom: balance.uom,
  order_id: values.order_id,
  idempotency_key: `allocation:${values.order_id}:${balance.material_id}:${balance.batch_no}:${values.quantity}`,
});

export const buildM7MaterialIssueItem = (
  balance: M7InventoryBalance,
  requestedQuantity: number,
) => ({
  warehouse_id: balance.warehouse_id,
  material_id: balance.material_id,
  material_code: balance.material_code,
  batch_no: balance.batch_no,
  requested_quantity: requestedQuantity,
  uom: balance.uom,
});

const deliveryItemInput = (item: Record<string, unknown>) => ({
  purchase_order_item_id: item.purchase_order_item_id,
  material_id: item.material_id,
  material_code: item.material_code,
  batch_no: item.batch_no,
  quantity: item.quantity,
  uom: item.uom,
});

export function M7WarehousePanel({
  initialTab = 'delivery',
  initialDeliveryScan,
  deliveryTaskId,
  onDeliveryCreated,
}: {
  initialTab?: M7WarehouseTab;
  initialDeliveryScan?: M7DeliveryScan | null;
  deliveryTaskId?: string;
  onDeliveryCreated?: () => void | Promise<void>;
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const delegatedRoles = useAuthStore((state) => state.me?.roles);
  const currentRole = useCurrentRole();
  const [delivery, setDelivery] = useState<M7DeliveryNote[]>([]);
  const [lots, setLots] = useState<M7InspectionLot[]>([]);
  const [inventory, setInventory] = useState<M7InventoryBalance[]>([]);
  const [issues, setIssues] = useState<M7MaterialIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBatchId, setScanBatchId] = useState<string | null>(null);
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false);
  const [scanReview, setScanReview] = useState<{
    missing: string[];
    warnings: string[];
    references: string[];
  } | null>(null);
  const [signingNote, setSigningNote] = useState<M7DeliveryNote | null>(null);
  const [samplingLot, setSamplingLot] = useState<M7InspectionLot | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [activeTab, setActiveTab] = useState<M7WarehouseTab>(initialTab);
  const [deliveryForm] = Form.useForm();
  const [signatureForm] = Form.useForm();
  const [sampleForm] = Form.useForm();
  const [requirementForm] = Form.useForm();
  const [issueForm] = Form.useForm();
  const [allocationForm] = Form.useForm();
  const approvalRoles = resolveM7ApprovalRoles(
    delegatedRoles ?? [],
    currentRole.data?.id,
    isMswDemoMode(),
  );
  const mayApproveOverIssue = canApproveM7OverIssue(approvalRoles);
  const scanReviewMessages = scanReview ? Array.from(new Set([
    ...scanReview.missing.map(formatM7MissingField),
    ...scanReview.warnings.map(formatM7RecognitionWarning),
    ...scanReview.references,
  ])) : [];

  const applyDeliveryPreview = useCallback((preview: M7DeliveryScan) => {
    const fields = preview.suggested;
    deliveryForm.setFieldsValue({
      ...fields,
      items: preview.items.length > 0 ? preview.items.map(deliveryItemInput) : [{}],
      source_document_id: preview.m0_batch_id,
    });
    setScanReview({
      missing: preview.missing_fields,
      warnings: preview.warnings,
      references: Object.entries(preview.reference_fields).map(([key, value]) => formatM7ReferenceField(key, value)),
    });
    setScanBatchId(preview.m0_batch_id);
  }, [deliveryForm]);

  const inventoryOptions = inventory.map((balance) => ({
    value: balance.inventory_balance_id,
    label: `${balance.material_code} · ${balance.batch_no} · 可用 ${balance.quantity_available} ${balance.uom}`,
  }));
  const availableInventoryOptions = inventory
    .filter((balance) => Number(balance.quantity_available) > 0 || (balance.allocations?.length ?? 0) > 0)
    .map((balance) => ({
      value: balance.inventory_balance_id,
      label: `${balance.material_code} · ${balance.batch_no} · 公共可用 ${balance.quantity_available} ${balance.uom}${balance.allocations?.length ? ` · 专用 ${balance.allocations.map((item) => `${item.order_id} ${item.quantity_remaining}`).join(' / ')}` : ''}`,
    }));

  const applyInventoryIdentity = (balanceId: string, target: FormInstance) => {
    const balance = inventory.find((item) => item.inventory_balance_id === balanceId);
    if (!balance) return;
    target.setFieldsValue({
      warehouse_id: balance.warehouse_id,
      material_id: balance.material_id,
      material_code: balance.material_code,
      batch_no: balance.batch_no,
      uom: balance.uom,
    });
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDelivery, nextLots, nextInventory, nextIssues] = await Promise.all([
        listM7DeliveryNotes(), listM7PendingInspections(), queryM7Inventory(), listM7MaterialIssues(),
      ]);
      setDelivery(nextDelivery); setLots(nextLots); setInventory(nextInventory); setIssues(nextIssues);
    } catch (error) { messageApi.error(errorText(error)); }
    finally { setLoading(false); }
  }, [messageApi]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);
  useEffect(() => {
    if (initialDeliveryScan) applyDeliveryPreview(initialDeliveryScan);
  }, [applyDeliveryPreview, initialDeliveryScan]);

  const deliveryTab = <Space direction="vertical" style={{ width: '100%' }} size="middle">
    <Alert type="info" showIcon message="签收后库存进入冻结区；品保确认后才转为可用库存。" />
    <Space><Button onClick={() => setScanOpen(true)}>拍照或文件识别（M0 + M1）</Button></Space>
    {scanReview && scanBatchId ? (
      <Alert
        type={scanReviewMessages.length > 0 ? 'warning' : 'info'}
        showIcon
        message={scanReviewMessages.length > 0 ? '识别结果需要人工补充' : '识别结果已预填'}
        description={scanReviewMessages.length > 0
          ? `${scanReviewMessages.join('；')}。请对照原文件核对后再创建送货单。`
          : '请对照原文件核对模型预填的属性，确认无误后再创建送货单。'}
        action={
          <Button icon={<EyeOutlined />} onClick={() => setSourcePreviewOpen(true)}>
            预览原文件
          </Button>
        }
      />
    ) : null}
    <Form form={deliveryForm} layout="vertical" initialValues={{ warehouse_id: 'WH-01', items: [{ uom: 'pcs' }] }} onFinish={async (values) => {
      try {
        await createM7DeliveryNote({
          delivery_note_number: values.delivery_note_number, supplier_id: values.supplier_id,
          supplier_delivery_number: values.supplier_delivery_number, purchase_order_id: values.purchase_order_id,
          order_id: values.order_id, warehouse_id: values.warehouse_id, source_document_id: values.source_document_id,
          dedicated_order_id: values.dedicated_order_id || undefined,
          idempotency_key: `delivery:${values.delivery_note_number}`,
          items: values.items.map((item: Record<string, unknown>) => deliveryItemInput(item)),
        }, deliveryTaskId);
        messageApi.success('送货单已创建');
        await refresh();
        try {
          await onDeliveryCreated?.();
        } catch {
          messageApi.warning('送货单已创建，但对话草稿状态同步失败，请刷新后核对。');
        }
      } catch (error) { messageApi.error(errorText(error)); }
    }}>
      <Form.Item name="source_document_id" hidden><Input /></Form.Item>
      <Space wrap align="start">
        <Form.Item name="delivery_note_number" label="送货单号" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="supplier_id" label="供应商 ID" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="supplier_delivery_number" label="供应商单号" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="purchase_order_id" label="采购单 ID" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="order_id" label="订单 ID" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="dedicated_order_id" label="专用订单（可选）" tooltip="填写后，质检放行的这批库存只允许该订单领取"><Input placeholder="留空=公共库存" /></Form.Item>
        <Form.Item name="warehouse_id" label="仓库" rules={[{ required: true }]}><Input /></Form.Item>
      </Space>
      <Form.List name="items">
        {(fields, { add, remove }) => <Space direction="vertical" style={{ width: '100%' }}>
          {fields.map(({ key, name, ...restField }, index) => (
            <Card
              key={key}
              size="small"
              title={`到货明细 ${index + 1}`}
              extra={fields.length > 1 ? <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(name)} aria-label={`删除明细 ${index + 1}`} /> : null}
            >
              <Space wrap align="start">
                <Form.Item {...restField} name={[name, 'purchase_order_item_id']} label="采购行 ID" rules={[{ required: true }]}><Input /></Form.Item>
                <Form.Item {...restField} name={[name, 'material_id']} label="物料 ID" rules={[{ required: true }]}><Input /></Form.Item>
                <Form.Item {...restField} name={[name, 'material_code']} label="物料编码" rules={[{ required: true }]}><Input /></Form.Item>
                <Form.Item {...restField} name={[name, 'batch_no']} label="批次" rules={[{ required: true }]}><Input /></Form.Item>
                <Form.Item {...restField} name={[name, 'quantity']} label="到货数量" rules={[{ required: true }]}><InputNumber min={0.000001} /></Form.Item>
                <Form.Item {...restField} name={[name, 'uom']} label="单位" rules={[{ required: true }]}><Input /></Form.Item>
              </Space>
            </Card>
          ))}
          <Button icon={<PlusOutlined />} onClick={() => add({ uom: 'pcs' })}>添加明细</Button>
        </Space>}
      </Form.List>
      <Button type="primary" htmlType="submit">创建送货单</Button>
    </Form>
    <Table loading={loading} rowKey="delivery_note_id" dataSource={delivery} pagination={false} columns={[
      { title: '送货单', dataIndex: 'delivery_note_number' }, { title: '采购单', dataIndex: 'purchase_order_id' },
      { title: '订单', dataIndex: 'order_id' }, { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
      { title: '操作', render: (_, row) => row.status === 'draft' ? <Button onClick={() => {
        signatureForm.resetFields(); setSigningNote(row);
      }}>签收</Button> : null },
    ]} />
  </Space>;

  const qcTab = <Space direction="vertical" style={{ width: '100%' }} size="middle">
    <Alert type="warning" showIcon message="抽样与最终放行分离；未经抽样不能放行。" />
    <Table loading={loading} rowKey="inspection_lot_id" dataSource={lots} pagination={false} columns={[
      { title: '物料', dataIndex: 'material_code' }, { title: '批次', dataIndex: 'batch_no' },
      { title: '批量', dataIndex: 'lot_quantity' }, { title: '应抽', dataIndex: 'recommended_sample_quantity' }, { title: '状态', dataIndex: 'status' },
      { title: '操作', render: (_, row) => <Space wrap>
        {row.status === 'pending' ? <Button onClick={() => {
          sampleForm.setFieldsValue({
            sample_quantity: Number(row.recommended_sample_quantity),
            nonconforming_quantity: 0,
            reason: row.sampling_rule,
          });
          setSamplingLot(row);
        }}>录入抽检</Button> : null}
        {row.status === 'sampling' ? <><Button type="primary" onClick={async () => {
          try { await confirmM7Inspection(row, 'passed', '检验合格'); messageApi.success('已放行入库'); await refresh(); }
          catch (error) { messageApi.error(errorText(error)); }
        }}>合格放行</Button><Button danger onClick={async () => {
          try { await confirmM7Inspection(row, 'rejected', '检验不合格'); messageApi.success('已拒收退回'); await refresh(); }
          catch (error) { messageApi.error(errorText(error)); }
        }}>不合格拒收</Button></> : null}
      </Space> },
    ]} />
  </Space>;

  const issueTab = <Space direction="vertical" style={{ width: '100%' }} size="middle">
    <Alert type="info" showIcon message="允许量 = 标准需求量 × (1 + 损耗率)。超限必须走超领审批，申请人不能自批。" />
    <Card size="small" title="领料前置 · 登记订单标准用量">
      <Alert type="warning" showIcon message="该操作通过编排器受控工具写入订单物料需求；版本不变时重复提交必须保持内容一致。" />
      <Form name="m7Requirement" form={requirementForm} layout="vertical" initialValues={{ loss_rate: 0.05, source_version_id: 'manual-v1' }}
        onFinish={async (values) => {
          try {
            await upsertM7OrderMaterialRequirement({
              order_id: values.order_id, material_id: values.material_id, material_code: values.material_code,
              standard_required_quantity: values.standard_required_quantity, loss_rate: values.loss_rate,
              uom: values.uom, source_version_id: values.source_version_id,
            });
            messageApi.success('订单标准用量已登记，可以继续正常领料');
          } catch (error) { messageApi.error(errorText(error)); }
        }}>
        <Space wrap align="start">
          <Form.Item name="inventory_balance_id" label="从库存选择物料" rules={[{ required: true, message: '请选择库存物料，系统将自动带出身份和单位' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择物料与批次"
              style={{ width: 300 }}
              options={inventoryOptions}
              onChange={(value) => applyInventoryIdentity(value, requirementForm)}
            />
          </Form.Item>
          <Form.Item name="order_id" label="订单 ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="material_id" label="物料 ID" rules={[{ required: true }]}><Input readOnly /></Form.Item>
          <Form.Item name="material_code" label="物料编码" rules={[{ required: true }]}><Input readOnly /></Form.Item>
          <Form.Item name="standard_required_quantity" label="标准需求量" rules={[{ required: true }]}><InputNumber min={0.000001} /></Form.Item>
          <Form.Item name="loss_rate" label="损耗率（0.05 = 5%）" rules={[{ required: true }]}><InputNumber min={0} max={1} step={0.01} /></Form.Item>
          <Form.Item name="uom" label="单位" rules={[{ required: true }]}><Input readOnly /></Form.Item>
          <Form.Item name="source_version_id" label="来源版本" rules={[{ required: true }]}><Input /></Form.Item>
        </Space>
        <Button type="primary" htmlType="submit">登记标准用量</Button>
      </Form>
    </Card>
    <Form name="m7Issue" form={issueForm} layout="vertical" initialValues={{ mode: 'normal' }} onFinish={async (values) => {
      const over = values.mode === 'over';
      try {
        const submitIssue = over ? createM7OverIssue : createM7MaterialIssue;
        const selectedBalance = inventory.find((item) => item.inventory_balance_id === values.inventory_balance_id);
        if (!selectedBalance) throw new Error('库存批次已失效，请刷新后重新选择');
        await submitIssue({
          issue_number: values.issue_number, order_id: values.order_id, purpose: values.purpose,
          idempotency_key: `issue:${values.issue_number}`, reason_code: over ? 'OVER_ALLOWANCE' : undefined,
          reason: over ? values.reason : undefined,
          items: [buildM7MaterialIssueItem(selectedBalance, values.requested_quantity)],
        });
        messageApi.success(over ? '超领申请已提交' : '领料已出库'); await refresh();
      } catch (error) { messageApi.error(errorText(error)); }
    }}>
      <Space wrap align="start">
        <Form.Item name="mode" label="类型"><Radio.Group options={[{ label: '正常领料', value: 'normal' }, { label: '超领申请', value: 'over' }]} /></Form.Item>
        <Form.Item name="inventory_balance_id" label="库存批次" rules={[{ required: true, message: '请选择要领用的库存批次' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择可用库存"
            style={{ width: 300 }}
            options={availableInventoryOptions}
            onChange={(value) => applyInventoryIdentity(value, issueForm)}
          />
        </Form.Item>
        <Form.Item name="issue_number" label="领料单号" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="order_id" label="订单 ID" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="purpose" label="用途" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="warehouse_id" label="仓库" rules={[{ required: true }]}><Input readOnly /></Form.Item>
        <Form.Item name="material_id" label="物料 ID" rules={[{ required: true }]}><Input readOnly /></Form.Item>
        <Form.Item name="material_code" label="物料编码" rules={[{ required: true }]}><Input readOnly /></Form.Item>
        <Form.Item name="batch_no" label="批次" rules={[{ required: true }]}><Input readOnly /></Form.Item>
        <Form.Item name="requested_quantity" label="领用量" rules={[{ required: true }]}><InputNumber min={0.000001} /></Form.Item>
        <Form.Item name="uom" label="单位"><Input readOnly /></Form.Item>
        <Form.Item dependencies={["mode"]} noStyle>
          {({ getFieldValue }) => <Form.Item name="reason" label="超领原因"
            rules={[{ required: getFieldValue('mode') === 'over', message: '超领必须填写原因' }]}>
            <Input />
          </Form.Item>}
        </Form.Item>
      </Space>
      <Button type="primary" htmlType="submit">提交</Button>
    </Form>
    <Card size="small" title="库存指定订单">
      <Alert type="info" showIcon message="指定后数量从公共可用库存转为订单专用库存；其他订单不能领取，留空则保持公共库存。" />
      <Form form={allocationForm} layout="vertical" onFinish={async (values) => {
        try {
          const selectedBalance = inventory.find((item) => item.inventory_balance_id === values.inventory_balance_id);
          if (!selectedBalance) throw new Error('库存批次已失效，请刷新后重新选择');
          await allocateM7InventoryToOrder(buildM7InventoryAllocationRequest(selectedBalance, values));
          messageApi.success('库存已指定给订单'); allocationForm.resetFields(); await refresh();
        } catch (error) { messageApi.error(errorText(error)); }
      }}>
        <Space wrap align="start">
          <Form.Item name="inventory_balance_id" label="公共库存批次" rules={[{ required: true, message: '请选择公共库存批次' }]}>
            <Select
              showSearch optionFilterProp="label" placeholder="选择公共可用库存" style={{ width: 300 }}
              options={availableInventoryOptions}
              onChange={(value) => applyInventoryIdentity(value, allocationForm)}
            />
          </Form.Item>
          <Form.Item name="order_id" label="专用订单 ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="quantity" label="指定数量" rules={[{ required: true }]}><InputNumber min={0.000001} /></Form.Item>
          <Form.Item name="warehouse_id" hidden><Input /></Form.Item>
          <Form.Item name="material_id" hidden><Input /></Form.Item>
          <Form.Item name="material_code" hidden><Input /></Form.Item>
          <Form.Item name="batch_no" hidden><Input /></Form.Item>
          <Form.Item name="uom" hidden><Input /></Form.Item>
        </Space>
        <Button type="primary" htmlType="submit">指定库存</Button>
      </Form>
    </Card>
    <Table loading={loading} rowKey="material_issue_id" dataSource={issues} pagination={false} columns={[
      { title: '领料单', dataIndex: 'issue_number' }, { title: '订单', dataIndex: 'order_id' }, { title: '类型', dataIndex: 'issue_type' },
      { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
      { title: '审批', render: (_, row) => {
        if (row.issue_type !== 'over' || row.status !== 'pending_approval') return null;
        if (!mayApproveOverIssue) return <Tag color="orange">待组长或厂长审批</Tag>;
        return <Button onClick={async () => {
          try { await approveM7OverIssue(row, '组长确认超领'); messageApi.success('超领已批准并出库'); await refresh(); }
          catch (error) { messageApi.error(errorText(error)); }
        }}>批准并出库</Button>;
      } },
    ]} />
  </Space>;

  return <>{contextHolder}<Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as M7WarehouseTab)} items={[
    { key: 'delivery', label: '送货签收', children: deliveryTab },
    { key: 'qc', label: `品保待检 (${lots.length})`, children: qcTab },
    { key: 'issue', label: '领料/超领', children: issueTab },
    { key: 'inventory', label: '库存', children: <Table loading={loading} rowKey="inventory_balance_id" dataSource={inventory} pagination={false} columns={[
      { title: '仓库', dataIndex: 'warehouse_id' }, { title: '物料 ID', dataIndex: 'material_id' }, { title: '物料', dataIndex: 'material_code' }, { title: '批次', dataIndex: 'batch_no' }, { title: '现存', dataIndex: 'quantity_on_hand' },
      { title: '可用', dataIndex: 'quantity_available' }, { title: '冻结', dataIndex: 'quantity_blocked' }, { title: '预留', dataIndex: 'quantity_reserved' }, { title: '单位', dataIndex: 'uom' },
      { title: '订单专用', render: (_, row: M7InventoryBalance) => row.allocations?.length
        ? row.allocations.map((allocation) => `${allocation.order_id}: ${allocation.quantity_remaining}`).join('；')
        : '公共库存' },
    ]} /> },
  ]} /><Modal title="仓管签收确认" open={Boolean(signingNote)} confirmLoading={submittingAction}
    onCancel={() => setSigningNote(null)} onOk={() => signatureForm.submit()} destroyOnHidden>
    <Form form={signatureForm} layout="vertical" onFinish={async ({ signature_reference }) => {
      if (!signingNote) return;
      setSubmittingAction(true);
      try {
        await signM7DeliveryNote(signingNote, signature_reference);
        messageApi.success('签收完成，已生成待检批次'); setSigningNote(null); await refresh();
      } catch (error) { messageApi.error(errorText(error)); }
      finally { setSubmittingAction(false); }
    }}>
      <Alert type="warning" showIcon message="签收后数量进入冻结库存，等待品保抽检。" />
      <Form.Item name="signature_reference" label="签收人或签名凭证" rules={[{ required: true, min: 2 }]}>
        <Input placeholder="例如：李文海 / 电子签名凭证编号" />
      </Form.Item>
    </Form>
  </Modal><Modal title="来料抽检记录" open={Boolean(samplingLot)} confirmLoading={submittingAction}
    onCancel={() => setSamplingLot(null)} onOk={() => sampleForm.submit()} destroyOnHidden>
    <Form form={sampleForm} layout="vertical" onFinish={async (values) => {
      if (!samplingLot) return;
      setSubmittingAction(true);
      try {
        await sampleM7Inspection(samplingLot, values.sample_quantity, values.nonconforming_quantity, values.reason);
        messageApi.success('抽检记录已保存，请继续确认放行或拒收'); setSamplingLot(null); await refresh();
      } catch (error) { messageApi.error(errorText(error)); }
      finally { setSubmittingAction(false); }
    }}>
      <Alert type="info" showIcon message={`批量 ${samplingLot?.lot_quantity ?? '-'}；最低抽样 ${samplingLot?.recommended_sample_quantity ?? '-'}`} />
      <Form.Item name="sample_quantity" label="实际抽样数量" rules={[{ required: true }]}>
        <InputNumber min={Number(samplingLot?.recommended_sample_quantity ?? 1)} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="nonconforming_quantity" label="NG 数量" rules={[{ required: true }]}>
        <InputNumber min={0} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="reason" label="抽检标准/说明"><Input.TextArea rows={3} /></Form.Item>
    </Form>
  </Modal><M0BurstCaptureModal allowDocuments open={scanOpen} onClose={() => setScanOpen(false)} onRecognized={async (batchId) => {
    try {
      const preview = await scanM7DeliveryNote(batchId);
      applyDeliveryPreview(preview);
      messageApi.success('识别结果已预填，请人工核对后提交');
      setScanOpen(false);
    } catch (error) { messageApi.error(errorText(error)); }
  }} /><M0BatchOriginalPreviewModal
    batchId={scanBatchId}
    open={sourcePreviewOpen}
    onClose={() => setSourcePreviewOpen(false)}
  /></>;
}
