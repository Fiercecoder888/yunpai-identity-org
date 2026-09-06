import { Alert, Card, Col, Row, Space, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { PermissionGate } from '../components/PermissionGate';
import { M1ReviewTable } from '../features/m1/M1ReviewTable';
import { M1TaskList } from '../features/m1/M1TaskList';
import { M1UploadPanel } from '../features/m1/M1UploadPanel';
import { RecognitionResultView } from '../features/m1/RecognitionResultView';
import { ReviewConfirmationForm } from '../features/m1/ReviewConfirmationForm';
import { validateM1UploadFile } from '../features/m1/constants';
import {
  confirmReviewItem,
  createArchiveRecognition,
  getM1ReviewItems,
  getM1Tasks,
  type M1ArchiveRecognitionResponse,
  type M1BatchRecognitionResponse,
} from '../services/m1Api';
import { createM1BatchRecognitionWithProgress } from '../services/uploadWithProgress';
import { AUDIT_LOG_SYNC_FAILURE_MESSAGE, createAuditLog, writeAuditLogSafely } from '../services/auditLogger';
import type { M1ReviewSubmit } from '../schemas/m1';
import type { M1ReviewItem } from '../types/api';

export { validateM1UploadFile };

const defaultRecognitionMetadata = {
  source: 'manual',
  documentType: 'drawing',
  priority: 'high',
  operatorNote: 'M0 文档解析审核入口提交',
} as const;

export function M1ReviewPage() {
  return (
    <PermissionGate permission="m1:read" auditModule="M1" targetId="m1-review">
      <M1ReviewContent />
    </PermissionGate>
  );
}

function M1ReviewContent() {
  const queryClient = useQueryClient();
  const [selectedReviewItem, setSelectedReviewItem] = useState<M1ReviewItem | null>(null);
  const [batchResult, setBatchResult] = useState<M1BatchRecognitionResponse | null>(null);
  const [batchParentId, setBatchParentId] = useState<string | undefined>(undefined);
  const [archiveResult, setArchiveResult] = useState<M1ArchiveRecognitionResponse | null>(null);
  const [batchProgress, setBatchProgress] = useState<number | undefined>(undefined);
  const [auditWarning, setAuditWarning] = useState(false);
  const batchAbortRef = useRef<AbortController | null>(null);

  const taskQuery = useQuery({ queryKey: ['m1-tasks'], queryFn: getM1Tasks, refetchInterval: 10_000 });
  const reviewQuery = useQuery({ queryKey: ['m1-review-items'], queryFn: getM1ReviewItems });

  const cancelBatchUpload = () => {
    batchAbortRef.current?.abort();
  };

  const batchMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const controller = new AbortController();
      batchAbortRef.current = controller;
      try {
        setBatchProgress(0);
        return await createM1BatchRecognitionWithProgress(files, defaultRecognitionMetadata, {
          signal: controller.signal,
          onProgress: setBatchProgress,
        });
      } finally {
        batchAbortRef.current = null;
      }
    },
    onSuccess: async (response) => {
      setBatchProgress(undefined);
      setBatchResult(response);
      setBatchParentId(response.parentId);
      await queryClient.invalidateQueries({ queryKey: ['m1-tasks'] });
      const auditResult = await writeAuditLogSafely(
        createAuditLog({
          actor: 'm1-reviewer',
          action: 'M1_BATCH_RECOGNITION_CREATED',
          module: 'M1',
          targetId: response.taskIds.join(','),
          result: 'success',
          detail: `批量识别任务已创建 ${response.taskIds.length} 个，失败 ${response.failedFiles.length} 个`,
        }),
      );
      setAuditWarning(!auditResult.ok);
      void message.success('批量识别任务已创建');
      if (!auditResult.ok) {
        void message.warning(AUDIT_LOG_SYNC_FAILURE_MESSAGE);
      }
    },
    onError: (error) => {
      setBatchProgress(undefined);
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      void message.error('批量识别任务创建失败');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (file: File) => createArchiveRecognition(file, { ...defaultRecognitionMetadata, source: 'archive' }),
    onSuccess: async (response) => {
      setArchiveResult(response);
      await queryClient.invalidateQueries({ queryKey: ['m1-tasks'] });
      const auditResult = await writeAuditLogSafely(
        createAuditLog({
          actor: 'm1-reviewer',
          action: 'M1_ARCHIVE_RECOGNITION_CREATED',
          module: 'M1',
          targetId: response.taskId,
          result: 'success',
          detail: `ZIP 导入 ${response.extractedFiles} 个文件，失败 ${response.failedFiles.length} 个`,
        }),
      );
      setAuditWarning(!auditResult.ok);
      void message.success('ZIP 导入任务已创建');
      if (!auditResult.ok) {
        void message.warning(AUDIT_LOG_SYNC_FAILURE_MESSAGE);
      }
    },
    onError: () => {
      void message.error('ZIP 导入失败');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: ({ item, payload, approve }: { item: M1ReviewItem; payload: M1ReviewSubmit; approve: boolean }) =>
      confirmReviewItem(item, payload, approve),
    onSuccess: async (_response, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['m1-review-items'] });
      await queryClient.invalidateQueries({ queryKey: ['m1-tasks'] });
      const auditResult = await writeAuditLogSafely(
        createAuditLog({
          actor: 'm1-reviewer',
          action: variables.approve ? 'M1_REVIEW_CONFIRMED' : 'M1_REVIEW_REJECTED',
          module: 'M1',
          targetId: variables.item.taskId,
          result: variables.approve ? 'success' : 'blocked',
          detail: `修正值：${variables.payload.correctedValue}；说明：${variables.payload.reason}`,
        }),
      );
      setAuditWarning(!auditResult.ok);
      setSelectedReviewItem(null);
      void message.success(variables.approve ? '任务审核已通过' : '任务审核已驳回');
      if (!auditResult.ok) {
        void message.warning(AUDIT_LOG_SYNC_FAILURE_MESSAGE);
      }
    },
    onError: () => {
      void message.error('审核提交失败');
    },
  });

  return (
    <Space direction="vertical" size={16} className="page-stack">
      {auditWarning ? <Alert type="warning" showIcon message={AUDIT_LOG_SYNC_FAILURE_MESSAGE} description="主操作已完成，日志稍后补偿同步。" /> : null}
      <Card title="M0 文档解析审核">
        <M1UploadPanel
          batchSubmitting={batchMutation.isPending}
          archiveSubmitting={archiveMutation.isPending}
          batchResult={batchResult}
          archiveResult={archiveResult}
          onBatchSubmit={(files) => batchMutation.mutate(files)}
          onArchiveSubmit={(file) => archiveMutation.mutate(file)}
          batchProgress={batchProgress}
          onCancelBatch={cancelBatchUpload}
          batchParentId={batchParentId}
        />
      </Card>

      <Card title="识别任务">
        <M1TaskList loading={taskQuery.isLoading} error={taskQuery.error} tasks={taskQuery.data} />
      </Card>

      <Row gutter={[16, 16]}>
        <Col span={14}>
          <Card title="待审核字段">
            <Alert
              className="inline-alert"
              type="info"
              showIcon
              message="M1 按整份任务提交审核"
              description="可选择一个低置信字段填写修正值；通过或驳回后，该任务会离开审核队列，其他字段将按当前识别值一并确认。"
            />
            <M1ReviewTable
              loading={reviewQuery.isLoading}
              error={reviewQuery.error}
              items={reviewQuery.data}
              selectedId={selectedReviewItem?.id}
              onSelect={setSelectedReviewItem}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="识别结果查看">
            <RecognitionResultView item={selectedReviewItem} />
          </Card>
          <Card title="人工确认表单" className="stacked-card">
            <ReviewConfirmationForm
              item={selectedReviewItem}
              submitting={confirmMutation.isPending}
              onSubmit={(payload, approve) => {
                if (selectedReviewItem) {
                  confirmMutation.mutate({ item: selectedReviewItem, payload, approve });
                }
              }}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
