import {
  CameraOutlined,
  CloudUploadOutlined,
  InboxOutlined,
  LoadingOutlined,
  RollbackOutlined,
  ScanOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadFileList } from '../upload/UploadFileList';
import { validateFile } from '../upload/validateFile';
import {
  commitM0Batch,
  previewM0Batch,
  resolveM0Entity,
  resolveM0Document,
  resolveM0Mapping,
  rollbackM0Batch,
  type M0Entity,
  type M0Mapping,
} from '../../services/m0Api';
import { resumeBusinessFlow } from '../../services/businessFlowRunApi';
import { useBusinessRunStore } from '../business-flow/useBusinessRunStore';
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
} from '../../services/uploadWithProgress';
import { useChatStore } from '../../store/useChatStore';
import { useUploadSessionStore } from '../../store/useUploadSessionStore';
import { ExtractResultPanel } from './ExtractResultPanel';
import { M0BurstCaptureModal } from './M0BurstCaptureModal';
import { M0MasterDataModal } from './M0MasterDataModal';
import {
  M0AdjudicationModal,
  type M0AdjudicationDecision,
  type M0AdjudicationValues,
} from './M0AdjudicationModal';
import styles from './M0ChatPanel.module.css';

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
  equipment: '设备',
  tooling: '模具/模号',
  specification: '规格书',
  archive: '压缩包',
  unclassified: '未分类',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
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

const recoverLatestM0BatchId = () => {
  const sessions = Object.values(useUploadSessionStore.getState().sessions)
    .filter((session) => session.kind === 'm0' && session.status === 'processing' && session.taskId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return sessions[0]?.taskId ?? null;
};

export function M0ChatPanel({ initialFiles }: { initialFiles?: File[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [batchId, setBatchId] = useState<string | null>(recoverLatestM0BatchId);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [burstOpen, setBurstOpen] = useState(false);
  const [masterDataOpen, setMasterDataOpen] = useState(false);
  const [adjudication, setAdjudication] = useState<M0AdjudicationDecision | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  // 拍照上传入口使用的原生 file input（accept="image/*" + capture="environment"，
  // 移动端调起系统后置相机；桌面端退化为普通文件选择器）。
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // 本次上传的文件总大小（MiB），用于在批次处理期间判断是否属于大文件、
  // 决定是否附加大文件提示（上传完成后 pendingFiles 会被清空，故单独记录）。
  const uploadedTotalMbRef = useRef(0);
  // 上一次观察到的批次状态，用于在“处理中 → 完成/失败”切换时给出 toast。
  const prevBatchStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialFiles?.length) return;
    setPendingFiles((prev) => {
      const existing = new Set(prev.map((file) => file.name));
      return [...prev, ...initialFiles.filter((file) => !existing.has(file.name))];
    });
  }, [initialFiles]);

  const previewQuery = useQuery({
    queryKey: ['m0-chat', batchId],
    queryFn: () => previewM0Batch(batchId as string),
    enabled: batchId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.batch.status;
      return status && ['received', 'ingesting', 'classifying', 'parsing'].includes(status) ? 2_000 : false;
    },
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['m0-chat'] });
  };
  const refreshPreview = () => {
    if (batchId) {
      void queryClient.refetchQueries({ queryKey: ['m0-chat', batchId] });
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const controller = new AbortController();
      uploadAbortRef.current = controller;
      uploadedTotalMbRef.current = m0UploadTotalMb(files);
      try {
        setUploadProgress(0);
        const batch = await uploadM0FilesWithProgress(files, {
          signal: controller.signal,
          onProgress: setUploadProgress,
        });
        return { batch, filenames: files.map((file) => file.name).join('、') };
      } finally {
        uploadAbortRef.current = null;
      }
    },
    onSuccess: ({ batch, filenames }) => {
      setUploadProgress(null);
      setBatchId(batch.id);
      setPendingFiles([]);
      // 上传响应返回时批次可能已处理完成（小文件）或仍在处理（大文件），
      // 按实际状态给出对应的完成/进行中提示。
      if (batch.status === 'awaiting_review' || batch.status === 'ready') {
        void message.success(`已上传，批次 ${batch.id} 处理完成${batch.status === 'awaiting_review' ? '，待审核' : '，可提交入库'}`);
      } else if (batch.status === 'failed') {
        void message.error(`批次 ${batch.id} 处理失败，请检查文件后重试`);
      } else {
        void message.success(`m0 批次 ${batch.id} 已创建，文件正在后台处理`);
      }
      useUploadSessionStore.getState().upsert(`m0-${batch.id}`, {
        filename: filenames,
        kind: 'm0',
        taskId: batch.id,
        status: 'processing',
        progress: 100,
      });
      useChatStore.getState().appendUploadAttachment({
        id: `m0-${batch.id}`,
        name: filenames,
        kind: 'm0',
        taskId: batch.id,
      });
      invalidate();
    },
    onError: (error) => {
      setUploadProgress(null);
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
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
  // 拍照上传（方案 B）：手机系统相机拍摄的照片选择后立即走现有 handleUpload，
  // 一个请求一个批次，m0 后端 wait=false 异步识别 → 随拍随识别。
  const handleCameraFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // 清空 value，保证用户可再次选择同一批照片。
    event.target.value = '';
    if (files.length === 0) return;
    const invalid = files.find((file) => validateFile(file, 'm0'));
    if (invalid) {
      void message.error(validateFile(invalid, 'm0') ?? '文件不符合要求');
      return;
    }
    void message.info(`已选择 ${files.length} 张照片，正在上传识别…`);
    handleUpload(files);
  };
  // 基础资料入库后，若存在被人工门阻断的业务流 run（human_input_required /
  // blocked / data_incomplete），自动 resume 同 TaskID 继续订单——人工补录的
  // 历史 BOM/SOP/物料/工艺资料经 M0 入库后即可被 M2/M3/M5 复用。
  const maybeResumeBlockedRun = async () => {
    const store = useBusinessRunStore.getState();
    const runId = store.runId;
    if (!runId) return;
    const progress = store as unknown as { phase?: string };
    if (!['human_input_required', 'blocked', 'data_incomplete'].includes(progress.phase ?? '')) {
      return;
    }
    const applyProgress = useBusinessRunStore.getState().update;
    try {
      void message.info('基础资料已入库，自动继续当前订单流程…');
      await resumeBusinessFlow(runId, {
        orderId: store.meta?.orderId,
        onProgress: (next) => applyProgress(next),
      });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause);
      void message.warning(`自动继续失败（可手动点击「继续运行」）：${text}`);
    }
  };
  const commitMutation = useMutation({
    mutationFn: (id: string) => commitM0Batch(id),
    onSuccess: (data) => {
      void message.success(`已入库：${JSON.stringify((data.master_counts ?? {}))}`);
      invalidate();
      refreshPreview();
      void maybeResumeBlockedRun();
    },
    onError: (error: Error) => void message.error(`入库被拒：${error.message}`),
  });
  const rollbackMutation = useMutation({
    mutationFn: (id: string) => rollbackM0Batch(id),
    onSuccess: () => {
      void message.success('已回滚');
      invalidate();
      refreshPreview();
    },
    onError: (error: Error) => void message.error(`回滚失败：${error.message}`),
  });
  const entityResolve = useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: 'approve' | 'reject'; reason: string }) =>
      resolveM0Entity(batchId as string, id, action, reason),
    onSuccess: () => {
      void message.success('已裁决');
      setAdjudication(null);
      invalidate();
      refreshPreview();
    },
    onError: (error: Error) => void message.error(`裁决失败：${error.message}`),
  });
  const mappingResolve = useMutation({
    mutationFn: ({ id, action, targetRef, reason }: { id: number; action: 'approve' | 'reject'; targetRef: string; reason: string }) =>
      resolveM0Mapping(batchId as string, id, action, targetRef, reason),
    onSuccess: () => {
      void message.success('已裁决');
      setAdjudication(null);
      invalidate();
      refreshPreview();
    },
    onError: (error: Error) => void message.error(`裁决失败：${error.message}`),
  });
  const documentResolve = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'reject' }) =>
      resolveM0Document(batchId as string, id, action),
    onSuccess: () => {
      void message.success('文档已确认');
      invalidate();
      refreshPreview();
    },
    onError: (error: Error) => void message.error(`文档确认失败：${error.message}`),
  });

  const submitAdjudication = ({ targetRef, reason }: M0AdjudicationValues) => {
    if (!adjudication) return;
    if (adjudication.kind === 'entity') {
      entityResolve.mutate({ id: adjudication.recordId, action: adjudication.action, reason });
      return;
    }
    mappingResolve.mutate({
      id: adjudication.recordId,
      action: adjudication.action,
      targetRef,
      reason,
    });
  };

  const preview = previewQuery.data;
  const batch = preview?.batch;
  const documents = preview?.documents ?? [];
  const entities = preview?.entities ?? [];
  const mappings = preview?.mappings ?? [];
  const quarantine = preview?.quarantine ?? [];
  const conflicts = entities.filter((e) => e.identity_conflict && e.status === 'pending');
  const needsReviewDocs = documents.filter((d) => d.status === 'needs_review');
  const pendingMappings = mappings.filter((m) => m.status === 'pending');
  const totalRows = preview?.rows.length ?? 0;

  const statusMeta = batch ? (STATUS_LABELS[batch.status] ?? { label: batch.status, color: 'default' }) : null;

  const isProcessing = !!batch && ['received', 'ingesting', 'classifying', 'parsing'].includes(batch.status);
  // 轮询每 2 秒刷新一次数据，这里用 created_at 计算已处理时长，给用户持续的进行中提示。
  const processingElapsedSec =
    isProcessing && batch && Number.isFinite(Date.parse(batch.created_at))
      ? Math.max(0, Math.round((Date.now() - Date.parse(batch.created_at)) / 1000))
      : 0;
  const processingNotes: string[] = [];
  if (processingElapsedSec > 0) {
    processingNotes.push(`已处理 ${processingElapsedSec} 秒`);
  }
  // 仅当文件较大或等待较久时附加大文件提示，中小文件保持轻量。
  const processingNote = m0ProcessingNote({
    large: uploadedTotalMbRef.current >= M0_LARGE_UPLOAD_MB,
    slow: processingElapsedSec >= M0_SLOW_PROCESSING_SEC,
  });
  if (processingNote) {
    processingNotes.push(processingNote);
  }

  useEffect(() => {
    if (!batch) {
      prevBatchStatusRef.current = null;
      return;
    }
    // 处理中（received/ingesting/classifying/parsing）→ 完成/失败切换时给出明确反馈。
    const prevStatus = prevBatchStatusRef.current;
    prevBatchStatusRef.current = batch.status;
    const wasProcessing =
      !!prevStatus && ['received', 'ingesting', 'classifying', 'parsing'].includes(prevStatus);
    if (wasProcessing && (batch.status === 'awaiting_review' || batch.status === 'ready')) {
      void message.success(`已上传，批次 ${batch.id} 处理完成${batch.status === 'awaiting_review' ? '，待审核' : '，可提交入库'}`);
    } else if (wasProcessing && batch.status === 'failed') {
      void message.error(`批次 ${batch.id} 处理失败，请检查文件或重试`);
    }
    // 同步上传会话状态（持久化，页面刷新后可恢复）。
    if (['received', 'ingesting', 'classifying', 'parsing'].includes(batch.status)) return;
    const existing = useUploadSessionStore.getState().sessions[`m0-${batch.id}`];
    if (!existing) return;
    useUploadSessionStore.getState().upsert(`m0-${batch.id}`, {
      filename: existing.filename,
      kind: 'm0',
      taskId: batch.id,
      status: batch.status === 'failed' ? 'failed' : 'success',
      progress: 100,
    });
  }, [batch]);

  const entityColumns = [
    { title: '编码', dataIndex: 'code', key: 'code', width: 130, ellipsis: true },
    { title: '名称', dataIndex: 'name', key: 'name', width: 150, ellipsis: true },
    {
      // 别名可能包含几十个逗号分隔项，整列渲染会撑爆面板；用省略号截断，
      // 悬浮显示完整列表（antd 列的 ellipsis 会带原生 title 提示）。
      title: '别名',
      dataIndex: 'aliases',
      key: 'aliases',
      width: 220,
      ellipsis: true,
      render: (v: string[]) => v.join('、'),
    },
    { title: '冲突', dataIndex: 'identity_conflict', key: 'conflict', width: 100, render: (v: string) => (v ? <Tag color="red">{v === 'name_conflict' ? '同名不同名' : '单位冲突'}</Tag> : '-') },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_: unknown, e: M0Entity) =>
        e.status === 'pending' && e.identity_conflict ? (
          <Space>
            <Button size="small" type="primary" onClick={() => setAdjudication({ kind: 'entity', recordId: e.id, action: 'approve' })}>批准</Button>
            <Button size="small" danger onClick={() => setAdjudication({ kind: 'entity', recordId: e.id, action: 'reject' })}>拒绝</Button>
          </Space>
        ) : (
          <Tag>{e.status === 'approved' ? '已批准' : e.status === 'rejected' ? '已拒绝' : '-'}</Tag>
        ),
    },
  ];
  const mappingColumns = [
    { title: '来源行', dataIndex: 'source_ref', key: 'source_ref', width: 150, ellipsis: true },
    { title: '目标行', dataIndex: 'target_ref', key: 'target_ref', width: 150, ellipsis: true },
    { title: '证据', dataIndex: 'evidence', key: 'evidence', width: 260, ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_: unknown, m: M0Mapping) =>
        m.status === 'pending' ? (
          <Space>
            <Button size="small" type="primary" onClick={() => setAdjudication({ kind: 'mapping', recordId: m.id, action: 'approve', currentTargetRef: m.target_ref })}>批准</Button>
            <Button size="small" danger onClick={() => setAdjudication({ kind: 'mapping', recordId: m.id, action: 'reject', currentTargetRef: m.target_ref })}>拒绝</Button>
          </Space>
        ) : (
          <Tag>{m.status === 'approved' ? '已批准' : m.status === 'rejected' ? '已拒绝' : m.status}</Tag>
        ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <span>M0 数据导入</span>
          <Tag color="blue">基础数据库建设</Tag>
        </Space>
      }
      extra={
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setMasterDataOpen(true)}>
            管理主数据
          </Button>
          <Button type="link" size="small" onClick={() => navigate('/modules/data-construction')}>
            完整工作台
          </Button>
        </Space>
      }
      style={{ marginBottom: 12 }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div className={styles.uploadRow}>
          <Upload.Dragger
            multiple
            showUploadList={false}
            className={styles.dragger}
            beforeUpload={(file) => {
              const validationError = validateFile(file, 'm0');
              if (validationError) {
                void message.error(validationError);
                return Upload.LIST_IGNORE;
              }
              return false;
            }}
            onChange={(info) => {
              setPendingFiles(
                info.fileList.flatMap((item) => (item.originFileObj ? [item.originFileObj as File] : [])),
              );
            }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">多选文件：订单 / 采购 / BOM / SOP / 图纸 / ID图 / 库存 / 设备 / 模具 / 规格书（压缩包自动解压）</p>
          </Upload.Dragger>
          <div className={styles.cameraTools}>
            {/* 拍照上传（方案 B）：移动端 capture="environment" 调起后置相机，
                支持 multiple 连续拍摄多张一次回传；照片选择后立即上传识别。 */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              data-testid="m0-camera-input"
              className={styles.cameraInput}
              onChange={handleCameraFiles}
            />
            <Button
              type="primary"
              ghost
              icon={<CameraOutlined />}
              className={styles.cameraButton}
              disabled={uploadMutation.isPending}
              onClick={() => cameraInputRef.current?.click()}
            >
              拍照上传
            </Button>
            <Button
              icon={<ScanOutlined />}
              className={styles.burstButton}
              onClick={() => setBurstOpen(true)}
            >
              连拍扫描
            </Button>
            <span className={styles.cameraHint}>
              手机摄像头扫描单据，随拍随识别；连拍模式可逐张拍摄、逐张上传
            </span>
          </div>
        </div>
        <Space>
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={uploadMutation.isPending}
            disabled={pendingFiles.length === 0}
            onClick={() => handleUpload(pendingFiles)}
          >
            开始导入（{pendingFiles.length} 个文件）
          </Button>
          <UploadFileList
            data-testid="m0-upload-file-list"
            items={pendingFiles.map((file) => ({
              key: file.name,
              name: file.name,
              size: file.size,
              error: validateFile(file, 'm0') ?? undefined,
            }))}
            onRemove={(name) => setPendingFiles((prev) => prev.filter((file) => file.name !== name))}
          />
        </Space>

        {uploadMutation.isPending ? (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Typography.Text type="secondary" aria-live="polite">
              <LoadingOutlined />{' '}
              {uploadProgress === 100
                ? // 100% 只代表客户端传输完成，服务端仍可能正在解压/识别（大文件可达分钟级）。
                  m0UploadCompletedText(uploadedTotalMbRef.current >= M0_LARGE_UPLOAD_MB)
                : `正在上传 ${pendingFiles.length} 个文件，请稍候…`}
            </Typography.Text>
            <Progress
              percent={uploadProgress ?? 0}
              size="small"
              status={uploadProgress === 100 ? 'normal' : 'active'}
              aria-label={`m0 上传进度 ${uploadProgress ?? 0}%`}
            />
            <Button danger size="small" icon={<StopOutlined />} onClick={() => uploadAbortRef.current?.abort()}>
              取消上传
            </Button>
          </Space>
        ) : null}

        {batch && statusMeta ? (
          <>
            <Alert
              type={
                batch.status === 'awaiting_review'
                  ? 'warning'
                  : batch.status === 'committed'
                    ? 'success'
                    : batch.status === 'rolled_back'
                      ? 'info'
                      : 'info'
              }
              showIcon
              message={`批次 ${batch.id} · ${statusMeta.label}`}
              description={
                ['received', 'ingesting', 'classifying', 'parsing'].includes(batch.status)
                  ? `后台处理中：${batch.processing_stage?.startsWith('content_understanding:') ? 'Agent 内容理解' : batch.processing_stage || statusMeta.label}${processingNotes.length > 0 ? `（${processingNotes.join('，')}）` : ''}`
                  : batch.status === 'awaiting_review'
                  ? `${conflicts.length} 个实体冲突、${pendingMappings.length} 个未匹配项待裁决后提交`
                  : `文档 ${documents.length} · 数据行 ${totalRows} · 隔离 ${quarantine.length}`
              }
            />
            <Descriptions size="small" column={4}>
              <Descriptions.Item label="文档">{documents.length}</Descriptions.Item>
              <Descriptions.Item label="数据行">{totalRows}</Descriptions.Item>
              <Descriptions.Item label="实体">{entities.length}</Descriptions.Item>
              <Descriptions.Item label="隔离">{quarantine.length}</Descriptions.Item>
            </Descriptions>
            {documents.length > 0 ? (
              <Typography.Paragraph style={{ fontSize: 12, marginBottom: 0 }}>
                内容类型：{Array.from(new Set(documents.map((d) => DOMAIN_LABELS[d.domain] ?? d.domain))).join(' / ')}
              </Typography.Paragraph>
            ) : null}

            {conflicts.length > 0 ? (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 730 }}
                title={() => <Typography.Text strong>实体冲突（{conflicts.length}）</Typography.Text>}
                dataSource={conflicts}
                columns={entityColumns}
              />
            ) : null}
            {pendingMappings.length > 0 ? (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 690 }}
                title={() => <Typography.Text strong>匹配待确认（{pendingMappings.length}）</Typography.Text>}
                dataSource={pendingMappings}
                columns={mappingColumns}
              />
            ) : null}
            {quarantine.length > 0 ? (
              <Alert
                type="warning"
                showIcon
                message={`${quarantine.length} 个文件进入隔离区（伪扩展名/坏包/未分类），不影响其余文件`}
              />
            ) : null}

            {needsReviewDocs.length > 0 ? (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 560 }}
                title={() => <Typography.Text strong>待人工确认文档（{needsReviewDocs.length}）</Typography.Text>}
                dataSource={needsReviewDocs}
                columns={[
                  { title: '文件名', dataIndex: 'original_name', ellipsis: true, render: (v: string) => v.split('/').pop() },
                  { title: '说明', dataIndex: 'message', width: 160, ellipsis: true },
                  {
                    title: '操作',
                    key: 'action',
                    width: 140,
                    render: (_, doc: { id: number }) => (
                      <Space size={4}>
                        <Button
                          size="small"
                          type="primary"
                          loading={documentResolve.isPending}
                          onClick={() => documentResolve.mutate({ id: doc.id, action: 'approve' })}
                        >
                          批准
                        </Button>
                        <Button
                          size="small"
                          danger
                          loading={documentResolve.isPending}
                          onClick={() => documentResolve.mutate({ id: doc.id, action: 'reject' })}
                        >
                          拒绝
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            ) : null}

            <Space wrap>
              {batch.status === 'ready' || batch.status === 'awaiting_review' ? (
                <>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    loading={commitMutation.isPending}
                    disabled={conflicts.length > 0 || pendingMappings.length > 0 || needsReviewDocs.length > 0}
                    onClick={() => commitMutation.mutate(batch.id)}
                  >
                    提交入库
                  </Button>
                  {conflicts.length > 0 || pendingMappings.length > 0 || needsReviewDocs.length > 0 ? (
                    <Typography.Text type="warning" style={{ fontSize: 12 }}>
                      请先处理{conflicts.length ? ` ${conflicts.length} 个实体冲突、` : ''}
                      {pendingMappings.length ? ` ${pendingMappings.length} 个未匹配项、` : ''}
                      {needsReviewDocs.length ? ` ${needsReviewDocs.length} 个待人工确认文档` : ''}
                      后再入库
                    </Typography.Text>
                  ) : null}
                </>
              ) : null}
              {batch.status === 'committed' ? (
                <Button danger icon={<RollbackOutlined />} loading={rollbackMutation.isPending} onClick={() => rollbackMutation.mutate(batch.id)}>
                  回滚
                </Button>
              ) : null}
            </Space>
          </>
        ) : null}
        <ExtractResultPanel batchId={batchId} title="提取结果（上传后自动刷新）" />
      </Space>
      <M0BurstCaptureModal
        open={burstOpen}
        onClose={() => setBurstOpen(false)}
      />
      <M0MasterDataModal
        open={masterDataOpen}
        onClose={() => setMasterDataOpen(false)}
      />
      <M0AdjudicationModal
        decision={adjudication}
        confirmLoading={entityResolve.isPending || mappingResolve.isPending}
        onCancel={() => setAdjudication(null)}
        onSubmit={submitAdjudication}
      />
    </Card>
  );
}
