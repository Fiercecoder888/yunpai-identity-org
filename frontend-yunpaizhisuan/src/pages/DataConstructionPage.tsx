import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  LoadingOutlined,
  RollbackOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Progress,
  Space,
  Table,
  Tabs,
  Tag,
  type TableProps,
  Typography,
  Upload,
  message,
  type UploadFile,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  commitM0Batch,
  listM0Batches,
  m0BatchFileCount,
  previewM0Batch,
  resolveM0Document,
  resolveM0Entity,
  resolveM0Mapping,
  rollbackM0Batch,
  type M0Batch,
  type M0Document,
} from '../services/m0Api';
import {
  describeM0UploadError,
  isM0UploadOverGatewayLimit,
  M0_LARGE_UPLOAD_MB,
  M0_SLOW_PROCESSING_SEC,
  m0ProcessingNote,
  m0UploadCompletedText,
  m0UploadOverLimitMessage,
  m0UploadTotalMb,
  uploadM0FilesWithProgress,
} from '../services/uploadWithProgress';
import { ExtractResultPanel } from '../features/m0/ExtractResultPanel';
import { DocumentBindingPanel } from '../features/m0/DocumentBindingPanel';
import { DocumentPreview } from '../features/m0/DocumentPreview';
import { MasterTableCrud } from '../features/m0/MasterTableCrud';
import {
  M0AdjudicationModal,
  type M0AdjudicationDecision,
  type M0AdjudicationValues,
} from '../features/m0/M0AdjudicationModal';
import { MASTER_TABLE_CONFIGS } from '../features/m0/masterTableConfigs';
import {
  docTypeLabel,
  listM0Documents,
  type M0DocumentWithBindings,
  type M0MasterDocument,
} from '../services/m0DocumentsApi';

const DOMAIN_LABELS: Record<string, string> = {
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
  warehouse: '仓库/库位',
  asset: '资产库',
  yield: '良率/损耗率',
  specification: '规格书',
  archive: '混合归档',
  unclassified: '未分类',
};

const BATCH_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  received: { label: '已接收', color: 'default' },
  ingesting: { label: '摄入中', color: 'processing' },
  classifying: { label: '分类中', color: 'processing' },
  parsing: { label: '解析中', color: 'processing' },
  awaiting_review: { label: '待人工确认', color: 'gold' },
  ready: { label: '可入库', color: 'blue' },
  committed: { label: '已入库', color: 'green' },
  rolled_back: { label: '已回滚', color: 'orange' },
  failed: { label: '失败', color: 'red' },
};

const PROCESSING_STATUSES = new Set(['received', 'ingesting', 'classifying', 'parsing']);

const STAGE_LABELS: Record<string, string> = {
  received: '已上传，等待后台处理',
  security_and_format_check: '安全检查与格式探测',
  m1_submitted: '已提交 M1',
  m1_extracting: 'M1 文档解析',
  m1_poll_retry: 'M1 结果查询重试',
  schema_and_entity_build: 'Schema 与实体构建',
  awaiting_review: '等待人工审核',
};

const stageLabel = (stage?: string) => {
  if (!stage) return '-';
  if (stage.startsWith('content_understanding:')) return 'Agent 内容理解';
  return STAGE_LABELS[stage] ?? stage;
};

const ROW_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ok: { label: '正常', color: 'green' },
  incomplete: { label: '缺字段', color: 'orange' },
  ambiguous: { label: '歧义', color: 'gold' },
  failed: { label: '失败', color: 'red' },
};

const batchStatusTag = (status: string) => {
  const meta = BATCH_STATUS_LABELS[status] ?? { label: status, color: 'default' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
};

export function DataConstructionPage() {
  const queryClient = useQueryClient();
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([]);
  const [bindingDoc, setBindingDoc] = useState<M0MasterDocument | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [adjudication, setAdjudication] = useState<M0AdjudicationDecision | null>(null);
  // 本次上传的文件总大小（MiB），用于批次处理期间判断是否属于大文件、决定是否附加大文件提示。
  const uploadedTotalMbRef = useRef(0);
  // 上一次观察到的批次状态，用于“处理中 → 完成/失败”切换时给出 toast。
  const prevBatchStatusRef = useRef<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ['m0', 'batches'],
    queryFn: () => listM0Batches(50),
    refetchInterval: (query) => {
      const batches = query.state.data?.batches ?? [];
      return batches.some((batch) => PROCESSING_STATUSES.has(batch.status)) ? 2_000 : false;
    },
  });
  const previewQuery = useQuery({
    queryKey: ['m0', 'preview', selectedBatchId],
    queryFn: () => previewM0Batch(selectedBatchId as string),
    enabled: selectedBatchId !== null,
    refetchInterval: (query) => {
      const batch = query.state.data?.batch;
      return batch && PROCESSING_STATUSES.has(batch.status) ? 2_000 : false;
    },
  });
  const masterDocumentsQuery = useQuery({
    queryKey: ['m0', 'documents'],
    queryFn: () => listM0Documents({ limit: 200 }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['m0'] });
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      uploadedTotalMbRef.current = m0UploadTotalMb(files);
      setUploadProgress(0);
      // 走 XHR 进度包装，点击后用户能看到「上传中」状态与实时百分比。
      const batch = await uploadM0FilesWithProgress(files, { onProgress: setUploadProgress });
      return batch;
    },
    onSuccess: (batch) => {
      setUploadProgress(null);
      // 上传响应返回时批次可能已处理完成（小文件）或仍在处理（大文件），按实际状态提示。
      if (batch.status === 'awaiting_review' || batch.status === 'ready') {
        void message.success(`已上传，批次 ${batch.id} 处理完成${batch.status === 'awaiting_review' ? '，待审核' : '，可提交入库'}`);
      } else if (batch.status === 'failed') {
        void message.error(`批次 ${batch.id} 处理失败，请检查文件后重试`);
      } else {
        void message.success(`批次 ${batch.id} 已创建，文件正在后台处理`);
      }
      setUploadFileList([]);
      setSelectedBatchId(batch.id);
      invalidate();
    },
    onError: (error) => {
      setUploadProgress(null);
      void message.error(describeM0UploadError(error));
    },
  });
  const handleUpload = (files: File[]) => {
    if (isM0UploadOverGatewayLimit(files)) {
      void message.warning(m0UploadOverLimitMessage(files));
      return;
    }
    uploadMutation.mutate(files);
  };

  const commitMutation = useMutation({
    mutationFn: (batchId: string) => commitM0Batch(batchId),
    onSuccess: (data) => {
      void message.success(`已入库：${JSON.stringify(data.master_counts ?? {})}`);
      invalidate();
    },
    onError: (error: Error) => void message.error(`入库被拒：${error.message}`),
  });

  const rollbackMutation = useMutation({
    mutationFn: (batchId: string) => rollbackM0Batch(batchId),
    onSuccess: () => {
      void message.success('已回滚');
      invalidate();
    },
    onError: (error: Error) => void message.error(`回滚失败：${error.message}`),
  });

  const entityResolve = useMutation({
    mutationFn: ({ batchId, entityId, action, reason }: { batchId: string; entityId: number; action: 'approve' | 'reject'; reason: string }) =>
      resolveM0Entity(batchId, entityId, action, reason),
    onSuccess: () => {
      void message.success('已裁决');
      setAdjudication(null);
      invalidate();
    },
    onError: (error: Error) => void message.error(`实体裁决失败：${error.message}`),
  });

  const documentResolve = useMutation({
    mutationFn: ({ batchId, documentId, action }: { batchId: string; documentId: number; action: 'approve' | 'reject' }) =>
      resolveM0Document(batchId, documentId, action),
    onSuccess: () => {
      void message.success('文档候选已裁决');
      invalidate();
    },
    onError: (error: Error) => void message.error(`文档裁决失败：${error.message}`),
  });

  const mappingResolve = useMutation({
    mutationFn: ({ batchId, mappingId, action, targetRef, reason }: { batchId: string; mappingId: number; action: 'approve' | 'reject'; targetRef: string; reason: string }) =>
      resolveM0Mapping(batchId, mappingId, action, targetRef, reason),
    onSuccess: () => {
      void message.success('已裁决');
      setAdjudication(null);
      invalidate();
    },
    onError: (error: Error) => void message.error(`映射裁决失败：${error.message}`),
  });

  const submitAdjudication = ({ targetRef, reason }: M0AdjudicationValues) => {
    if (!selectedBatchId || !adjudication) return;
    if (adjudication.kind === 'entity') {
      entityResolve.mutate({
        batchId: selectedBatchId,
        entityId: adjudication.recordId,
        action: adjudication.action,
        reason,
      });
      return;
    }
    mappingResolve.mutate({
      batchId: selectedBatchId,
      mappingId: adjudication.recordId,
      action: adjudication.action,
      targetRef,
      reason,
    });
  };

  const preview = previewQuery.data;
  const batches = batchesQuery.data?.batches ?? [];
  const selected = preview?.batch;
  const masterDocuments = masterDocumentsQuery.data?.documents ?? [];

  // 处理中（received/ingesting/classifying/parsing）→ 完成/失败切换时给出明确反馈。
  useEffect(() => {
    if (!selected) {
      prevBatchStatusRef.current = null;
      return;
    }
    const prevStatus = prevBatchStatusRef.current;
    prevBatchStatusRef.current = selected.status;
    const wasProcessing =
      !!prevStatus && PROCESSING_STATUSES.has(prevStatus);
    if (wasProcessing && (selected.status === 'awaiting_review' || selected.status === 'ready')) {
      void message.success(`已上传，批次 ${selected.id} 处理完成${selected.status === 'awaiting_review' ? '，待审核' : '，可提交入库'}`);
    } else if (wasProcessing && selected.status === 'failed') {
      void message.error(`批次 ${selected.id} 处理失败，请检查文件或重试`);
    }
  }, [selected]);

  // 批次处理期间持续提示：已用时 + 大文件（或等待较久）说明。
  const selectedProcessing =
    !!selected && PROCESSING_STATUSES.has(selected.status);
  const selectedElapsedSec =
    selectedProcessing && selected && Number.isFinite(Date.parse(selected.created_at))
      ? Math.max(0, Math.round((Date.now() - Date.parse(selected.created_at)) / 1000))
      : 0;
  const selectedNotes: string[] = [];
  if (selectedElapsedSec > 0) {
    selectedNotes.push(`已处理 ${selectedElapsedSec} 秒`);
  }
  const selectedNote = m0ProcessingNote({
    large: uploadedTotalMbRef.current >= M0_LARGE_UPLOAD_MB,
    slow: selectedElapsedSec >= M0_SLOW_PROCESSING_SEC,
  });
  if (selectedNote) {
    selectedNotes.push(selectedNote);
  }

  const masterDocumentColumns: TableProps<M0DocumentWithBindings>['columns'] = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 70 },
    { title: '文档', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '内容类型',
      dataIndex: 'domain',
      key: 'domain',
      render: (value: string) => <Tag>{DOMAIN_LABELS[value] ?? value}</Tag>,
    },
    {
      title: '文档类型',
      dataIndex: 'doc_type',
      key: 'doc_type',
      render: (value: string) => <Tag color="blue">{docTypeLabel(value)}</Tag>,
    },
    {
      title: '绑定数',
      key: 'binding_count',
      width: 90,
      render: (_: unknown, doc: M0DocumentWithBindings) => doc.bindings.length,
    },
    { title: '入库时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作',
      key: 'action',
      width: 170,
      render: (_: unknown, doc: M0DocumentWithBindings) => (
        <Space>
          <Button size="small" type="primary" ghost onClick={() => setBindingDoc(doc)}>
            绑定
          </Button>
          <DocumentPreview docId={doc.id} title={doc.title} compact />
        </Space>
      ),
    },
  ];

  const uploadProps = {
    multiple: true,
    fileList: uploadFileList,
    // 多选收集，点“开始导入”一次性建一个混合批次
    beforeUpload: () => false,
    onChange: (info: { fileList: UploadFile[] }) => {
      setUploadFileList(info.fileList);
    },
  };

  const pendingFiles = uploadFileList
    .map((item) => item.originFileObj)
    .filter((file): file is NonNullable<typeof file> => file !== undefined)
    .map((file) => file as File);

  const documentColumns: TableProps<M0Document>['columns'] = [
    { title: '文件', dataIndex: 'original_name', key: 'original_name', width: 220, ellipsis: true },
    {
      title: '识别格式',
      dataIndex: 'detected_format',
      key: 'detected_format',
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: '内容类型',
      dataIndex: 'domain',
      key: 'domain',
      render: (value: string) => <Tag color="blue">{DOMAIN_LABELS[value] ?? value}</Tag>,
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      render: (value: number) => `${Math.round(value * 100)}%`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: string) => <Tag color={value === 'ok' ? 'green' : value === 'needs_review' ? 'gold' : 'red'}>{value}</Tag>,
    },
    { title: '解析行数', dataIndex: 'row_count', key: 'row_count', width: 90 },
    { title: '说明', dataIndex: 'message', key: 'message', width: 240, ellipsis: true },
    {
      title: '审核',
      key: 'review',
      width: 150,
      render: (_: unknown, document: M0Document) =>
        document.status === 'needs_review' && selectedBatchId ? (
          <Space size={4}>
            <Button
              size="small"
              type="primary"
              loading={documentResolve.isPending}
              onClick={() => documentResolve.mutate({ batchId: selectedBatchId, documentId: document.id, action: 'approve' })}
            >
              批准
            </Button>
            <Button
              size="small"
              danger
              loading={documentResolve.isPending}
              onClick={() => documentResolve.mutate({ batchId: selectedBatchId, documentId: document.id, action: 'reject' })}
            >
              拒绝
            </Button>
          </Space>
        ) : null,
    },
  ];

  const rowColumns = [
    { title: '类型', dataIndex: 'domain', key: 'domain', width: 90, render: (value: string) => DOMAIN_LABELS[value] ?? value },
    { title: 'Sheet', dataIndex: 'sheet_name', key: 'sheet_name', width: 120, ellipsis: true },
    { title: '行号', dataIndex: 'row_index', key: 'row_index', width: 70 },
    {
      title: '字段',
      dataIndex: 'fields',
      key: 'fields',
      width: 280,
      render: (fields: Record<string, unknown>) => (
        <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: JSON.stringify(fields, null, 2) }}>
          {JSON.stringify(fields)}
        </Typography.Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: string) => {
        const meta = ROW_STATUS_LABELS[value] ?? { label: value, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: '问题', dataIndex: 'issues', key: 'issues', width: 200, ellipsis: true, render: (issues: string[]) => issues.join('；') },
  ];

  const entityColumns = [
    { title: '编码', dataIndex: 'code', key: 'code', width: 130, ellipsis: true },
    { title: '名称', dataIndex: 'name', key: 'name', width: 150, ellipsis: true },
    { title: '单位', dataIndex: 'uom', key: 'uom', width: 90 },
    { title: '规格', dataIndex: 'spec', key: 'spec', width: 140, ellipsis: true },
    {
      // 别名可能包含几十个逗号分隔项，Tag 逐个渲染会撑爆卡片；改为省略号截断，
      // 悬浮（原生 title）显示完整列表。
      title: '别名',
      dataIndex: 'aliases',
      key: 'aliases',
      width: 220,
      ellipsis: true,
      render: (aliases: string[]) => aliases.join('、'),
    },
    {
      title: '冲突',
      dataIndex: 'identity_conflict',
      key: 'identity_conflict',
      width: 100,
      render: (value: string) => (value ? <Tag color="red">{value === 'name_conflict' ? '同名不同名' : '单位冲突'}</Tag> : <Tag>无</Tag>),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_: unknown, entity: { id: number; status: string; identity_conflict: string }) =>
        entity.status === 'pending' && entity.identity_conflict ? (
          <Space>
            <Button
              size="small"
              type="primary"
              onClick={() => setAdjudication({ kind: 'entity', recordId: entity.id, action: 'approve' })}
            >
              批准
            </Button>
            <Button
              size="small"
              danger
              onClick={() => setAdjudication({ kind: 'entity', recordId: entity.id, action: 'reject' })}
            >
              拒绝
            </Button>
          </Space>
        ) : (
          <Tag>{entity.status === 'approved' ? '已批准' : entity.status === 'rejected' ? '已拒绝' : '无冲突'}</Tag>
        ),
    },
  ];

  const mappingColumns = [
    { title: '来源行', dataIndex: 'source_ref', key: 'source_ref', width: 150, ellipsis: true },
    { title: '目标行', dataIndex: 'target_ref', key: 'target_ref', width: 150, ellipsis: true },
    { title: '证据', dataIndex: 'evidence', key: 'evidence', width: 260, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: string) => <Tag color={value === 'approved' ? 'green' : value === 'rejected' ? 'red' : 'gold'}>{value}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_: unknown, mapping: { id: number; status: string; target_ref: string }) =>
        mapping.status === 'pending' ? (
          <Space>
            <Button size="small" type="primary" onClick={() => setAdjudication({ kind: 'mapping', recordId: mapping.id, action: 'approve', currentTargetRef: mapping.target_ref })}>
              批准
            </Button>
            <Button size="small" danger onClick={() => setAdjudication({ kind: 'mapping', recordId: mapping.id, action: 'reject', currentTargetRef: mapping.target_ref })}>
              拒绝
            </Button>
          </Space>
        ) : null,
    },
  ];

  const quarantineColumns = [
    { title: '文件', dataIndex: 'original_name', key: 'original_name' },
    { title: '原因', dataIndex: 'reason', key: 'reason' },
    { title: '详情', dataIndex: 'detail', key: 'detail' },
  ];

  return (
    <div className="data-construction-page" style={{ padding: 16, minWidth: 0 }}>
      <Typography.Title level={4}>M0 数据建设</Typography.Title>
      <Card title="导入文件" style={{ marginBottom: 16 }}>
        <Upload.Dragger {...uploadProps} showUploadList={false}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽多文件到此处（支持全部已知格式，压缩包自动解压）</p>
          <p className="ant-upload-hint">订单 / 采购 / BOM / SOP / 工程图 / ID 图 / 库存 / 设备 / 模具 / 规格书，可混合上传</p>
        </Upload.Dragger>
        <Space style={{ marginTop: 12 }} wrap>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={uploadMutation.isPending}
            disabled={pendingFiles.length === 0}
            onClick={() => handleUpload(pendingFiles)}
          >
            开始导入（{pendingFiles.length} 个文件，一次建一个批次）
          </Button>
          {pendingFiles.length > 0 ? (
            <Typography.Text type="secondary">
              {pendingFiles.map((file) => file.name).join('、')}
            </Typography.Text>
          ) : null}
        </Space>
        {uploadMutation.isPending ? (
          <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 8 }}>
            <Typography.Text type="secondary" aria-live="polite">
              <LoadingOutlined />{' '}
              {uploadProgress === 100
                ? // 100% 只代表客户端传输完成，服务端仍可能正在解压/识别（大文件可达分钟级）。
                  m0UploadCompletedText(uploadedTotalMbRef.current >= M0_LARGE_UPLOAD_MB)
                : `正在上传 ${pendingFiles.length} 个文件（已上传 ${uploadProgress ?? 0}%）…`}
            </Typography.Text>
            <Progress
              percent={uploadProgress ?? 0}
              size="small"
              status={uploadProgress === 100 ? 'normal' : 'active'}
              aria-label={`m0 上传进度 ${uploadProgress ?? 0}%`}
            />
          </Space>
        ) : null}
      </Card>

      <Card title="导入批次" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          dataSource={batches}
          loading={batchesQuery.isLoading}
          rowClassName={(record) => (record.id === selectedBatchId ? 'ant-table-row-selected' : '')}
          onRow={(record: M0Batch) => ({
            onClick: () => setSelectedBatchId(record.id),
          })}
          pagination={false}
          columns={[
            { title: '批次', dataIndex: 'id', key: 'id' },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => batchStatusTag(value),
            },
            {
              title: '处理阶段',
              dataIndex: 'processing_stage',
              key: 'processing_stage',
              render: (value: string | undefined) => stageLabel(value),
            },
            {
              title: '已用时',
              key: 'elapsed',
              render: (_: unknown, record: M0Batch) => {
                const start = Date.parse(record.created_at);
                const end = PROCESSING_STATUSES.has(record.status) ? Date.now() : Date.parse(record.updated_at);
                return Number.isFinite(start) && Number.isFinite(end)
                  ? `${Math.max(0, Math.round((end - start) / 1000))} 秒`
                  : '-';
              },
            },
            { title: '文件数', key: 'doc_count', render: (_: unknown, record: M0Batch) => m0BatchFileCount(record) },
            { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
          ]}
        />
      </Card>

      <Card title="主数据" style={{ marginBottom: 16 }}>
        <Tabs
          items={MASTER_TABLE_CONFIGS.map((config) => ({
            key: config.table,
            label: config.label,
            children: <MasterTableCrud config={config} />,
          }))}
        />
      </Card>
      <Card
        title="已入库文档（绑定与预览）"
        style={{ marginBottom: 16 }}
        extra={
          <Button icon={<CheckCircleOutlined />} onClick={() => invalidate()}>
            刷新
          </Button>
        }
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={masterDocuments}
          loading={masterDocumentsQuery.isLoading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: '暂无已入库文档。上传并提交入库后，可在此绑定物料/产品/订单并预览。' }}
          columns={masterDocumentColumns}
        />
      </Card>

      {selected && preview ? (
        <Card
          title={`批次 ${selected.id}`}
          extra={
            <Space>
              {selected.status === 'ready' || selected.status === 'awaiting_review' ? (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={commitMutation.isPending}
                  disabled={selected.status === 'awaiting_review'}
                  onClick={() => commitMutation.mutate(selected.id)}
                >
                  提交入库
                </Button>
              ) : null}
              {selected.status === 'committed' ? (
                <Button danger icon={<RollbackOutlined />} loading={rollbackMutation.isPending} onClick={() => rollbackMutation.mutate(selected.id)}>
                  回滚
                </Button>
              ) : null}
              <Button icon={<CheckCircleOutlined />} onClick={() => invalidate()}>
                刷新
              </Button>
            </Space>
          }
        >
          {selectedProcessing ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`后台处理中：${stageLabel(selected.processing_stage)}${selectedNotes.length > 0 ? `（${selectedNotes.join('，')}）` : ''}`}
            />
          ) : null}
          {selected.status === 'awaiting_review' ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="有待人工确认项：低置信文档、实体冲突或未匹配项需先裁决，之后才能提交入库。"
            />
          ) : null}
          <ExtractResultPanel batchId={selectedBatchId} />
          <Descriptions size="small" column={4} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="状态">{batchStatusTag(selected.status)}</Descriptions.Item>
            <Descriptions.Item label="文档数">{preview.documents.length}</Descriptions.Item>
            <Descriptions.Item label="数据行">{preview.rows.length}</Descriptions.Item>
            <Descriptions.Item label="隔离文件">{preview.quarantine.length}</Descriptions.Item>
          </Descriptions>
          <Tabs
            items={[
              {
                key: 'documents',
                label: '文档',
                children: <Table rowKey="id" size="small" dataSource={preview.documents} columns={documentColumns} scroll={{ x: 1080 }} pagination={{ pageSize: 10 }} />,
              },
              {
                key: 'rows',
                label: `数据行 (${preview.rows.length})`,
                children: <Table rowKey="id" size="small" dataSource={preview.rows} columns={rowColumns} scroll={{ x: 850 }} pagination={{ pageSize: 10 }} />,
              },
              {
                key: 'entities',
                label: `实体冲突 (${preview.entities.filter((e) => e.identity_conflict).length})`,
                children: <Table rowKey="id" size="small" dataSource={preview.entities} columns={entityColumns} scroll={{ x: 960 }} pagination={{ pageSize: 10 }} />,
              },
              {
                key: 'mappings',
                label: `匹配 (${preview.mappings.length})`,
                children: <Table rowKey="id" size="small" dataSource={preview.mappings} columns={mappingColumns} scroll={{ x: 780 }} pagination={{ pageSize: 10 }} />,
              },
              {
                key: 'quarantine',
                label: `隔离区 (${preview.quarantine.length})`,
                children: <Table rowKey="id" size="small" dataSource={preview.quarantine} columns={quarantineColumns} pagination={false} />,
              },
              {
                key: 'ledger',
                label: `台账 (${preview.ledger.length})`,
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={preview.ledger}
                    pagination={{ pageSize: 10 }}
                    columns={[
                      { title: '目标表', dataIndex: 'target_table', key: 'target_table' },
                      { title: '目标行', dataIndex: 'target_row_id', key: 'target_row_id' },
                      { title: '动作', dataIndex: 'action', key: 'action' },
                      { title: '回滚', dataIndex: 'rollback_at', key: 'rollback_at', render: (value: string) => (value ? <Tag color="orange">已回滚</Tag> : <Tag color="green">生效</Tag>) },
                      { title: '时间', dataIndex: 'created_at', key: 'created_at' },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>
      ) : null}
      <DocumentBindingPanel doc={bindingDoc} onClose={() => setBindingDoc(null)} />
      <M0AdjudicationModal
        decision={adjudication}
        confirmLoading={entityResolve.isPending || mappingResolve.isPending}
        onCancel={() => setAdjudication(null)}
        onSubmit={submitAdjudication}
      />
    </div>
  );
}
