import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  M0_WIKI_ENTITY_TYPES,
  createM0WikiEntity,
  deleteM0WikiEntity,
  getM0WikiBomDiff,
  getM0WikiBomLines,
  getM0WikiEntity,
  getM0WikiEquipment,
  getM0WikiMaterial,
  getM0WikiProduct,
  searchM0Wiki,
  updateM0WikiEntity,
  type M0SearchResultItem,
  type M0WikiBomDiff,
  type M0WikiBomLines,
  type M0WikiEntityDetail,
  type M0WikiEntitySnapshot,
  type M0WikiEntityType,
  type M0WikiEquipment,
  type M0WikiIndexEntry,
  type M0WikiMaterial,
  type M0WikiProduct,
} from '../services/m0WikiApi';
import { HttpClientError } from '../services/httpClient';

const INDEX_LABELS: Record<string, string> = {
  orders: '订单',
  approval_specifications: '承认书',
  boms: 'BOM',
  sops: 'SOP',
  engineering_drawings: '工程图',
};

const ENTITY_LABELS: Record<M0WikiEntityType, string> = {
  product: '产品',
  product_family: '产品族',
  order: '订单',
  bom: 'BOM',
  document: '文档',
  material: '物料',
  supplier: '供应商',
  equipment: '设备',
  process_route: '工艺路线',
  operation: '工序',
  tooling: '工装',
};

const VERSIONED_ENTITY_TYPES = new Set<M0WikiEntityType>(['bom', 'document', 'process_route']);
const DELETED_STATUSES = new Set(['deprecated', 'inactive', 'cancelled', 'withdrawn', 'superseded', 'retired']);

type EntitySelection = {
  entityType: M0WikiEntityType;
  businessKey: string;
  versionId?: string;
};

type EntityEditorValues = {
  entityType: M0WikiEntityType;
  businessKey: string;
  versionId: string;
  payloadText: string;
  reason: string;
};

function isWikiEntityType(value: string): value is M0WikiEntityType {
  return (M0_WIKI_ENTITY_TYPES as readonly string[]).includes(value);
}

function unwrapIndexEntry(entry: M0WikiIndexEntry): M0WikiIndexEntry {
  const wrapped = entry as M0WikiIndexEntry & { entity?: M0WikiIndexEntry };
  return wrapped.entity ?? entry;
}

function payloadTemplate(entityType: M0WikiEntityType): Record<string, unknown> {
  const templates: Record<M0WikiEntityType, Record<string, unknown>> = {
    product: { name: '', model: '', aliases: [], status: 'active', attributes: {} },
    product_family: { name: '', description: '', status: 'active', attributes: {} },
    order: {
      customer: '',
      order_date: null,
      due_date: null,
      status: 'active',
      lines: [{ line_no: '10', product_code: '', quantity: 1, uom: 'PCS', requested_spec: {} }],
      attributes: {},
    },
    bom: {
      product_code: '',
      status: 'active',
      lines: [{ line_no: '10', material_code: '', material_name: '', quantity: 1, uom: 'PCS', loss_rate: 0 }],
      attributes: {},
    },
    document: {
      role: 'engineering_drawing',
      title: '',
      product_codes: [],
      content_uri: '',
      status: 'active',
      attributes: {},
    },
    material: { name: '', spec: {}, unit: 'PCS', status: 'active', aliases: [], attributes: {} },
    supplier: { name: '', legal_id: '', status: 'active', material_codes: [], aliases: [], attributes: {} },
    equipment: { name: '', equipment_type: '', line: '', status: 'active', attributes: {} },
    process_route: {
      product_code: '',
      status: 'active',
      operations: [{ sequence_no: 1, operation_code: '', operation_name: '', material_codes: [], equipment_codes: [], tooling_codes: [] }],
      attributes: {},
    },
    operation: { name: '', standard_time: '', status: 'active', attributes: {} },
    tooling: { name: '', tooling_type: '', status: 'active', attributes: {} },
  };
  return templates[entityType];
}

function recordKey(record: unknown): string {
  if (!record || typeof record !== 'object') return String(record ?? '');
  const row = record as Record<string, unknown>;
  const fields = [
    'entity_id',
    'version_row_id',
    'business_key',
    'line_no',
    'version_id',
    'recorded_from',
    'source_entity_id',
    'relation_type',
    'target_entity_id',
  ];
  const parts = fields
    .filter((field) => row[field] !== undefined && row[field] !== null && row[field] !== '')
    .map((field) => `${field}:${String(row[field])}`);
  return parts.join('|') || JSON.stringify(row);
}

function entryKey(entry: M0WikiIndexEntry): string {
  const normalized = unwrapIndexEntry(entry);
  return String(normalized.entity_id ?? normalized.business_key ?? recordKey(normalized));
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof HttpClientError && error.error.status === 404;
}

function IndexTable({ entries }: { entries: M0WikiIndexEntry[] }) {
  return (
    <Table<M0WikiIndexEntry>
      size="small"
      rowKey={entryKey}
      dataSource={entries.map(unwrapIndexEntry)}
      pagination={false}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" /> }}
      columns={[
        { title: '编码', dataIndex: 'business_key', key: 'business_key' },
        { title: '名称', dataIndex: 'label', key: 'label' },
        { title: '版本', dataIndex: 'version_id', key: 'version_id', width: 90 },
        {
          title: '状态',
          dataIndex: 'status',
          key: 'status',
          width: 100,
          render: (status: string) => (status ? <Tag>{status}</Tag> : '-'),
        },
      ]}
    />
  );
}

function ProductWikiView({ productCode }: { productCode: string }) {
  const [product, setProduct] = useState<M0WikiProduct | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [bomCode, setBomCode] = useState('');
  const [baseRevision, setBaseRevision] = useState('');
  const [targetRevision, setTargetRevision] = useState('');
  const [bomLines, setBomLines] = useState<M0WikiBomLines | null>(null);
  const [bomDiff, setBomDiff] = useState<M0WikiBomDiff | null>(null);
  const [bomError, setBomError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setProduct(null);
    getM0WikiProduct(productCode)
      .then((result) => {
        if (active) setProduct(result);
      })
      .catch((exc: unknown) => {
        if (active) setError(exc instanceof Error ? exc.message : String(exc));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productCode]);

  useEffect(() => {
    const boms = (product?.indexes?.boms ?? []).map(unwrapIndexEntry);
    if (bomCode === '' && boms.length > 0) {
      const first = boms[0];
      const firstCode = String(first?.business_key ?? '');
      setBomCode(firstCode);
      const revisions = boms
        .filter((item) => String(item.business_key ?? '') === firstCode)
        .map((item) => String(item.version_id ?? ''));
      if (revisions[0] !== undefined) setTargetRevision(revisions[0]);
      if (revisions[1] !== undefined) setBaseRevision(revisions[1]);
    }
  }, [product, bomCode]);

  const loadBom = useCallback(() => {
    if (!bomCode || !targetRevision) return;
    setBomError('');
    setBomDiff(null);
    getM0WikiBomLines(productCode, bomCode, targetRevision)
      .then(setBomLines)
      .catch((exc: unknown) => setBomError(exc instanceof Error ? exc.message : String(exc)));
  }, [productCode, bomCode, targetRevision]);

  const loadDiff = useCallback(() => {
    if (!bomCode || !baseRevision || !targetRevision) return;
    setBomError('');
    getM0WikiBomDiff(productCode, bomCode, baseRevision, targetRevision)
      .then(setBomDiff)
      .catch((exc: unknown) => setBomError(exc instanceof Error ? exc.message : String(exc)));
  }, [productCode, bomCode, baseRevision, targetRevision]);

  const bomOptions = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const rawItem of product?.indexes?.boms ?? []) {
      const item = unwrapIndexEntry(rawItem);
      const key = String(item.business_key ?? '');
      const revision = String(item.version_id ?? '');
      const revisions = map.get(key) ?? [];
      if (revision && !revisions.includes(revision)) revisions.push(revision);
      map.set(key, revisions);
    }
    return map;
  }, [product]);

  if (loading) return <Spin />;
  if (error) return <Alert type="error" showIcon message={`产品加载失败：${error}`} />;
  if (!product) return <Empty description="未找到该产品" />;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card size="small">
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="产品编码">{product.product?.business_key ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="名称">{product.product?.label ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">{product.product?.status ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Tabs
        items={[
          {
            key: 'indexes',
            label: `索引（${Object.values(product.indexes ?? {}).reduce((sum, list) => sum + (list?.length ?? 0), 0)}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                {Object.entries(INDEX_LABELS).map(([key, label]) => (
                  <Card key={key} size="small" title={label}>
                    <IndexTable entries={product.indexes?.[key] ?? []} />
                  </Card>
                ))}
                <Card size="small" title="产品族">
                  <IndexTable entries={product.families ?? []} />
                </Card>
                <Card size="small" title="同系列产品">
                  <IndexTable entries={product.same_family_products ?? []} />
                </Card>
              </Space>
            ),
          },
          {
            key: 'bom',
            label: 'BOM',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Space wrap>
                  <Input
                    style={{ width: 220 }}
                    placeholder="BOM 编码"
                    value={bomCode}
                    onChange={(event) => setBomCode(event.target.value)}
                  />
                  <Input
                    style={{ width: 120 }}
                    placeholder="基线修订"
                    value={baseRevision}
                    onChange={(event) => setBaseRevision(event.target.value)}
                  />
                  <Input
                    style={{ width: 120 }}
                    placeholder="目标修订"
                    value={targetRevision}
                    onChange={(event) => setTargetRevision(event.target.value)}
                  />
                  <Button onClick={loadBom}>查看行</Button>
                  <Button onClick={loadDiff} disabled={!baseRevision || !targetRevision}>
                    对比
                  </Button>
                </Space>
                {bomOptions.size > 0 && (
                  <Typography.Text type="secondary">
                    可用 BOM：{[...bomOptions.entries()].map(([code, revisions]) => `${code}(${revisions.join('/')})`).join('、')}
                  </Typography.Text>
                )}
                {bomError && <Alert type="error" showIcon message={bomError} />}
                {bomLines && (
                  <Card size="small" title={`${bomLines.bom} ${bomLines.revision}（${bomLines.lines.length} 行）`}>
                    <Table
                      size="small"
                      rowKey={recordKey}
                      dataSource={bomLines.lines as Array<Record<string, unknown>>}
                      pagination={{ pageSize: 10 }}
                      columns={['line_no', 'material_code', 'material_name', 'quantity', 'uom', 'loss_rate'].map((field) => ({
                        title: field,
                        dataIndex: field,
                        key: field,
                      }))}
                    />
                  </Card>
                )}
                {bomDiff && (
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    {(['added', 'removed', 'changed'] as const).map((section) => {
                      const rows = (bomDiff[section] ?? []) as Array<Record<string, unknown>>;
                      return (
                        <Card
                          key={section}
                          size="small"
                          title={
                            <span>
                              {section === 'added' ? '新增' : section === 'removed' ? '删除' : '变更'}（{rows.length}）
                            </span>
                          }
                        >
                          <Table
                            size="small"
                            rowKey={recordKey}
                            dataSource={rows}
                            pagination={false}
                            columns={Object.keys(rows[0] ?? { line_no: '' }).slice(0, 6).map((field) => ({
                              title: field,
                              dataIndex: field,
                              key: field,
                            }))}
                          />
                        </Card>
                      );
                    })}
                  </Space>
                )}
              </Space>
            ),
          },
          {
            key: 'graph',
            label: `关系（${product.graph?.nodes?.length ?? 0} 节点 / ${product.graph?.edges?.length ?? 0} 边）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Card size="small" title="节点">
                  <Table
                    size="small"
                    rowKey="entity_id"
                    dataSource={product.graph?.nodes ?? []}
                    pagination={{ pageSize: 10 }}
                    columns={[
                      { title: '编码', dataIndex: 'business_key', key: 'business_key' },
                      { title: '名称', dataIndex: 'label', key: 'label' },
                      { title: '类型', dataIndex: 'entity_type', key: 'entity_type', width: 120 },
                    ]}
                  />
                </Card>
                <Card size="small" title="边">
                  <Table
                    size="small"
                    rowKey={recordKey}
                    dataSource={product.graph?.edges ?? []}
                    pagination={{ pageSize: 10 }}
                    columns={[
                      { title: '关系', dataIndex: 'relation_type', key: 'relation_type', width: 160 },
                      { title: '源', dataIndex: 'source_entity_id', key: 'source_entity_id' },
                      { title: '目标', dataIndex: 'target_entity_id', key: 'target_entity_id' },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          {
            key: 'history',
            label: `历史（${product.history?.length ?? 0}）`,
            children: (
              <Table
                size="small"
                rowKey={recordKey}
                dataSource={product.history ?? []}
                pagination={false}
                columns={[
                  { title: '版本', dataIndex: 'version_id', key: 'version_id' },
                  { title: '记录自', dataIndex: 'recorded_from', key: 'recorded_from' },
                  { title: '记录至', dataIndex: 'recorded_to', key: 'recorded_to' },
                  { title: '状态', dataIndex: 'status', key: 'status' },
                ]}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}

function MaterialWikiView({ materialCode }: { materialCode: string }) {
  const [material, setMaterial] = useState<M0WikiMaterial | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setNotFound(false);
    setMaterial(null);
    getM0WikiMaterial(materialCode)
      .then((result) => {
        if (active) setMaterial(result);
      })
      .catch((exc: unknown) => {
        if (!active) return;
        if (isNotFoundError(exc)) {
          setNotFound(true);
          return;
        }
        setError(exc instanceof Error ? exc.message : String(exc));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [materialCode]);

  if (loading) return <Spin />;
  if (notFound) return <Empty description={`未找到该物料：${materialCode}`} />;
  if (error) return <Alert type="error" showIcon message={`物料加载失败：${error}`} />;
  if (!material) return <Empty description={`未找到该物料：${materialCode}`} />;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Typography.Text strong>{material.material?.business_key ?? materialCode} 反查</Typography.Text>
      <Descriptions size="small" column={2}>
        {Object.entries(material.summary ?? {}).map(([key, value]) => (
          <Descriptions.Item key={key} label={key}>
            {String(value)}
          </Descriptions.Item>
        ))}
      </Descriptions>
    </Space>
  );
}

function EquipmentWikiView({ equipmentCode }: { equipmentCode: string }) {
  const [equipment, setEquipment] = useState<M0WikiEquipment | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setNotFound(false);
    setEquipment(null);
    getM0WikiEquipment(equipmentCode)
      .then((result) => {
        if (active) setEquipment(result);
      })
      .catch((exc: unknown) => {
        if (!active) return;
        if (isNotFoundError(exc)) {
          setNotFound(true);
          return;
        }
        setError(exc instanceof Error ? exc.message : String(exc));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [equipmentCode]);

  if (loading) return <Spin />;
  if (notFound) return <Empty description={`未找到该设备：${equipmentCode}`} />;
  if (error) return <Alert type="error" showIcon message={`设备加载失败：${error}`} />;
  if (!equipment) return <Empty description={`未找到该设备：${equipmentCode}`} />;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="small">
      <Typography.Text strong>{equipment.entity?.business_key ?? equipmentCode} 反查</Typography.Text>
      <Descriptions size="small" column={2}>
        {Object.entries(equipment.summary ?? {}).map(([key, value]) => (
          <Descriptions.Item key={key} label={key}>
            {String(value)}
          </Descriptions.Item>
        ))}
      </Descriptions>
    </Space>
  );
}

function EntityEditorModal({
  mode,
  open,
  detail,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  open: boolean;
  detail: M0WikiEntityDetail | null;
  onClose: () => void;
  onSaved: (entity: M0WikiEntitySnapshot) => void;
}) {
  const [form] = Form.useForm<EntityEditorValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const entityType = String(detail?.entity.entity_type ?? 'product');
    const normalizedType = isWikiEntityType(entityType) ? entityType : 'product';
    form.setFieldsValue({
      entityType: normalizedType,
      businessKey: String(detail?.entity.business_key ?? ''),
      versionId: String(detail?.entity.version_id ?? ''),
      payloadText: JSON.stringify(detail?.entity.attributes ?? payloadTemplate(normalizedType), null, 2),
      reason: '',
    });
    setError('');
    setSaving(false);
  }, [detail, form, open]);

  const submit = async (values: EntityEditorValues) => {
    setSaving(true);
    setError('');
    try {
      const parsed = JSON.parse(values.payloadText) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('业务数据必须是 JSON 对象');
      }
      const input = {
        entityType: values.entityType,
        businessKey: values.businessKey,
        versionId: values.versionId,
        payload: parsed as Record<string, unknown>,
        relations: detail?.entity.relations,
        expectedVersionRowId: mode === 'edit' ? detail?.entity.version_row_id : undefined,
        reason: values.reason,
      };
      const result = mode === 'create'
        ? await createM0WikiEntity(input)
        : await updateM0WikiEntity(input);
      setSaving(false);
      message.success(mode === 'create' ? '数据已新增' : '数据已保存');
      onSaved(result.entity);
    } catch (exc: unknown) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={mode === 'create' ? '新增 Wiki 数据' : '编辑 Wiki 数据'}
      open={open}
      okText={mode === 'create' ? '新增' : '保存'}
      cancelText="取消"
      confirmLoading={saving}
      width={720}
      onCancel={onClose}
      onOk={() => form.submit()}
      afterClose={() => form.resetFields()}
    >
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
        <Space style={{ width: '100%' }} align="start" wrap>
          <Form.Item name="entityType" label="实体类型" rules={[{ required: true }]}>
            <Select
              style={{ width: 180 }}
              disabled={mode === 'edit'}
              options={M0_WIKI_ENTITY_TYPES.map((value) => ({ value, label: ENTITY_LABELS[value] }))}
              onChange={(value: M0WikiEntityType) => {
                if (mode === 'create') {
                  form.setFieldValue('payloadText', JSON.stringify(payloadTemplate(value), null, 2));
                  form.setFieldValue('versionId', '');
                }
              }}
            />
          </Form.Item>
          <Form.Item name="businessKey" label="业务编码" rules={[{ required: true, whitespace: true }]}>
            <Input style={{ width: 260 }} disabled={mode === 'edit'} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.entityType !== current.entityType}>
            {({ getFieldValue }) => {
              const entityType = getFieldValue('entityType') as M0WikiEntityType;
              return (
                <Form.Item
                  name="versionId"
                  label="修订号"
                  rules={VERSIONED_ENTITY_TYPES.has(entityType) ? [{ required: true, whitespace: true }] : []}
                >
                  <Input style={{ width: 160 }} disabled={mode === 'edit'} />
                </Form.Item>
              );
            }}
          </Form.Item>
        </Space>
        <Form.Item
          name="payloadText"
          label="业务数据（JSON）"
          rules={[
            { required: true },
            {
              validator: async (_, value: string) => {
                try {
                  const parsed = JSON.parse(value) as unknown;
                  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
                } catch {
                  throw new Error('请输入有效的 JSON 对象');
                }
              },
            },
          ]}
        >
          <Input.TextArea autoSize={{ minRows: 12, maxRows: 22 }} spellCheck={false} />
        </Form.Item>
        <Form.Item name="reason" label="变更说明" rules={[{ required: true, whitespace: true }]}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
        </Form.Item>
        {error && <Alert type="error" showIcon message={error} />}
      </Form>
    </Modal>
  );
}

function EntityDetailPanel({
  selection,
  refreshToken,
  onEdit,
  onChanged,
}: {
  selection: EntitySelection;
  refreshToken: number;
  onEdit: (detail: M0WikiEntityDetail) => void;
  onChanged: (entity: M0WikiEntitySnapshot) => void;
}) {
  const [detail, setDetail] = useState<M0WikiEntityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getM0WikiEntity(selection.entityType, selection.businessKey, selection.versionId)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((exc: unknown) => {
        if (active) setError(exc instanceof Error ? exc.message : String(exc));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshToken, selection]);

  const remove = async () => {
    if (!detail?.entity.version_row_id || !deleteReason.trim()) return;
    setDeleting(true);
    setError('');
    try {
      const result = await deleteM0WikiEntity({
        entityType: selection.entityType,
        businessKey: selection.businessKey,
        versionId: String(detail.entity.version_id ?? ''),
        expectedVersionRowId: detail.entity.version_row_id,
        reason: deleteReason,
      });
      message.success('数据已停用并保留历史记录');
      setDeleteOpen(false);
      setDeleteReason('');
      onChanged(result.entity);
    } catch (exc: unknown) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <Spin />;
  if (error && !detail) return <Alert type="error" showIcon message={`数据加载失败：${error}`} />;
  if (!detail) return <Empty description="未找到该数据" />;
  const entity = detail.entity;
  const status = String(entity.status ?? '');
  const lineFields = Object.keys(detail.lines[0] ?? {}).slice(0, 8);

  return (
    <>
      <Card
        size="small"
        title={`${ENTITY_LABELS[selection.entityType]} · ${entity.business_key ?? selection.businessKey}`}
        extra={
          <Space>
            <Button icon={<EditOutlined />} onClick={() => onEdit(detail)}>编辑</Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={DELETED_STATUSES.has(status)}
              onClick={() => setDeleteOpen(true)}
            >
              删除
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {error && <Alert type="error" showIcon message={error} />}
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
            <Descriptions.Item label="类型">{ENTITY_LABELS[selection.entityType]}</Descriptions.Item>
            <Descriptions.Item label="业务编码">{entity.business_key ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="修订号">{entity.version_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="名称">{entity.label ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag>{status || '-'}</Tag></Descriptions.Item>
            <Descriptions.Item label="审核人">{entity.reviewed_by ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="记录时间">{entity.recorded_from ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="来源数">{detail.summary.sources ?? 0}</Descriptions.Item>
            <Descriptions.Item label="关系数">{detail.summary.relations ?? 0}</Descriptions.Item>
          </Descriptions>
          {detail.lines.length > 0 && (
            <Table
              size="small"
              rowKey={recordKey}
              dataSource={detail.lines}
              pagination={{ pageSize: 10 }}
              columns={lineFields.map((field) => ({ title: field, dataIndex: field, key: field }))}
            />
          )}
          <Tabs
            items={[
              {
                key: 'payload',
                label: '业务数据',
                children: <pre style={{ margin: 0, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(entity.attributes ?? {}, null, 2)}</pre>,
              },
              {
                key: 'history',
                label: `历史（${detail.history.length}）`,
                children: (
                  <Table
                    size="small"
                    rowKey={recordKey}
                    dataSource={detail.history}
                    pagination={false}
                    columns={[
                      { title: '修订号', dataIndex: 'version_id', key: 'version_id' },
                      { title: '状态', dataIndex: 'status', key: 'status' },
                      { title: '记录自', dataIndex: 'recorded_from', key: 'recorded_from' },
                      { title: '记录至', dataIndex: 'recorded_to', key: 'recorded_to' },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Space>
      </Card>
      <Modal
        title="删除 Wiki 数据"
        open={deleteOpen}
        okText="删除"
        okButtonProps={{ danger: true, disabled: !deleteReason.trim() }}
        cancelText="取消"
        confirmLoading={deleting}
        onOk={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      >
        <Input.TextArea
          aria-label="删除原因"
          placeholder="删除原因"
          value={deleteReason}
          onChange={(event) => setDeleteReason(event.target.value)}
          autoSize={{ minRows: 3, maxRows: 5 }}
        />
      </Modal>
    </>
  );
}

export function M0WikiPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<M0SearchResultItem[]>([]);
  const [materialInput, setMaterialInput] = useState('');
  const [equipmentInput, setEquipmentInput] = useState('');
  const [selection, setSelection] = useState<EntitySelection | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [editorDetail, setEditorDetail] = useState<M0WikiEntityDetail | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const searchSequence = useRef(0);

  const selectSearchResult = useCallback((item: M0SearchResultItem) => {
    const entityType = String(item.entity_type ?? '').toLowerCase();
    const businessKey = String(item.business_key ?? '').trim();
    if (!businessKey || !isWikiEntityType(entityType)) return;
    setSelection({ entityType, businessKey });
    if (entityType === 'material') {
      setMaterialInput(businessKey);
    } else if (entityType === 'equipment') {
      setEquipmentInput(businessKey);
    }
  }, []);

  const runSearch = useCallback((value: string) => {
    const requestId = ++searchSequence.current;
    const keyword = value.trim();
    setSearchError('');
    setResults([]);
    setSelection(null);
    setHasSearched(false);
    if (!keyword) {
      setSearching(false);
      return;
    }
    setSearching(true);
    searchM0Wiki(keyword, 12)
      .then((items) => {
        if (requestId !== searchSequence.current) return;
        setResults(items);
        setHasSearched(true);
        const first = items.find((item) => isWikiEntityType(String(item.entity_type ?? '').toLowerCase()));
        if (first) {
          selectSearchResult(first);
        } else {
          setSelection(null);
        }
      })
      .catch((exc: unknown) => {
        if (requestId !== searchSequence.current) return;
        setResults([]);
        setSelection(null);
        setHasSearched(true);
        setSearchError(exc instanceof Error ? exc.message : String(exc));
      })
      .finally(() => {
        if (requestId === searchSequence.current) setSearching(false);
      });
  }, [selectSearchResult]);

  const runMaterialLookup = useCallback((value: string) => {
    const code = value.trim();
    if (!code) return;
    searchSequence.current += 1;
    setSearching(false);
    setSearchError('');
    setResults([]);
    setHasSearched(false);
    setMaterialInput(code);
    setSelection({ entityType: 'material', businessKey: code });
  }, []);

  const runEquipmentLookup = useCallback((value: string) => {
    const code = value.trim();
    if (!code) return;
    searchSequence.current += 1;
    setSearching(false);
    setSearchError('');
    setResults([]);
    setHasSearched(false);
    setEquipmentInput(code);
    setSelection({ entityType: 'equipment', businessKey: code });
  }, []);

  const entityChanged = useCallback((entity: M0WikiEntitySnapshot) => {
    const entityType = String(entity.entity_type ?? '');
    const businessKey = String(entity.business_key ?? '');
    if (isWikiEntityType(entityType) && businessKey) {
      setSelection({ entityType, businessKey, versionId: String(entity.version_id ?? '') || undefined });
    }
    setRefreshToken((value) => value + 1);
    setEditorMode(null);
    setEditorDetail(null);
  }, []);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card size="small">
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space.Compact style={{ width: '100%' }}>
            <Input.Search
              placeholder="按编码、名称或语义搜索规范库（如 V-H301W / HDMI 线材）"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                searchSequence.current += 1;
                setSearching(false);
                setSearchError('');
                setResults([]);
                setSelection(null);
                setHasSearched(false);
              }}
              onSearch={runSearch}
              enterButton
              loading={searching}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditorMode('create')}>
              新增
            </Button>
          </Space.Compact>
          {searchError && <Alert type="error" showIcon message={searchError} />}
          {results.length > 0 && (
            <Space wrap>
              {results.map((item) => {
                const checked = selection?.entityType === String(item.entity_type ?? '').toLowerCase()
                  && selection?.businessKey === item.business_key;
                return (
                  <Button
                    key={item.entity_id ?? item.search_document_id ?? recordKey(item)}
                    type={checked ? 'primary' : 'text'}
                    size="small"
                    aria-pressed={checked}
                    onClick={() => selectSearchResult(item)}
                  >
                    {item.entity_type ? `[${item.entity_type}] ` : ''}
                    {item.business_key ?? item.label ?? item.title}
                  </Button>
                );
              })}
            </Space>
          )}
        </Space>
      </Card>
      {selection ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <EntityDetailPanel
            selection={selection}
            refreshToken={refreshToken}
            onEdit={(detail) => {
              setEditorDetail(detail);
              setEditorMode('edit');
            }}
            onChanged={entityChanged}
          />
          {selection.entityType === 'product' && (
            <ProductWikiView key={`${selection.businessKey}:${refreshToken}`} productCode={selection.businessKey} />
          )}
          {selection.entityType === 'material' && (
            <MaterialWikiView key={`${selection.businessKey}:${refreshToken}`} materialCode={selection.businessKey} />
          )}
          {selection.entityType === 'equipment' && (
            <EquipmentWikiView key={`${selection.businessKey}:${refreshToken}`} equipmentCode={selection.businessKey} />
          )}
        </Space>
      ) : (
        <Empty
          description={hasSearched && !searching && !searchError
            ? '未找到匹配的 Wiki 数据'
            : '搜索并选择一条 Wiki 数据'}
        />
      )}
      <Card size="small" title="物料 / 设备反查">
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Input.Search
            style={{ maxWidth: 360 }}
            placeholder="物料编码"
            value={materialInput}
            onChange={(event) => {
              const value = event.target.value;
              setMaterialInput(value);
              if (!value.trim() && selection?.entityType === 'material') setSelection(null);
            }}
            onSearch={runMaterialLookup}
            enterButton="查询"
            allowClear
          />
          <Input.Search
            style={{ maxWidth: 360 }}
            placeholder="设备编码"
            value={equipmentInput}
            onChange={(event) => {
              const value = event.target.value;
              setEquipmentInput(value);
              if (!value.trim() && selection?.entityType === 'equipment') setSelection(null);
            }}
            onSearch={runEquipmentLookup}
            enterButton="查询"
            allowClear
          />
        </Space>
      </Card>
      <EntityEditorModal
        mode={editorMode ?? 'create'}
        open={editorMode !== null}
        detail={editorDetail}
        onClose={() => {
          setEditorMode(null);
          setEditorDetail(null);
        }}
        onSaved={entityChanged}
      />
    </Space>
  );
}

export default M0WikiPage;
