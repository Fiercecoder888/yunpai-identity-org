import {
  ApartmentOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EyeOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Empty,
  Modal,
  Skeleton,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  getM0BatchDetail,
  m0BatchDocumentFileUrl,
  m0BatchDocumentPreviewUrl,
  retryM0Extraction,
  type M0Document,
} from '../../services/m0Api';
import {
  extractForDomain,
  extractPollIntervalMs,
  normalizeExtractStatus,
  parseExtractContent,
  summarizeExtraction,
  type BomRowExtract,
  type DrawingExtract,
  type GenericField,
  type OrderExtract,
  type PoExtract,
  type SopRowExtract,
  type SpecRowExtract,
} from './extractSchema';
import { AgentEvidencePanel, hasM0AgentData } from './AgentEvidencePanel';

export const DOC_DOMAIN_LABELS: Record<string, string> = {
  order: '客户订单',
  po: '采购订单',
  purchase_request: '采购申请',
  purchase_receipt: '采购入库',
  bom: '物料清单',
  sop: '作业指导书',
  drawing: '工程图',
  id_drawing: 'ID 图',
  inventory: '库存',
  equipment: '设备一览表',
  tooling: '模具/模号表',
  specification: '规格书',
  archive: '混合归档',
  unclassified: '未分类',
};

const EXTRACT_STATUS_TAGS: Record<string, { label: string; color: string }> = {
  empty: { label: '待提取', color: 'default' },
  queued: { label: '排队中', color: 'blue' },
  extracting: { label: '提取中', color: 'processing' },
  done: { label: '已完成', color: 'green' },
  failed: { label: '提取失败', color: 'red' },
  needs_review: { label: '待确认', color: 'gold' },
  skipped: { label: '已跳过', color: 'default' },
  unknown: { label: '未知状态', color: 'default' },
};

const extractStatusTag = (raw: string | undefined) => {
  const status = normalizeExtractStatus(raw);
  const meta = EXTRACT_STATUS_TAGS[status.kind] ?? { label: '未知状态', color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
};

const PREVIEWABLE_FORMATS = new Set([
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
]);

const TABLE_PREVIEWABLE_FORMATS = new Set([
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'csv',
]);

const isBlank = (value: string | undefined) => !value || value.trim().length === 0;

const OrderView = ({ data }: { data: OrderExtract }) => {
  const fields: Array<[string, string | undefined]> = [
    ['订单号', data.orderNo],
    ['产品', data.product],
    ['数量', data.qty],
    ['交期', data.dueDate],
    ['客户', data.customer],
  ];
  if (fields.every(([, value]) => isBlank(value))) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到订单字段" />;
  }
  return (
    <Descriptions size="small" column={2} bordered>
      {fields.map(([label, value]) => (
        <Descriptions.Item key={label} label={label} span={label === '订单号' ? 2 : 1}>
          {value || '-'}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
};

const BomView = ({ data }: { data: { model?: string; rows: BomRowExtract[] } }) => (
  <div>
    <Descriptions size="small" column={2} style={{ marginBottom: 8 }}>
      <Descriptions.Item label="成品型号">{data.model || '-'}</Descriptions.Item>
    </Descriptions>
    {data.rows.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到 BOM 物料行" />
    ) : (
      <Table
        rowKey={(row, index) => `${row.materialCode}-${index}`}
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={data.rows}
        columns={[
          { title: '物料编码', dataIndex: 'materialCode', key: 'materialCode' },
          { title: '物料名称', dataIndex: 'materialName', key: 'materialName' },
          { title: '用量', dataIndex: 'qty', key: 'qty', width: 100 },
          { title: '损耗率', dataIndex: 'lossRate', key: 'lossRate', width: 100 },
        ]}
      />
    )}
  </div>
);

const DrawingView = ({ data }: { data: DrawingExtract }) => {
  const fields: Array<[string, string | undefined]> = [
    ['图纸编号', data.drawingNo],
    ['标题', data.title],
    ['图纸类型', data.drawingType],
  ];
  if (fields.every(([, value]) => isBlank(value))) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到图纸字段" />;
  }
  return (
    <Descriptions size="small" column={1} bordered>
      {fields.map(([label, value]) => (
        <Descriptions.Item key={label} label={label}>
          {value || '-'}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
};

const SopView = ({ rows }: { rows: SopRowExtract[] }) =>
  rows.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到 SOP 工序" />
  ) : (
    <Table
      rowKey={(row, index) => `${row.process}-${row.step}-${index}`}
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      dataSource={rows}
      columns={[
        { title: '工序', dataIndex: 'process', key: 'process', width: 120 },
        { title: '工步', dataIndex: 'step', key: 'step', width: 120 },
        { title: '作业内容', dataIndex: 'content', key: 'content' },
        { title: '参数', dataIndex: 'params', key: 'params' },
      ]}
    />
  );

const SpecificationView = ({ rows }: { rows: SpecRowExtract[] }) =>
  rows.length === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到规格参数" />
  ) : (
    <Table
      rowKey={(row, index) => `${row.name}-${index}`}
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      dataSource={rows}
      columns={[
        { title: '参数名称', dataIndex: 'name', key: 'name' },
        { title: '参数值', dataIndex: 'value', key: 'value' },
        { title: '单位', dataIndex: 'unit', key: 'unit', width: 100 },
      ]}
    />
  );

const PoView = ({ data }: { data: PoExtract }) => {
  const header: Array<[string, string | undefined]> = [
    ['单号', data.poNo],
    ['供应商', data.supplier],
  ];
  return (
    <div>
      <Descriptions size="small" column={2} style={{ marginBottom: 8 }}>
        {header.map(([label, value]) => (
          <Descriptions.Item key={label} label={label}>
            {value || '-'}
          </Descriptions.Item>
        ))}
      </Descriptions>
      {data.rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到物料行" />
      ) : (
        <Table
          rowKey={(row, index) => `${row.material}-${index}`}
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={data.rows}
          columns={[
            { title: '物料', dataIndex: 'material', key: 'material' },
            { title: '数量', dataIndex: 'qty', key: 'qty', width: 100 },
            { title: '交期', dataIndex: 'dueDate', key: 'dueDate', width: 140 },
          ]}
        />
      )}
    </div>
  );
};

const GenericView = ({ fields }: { fields: GenericField[] }) => {
  const visible = fields.slice(0, 60);
  return (
    <Descriptions size="small" column={2} bordered>
      {visible.map((field) => (
        <Descriptions.Item key={field.key} label={field.key}>
          {field.value}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
};

const DocumentBody = ({ document }: { document: M0Document }) => {
  const result = extractForDomain(document.domain, document.extract_content);
  switch (result.kind) {
    case 'order':
      return <OrderView data={result.data} />;
    case 'bom':
      return <BomView data={result.data} />;
    case 'drawing':
      return <DrawingView data={result.data} />;
    case 'sop':
      return <SopView rows={result.data} />;
    case 'specification':
      return <SpecificationView rows={result.data} />;
    case 'po':
      return <PoView data={result.data} />;
    case 'generic':
      return <GenericView fields={result.data} />;
    case 'text':
      return (
        <Typography.Paragraph
          style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 0, maxHeight: 240, overflow: 'auto' }}
        >
          {result.data}
        </Typography.Paragraph>
      );
    default:
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未识别到内容" />;
  }
};

const PREVIEW_TIMEOUT_MS = 15_000;

function PreviewFrame({ src, title, downloadHref, downloadName }: {
  src: string;
  title: string;
  downloadHref: string;
  downloadName: string;
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setStatus('loading');
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === 'loading' ? 'error' : current));
    }, PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [src, reloadKey]);

  if (status === 'error') {
    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Alert
          type="error"
          showIcon
          message="原始文件预览加载失败"
          description="可重试加载，或下载原始文件查看。"
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => setReloadKey((key) => key + 1)}>
              重试
            </Button>
          }
        />
        <a href={downloadHref} target="_blank" rel="noreferrer" download={downloadName}>
          下载原始文件
        </a>
      </Space>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {status === 'loading' ? (
        <Skeleton active paragraph={{ rows: 6 }} style={{ position: 'absolute', inset: 0 }} />
      ) : null}
      <iframe
        key={reloadKey}
        title={title}
        src={src}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
        style={{
          width: '100%',
          height: 'min(50vh, 480px)',
          border: '1px solid #d9d9d9',
          borderRadius: 4,
          background: '#fff',
        }}
      />
    </div>
  );
}

function DocumentPreviewContent({ document }: { document: M0Document }) {
  const fileUrl = m0BatchDocumentFileUrl(document.batch_id, document.id);
  const parsed = parseExtractContent(document.extract_content);
  const recognizedType =
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof (parsed as Record<string, unknown>).document_type === 'string'
      ? String((parsed as Record<string, unknown>).document_type)
      : undefined;
  const domainLabel = DOC_DOMAIN_LABELS[document.domain] ?? document.domain;
  const format = document.detected_format || document.declared_ext || 'unknown';
  const fmt = format.toLowerCase();
  const previewable = PREVIEWABLE_FORMATS.has(fmt);
  const tablePreviewable = TABLE_PREVIEWABLE_FORMATS.has(fmt);
  const previewSrc = tablePreviewable
    ? m0BatchDocumentPreviewUrl(document.batch_id, document.id)
    : fileUrl;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Space wrap style={{ marginBottom: 12, flex: 'none' }}>
        <Tag color="blue">{domainLabel}</Tag>
        {recognizedType ? <Tag color="geekblue">{recognizedType}</Tag> : null}
        {extractStatusTag(document.extract_status)}
        <Typography.Text type="secondary">{format.toUpperCase()}</Typography.Text>
      </Space>
      <div style={{ marginBottom: 12, overflow: 'auto', minHeight: 0 }}>
        <DocumentBody document={document} />
      </div>
      <Divider style={{ margin: '8px 0', flex: 'none' }} />
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, flex: 'none' }}>
        原始文件预览
      </Typography.Text>
      {previewable || tablePreviewable ? (
        <PreviewFrame
          src={previewSrc}
          title={`预览-${document.original_name}`}
          downloadHref={fileUrl}
          downloadName={document.original_name}
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message={`该格式（${format.toUpperCase()}）不支持浏览器内嵌预览`}
          description={
            <a href={fileUrl} target="_blank" rel="noreferrer" download={document.original_name}>
              下载原始文件查看
            </a>
          }
        />
      )}
    </div>
  );
}

export function ExtractResultPanel({
  batchId,
  title = '提取结果',
}: {
  batchId: string | null;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const [previewDocument, setPreviewDocument] = useState<M0Document | null>(null);
  const [agentDocument, setAgentDocument] = useState<M0Document | null>(null);

  const detailQuery = useQuery({
    queryKey: ['m0', 'batch-detail', batchId],
    queryFn: () => getM0BatchDetail(batchId as string),
    enabled: batchId !== null,
    refetchInterval: (query) => {
      const docs = (query.state.data?.documents ?? []) as M0Document[];
      return extractPollIntervalMs(docs);
    },
  });

  const retryMutation = useMutation({
    mutationFn: retryM0Extraction,
    onSuccess: (data) => {
      void message.success(`已重新调度 ${data.retried} 个文档提取，结果将自动刷新`);
      void queryClient.invalidateQueries({ queryKey: ['m0'] });
    },
    onError: (error) => {
      void message.error(`重新提取失败：${error instanceof Error ? error.message : String(error)}`);
    },
  });

  if (!batchId) {
    return null;
  }

  if (detailQuery.isLoading && !detailQuery.data) {
    return (
      <Card size="small" title={title} style={{ marginTop: 12 }}>
        <Skeleton active paragraph={{ rows: 2 }} />
      </Card>
    );
  }

  const documents = (detailQuery.data?.documents ?? []) as M0Document[];
  const summary = summarizeExtraction(documents);

  const statusBar = (() => {
    if (summary.total === 0) {
      return (
        <Alert
          type="info"
          showIcon
          icon={<ClockCircleOutlined />}
          message="本批次暂无文档提取记录"
        />
      );
    }
    if (summary.kind === 'active') {
      return (
        <Alert
          type="info"
          showIcon
          icon={<Spin size="small" />}
          message={`提取中：${summary.active} 个文档，完成后自动刷新`}
          description={`已完成 ${summary.done} · 失败 ${summary.failed} · 跳过 ${summary.skipped}`}
        />
      );
    }
    if (summary.kind === 'failed') {
      return (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          message={`${summary.failed} 个文档提取失败`}
          description="可点击文档卡片上的“重新提取”或下方按钮重试"
          action={
            <Button
              danger
              size="small"
              icon={<ReloadOutlined />}
              loading={retryMutation.isPending}
              onClick={() => batchId && retryMutation.mutate(batchId)}
            >
              重新提取
            </Button>
          }
        />
      );
    }
    if (summary.kind === 'review') {
      return (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={`${summary.reviewing} 个文档提取结果待确认`}
        />
      );
    }
    return (
      <Alert
        type="success"
        showIcon
        icon={<CheckCircleOutlined />}
        message={`提取完成：${summary.done} 个文档`}
        description={summary.skipped > 0 ? `表格/归档类 ${summary.skipped} 个由结构化解析处理（跳过文本提取）` : undefined}
      />
    );
  })();

  return (
    <Card size="small" title={title} style={{ marginTop: 12 }} extra={detailQuery.isFetching ? <Spin size="small" /> : null}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {statusBar}
        {documents.map((document) => {
          const status = normalizeExtractStatus(document.extract_status);
          const domainLabel = DOC_DOMAIN_LABELS[document.domain] ?? document.domain;
          const contentKind = document.document_kind?.trim();
          return (
            <Card
              key={document.id}
              size="small"
              title={
                <span>
                  {document.original_name}
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    {contentKind || domainLabel}
                  </Tag>
                  {contentKind && contentKind !== domainLabel ? <Tag>{domainLabel} 适配器</Tag> : null}
                </span>
              }
              extra={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {extractStatusTag(document.extract_status)}
                  {hasM0AgentData(document) ? (
                    <Button
                      size="small"
                      type="link"
                      icon={<ApartmentOutlined />}
                      aria-label={`Agent轨迹-${document.original_name}`}
                      onClick={() => setAgentDocument(document)}
                    >
                      Agent 轨迹
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    type="link"
                    icon={<EyeOutlined />}
                    aria-label={`预览-${document.original_name}`}
                    onClick={() => setPreviewDocument(document)}
                  >
                    预览
                  </Button>
                  {status.kind === 'failed' ? (
                    <Button
                      size="small"
                      danger
                      icon={<ReloadOutlined />}
                      loading={retryMutation.isPending}
                      onClick={() => retryMutation.mutate(document.batch_id)}
                    >
                      重新提取
                    </Button>
                  ) : null}
                </span>
              }
            >
              {status.kind === 'failed' ? (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={`提取失败${status.reason ? `：${status.reason}` : ''}`}
                  description="请点击“重新提取”重试，或转人工处理"
                />
              ) : null}
              {status.kind === 'needs_review' ? (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="提取结果待人工确认"
                />
              ) : null}
              {status.kind === 'skipped' ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  表格/归档类文件由结构化解析处理，无独立文本提取结果
                </Typography.Text>
              ) : (
                <DocumentBody document={document} />
              )}
            </Card>
          );
        })}
      </div>
      <Modal
        open={previewDocument !== null}
        title={previewDocument?.original_name ?? '预览'}
        onCancel={() => setPreviewDocument(null)}
        footer={null}
        width="min(94vw, 1080px)"
        destroyOnHidden
        styles={{ body: { maxHeight: 'min(70vh, 640px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        {previewDocument ? <DocumentPreviewContent document={previewDocument} /> : null}
      </Modal>
      <Modal
        open={agentDocument !== null}
        title={agentDocument ? `${agentDocument.original_name} · Agent 证据轨迹` : 'Agent 证据轨迹'}
        onCancel={() => setAgentDocument(null)}
        footer={null}
        width="min(96vw, 1240px)"
        destroyOnHidden
      >
        {agentDocument ? <AgentEvidencePanel document={agentDocument} /> : null}
      </Modal>
    </Card>
  );
}
