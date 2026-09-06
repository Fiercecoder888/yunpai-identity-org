import { m1MetadataSchema, m1ReviewSubmitSchema, type M1Metadata, type M1ReviewSubmit } from '../schemas/m1';
import { withQuery } from './apiGateway';
import { requestBlob, requestJson } from './httpClient';
import type { M1RecognitionTask, M1ReviewItem } from '../types/api';

export type M1UploadTaskResponse = {
  taskId: string;
  trackingTaskId?: string;
};

export type M1FailedFile = {
  filename: string;
  reason: string;
};

export type M1BatchRecognitionResponse = {
  taskIds: string[];
  failedFiles: M1FailedFile[];
  trackingTaskId?: string;
  /** 后端返回的批量父任务 ID（可选）；用于 getM1Batch 续查批量任务进度。 */
  parentId?: string;
};

export type M1ArchiveRecognitionResponse = {
  taskId: string;
  extractedFiles: number;
  failedFiles: M1FailedFile[];
  trackingTaskId?: string;
};

export type M1RequestOptions = {
  trackingTaskId?: string;
  signal?: AbortSignal;
};

export const createM1TrackingTaskId = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `task_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const m1RequestOptions = (options: M1RequestOptions = {}) => ({
  headers: { 'X-Yunpai-Task-ID': options.trackingTaskId?.trim() || createM1TrackingTaskId() },
  signal: options.signal,
});

const trackingTaskIdFrom = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as { trackingTaskId?: unknown; tracking_task_id?: unknown };
  return typeof record.trackingTaskId === 'string'
    ? record.trackingTaskId
    : typeof record.tracking_task_id === 'string'
      ? record.tracking_task_id
      : undefined;
};

type M1BackendTaskSummary = {
  task_id?: string;
  id?: string;
  filename?: string;
  status?: string;
  needs_review?: boolean;
  overall_confidence?: number | null;
  review_fields?: Array<{
    name?: string;
    value_preview?: string;
    confidence?: number;
    value_truncated?: boolean;
  }>;
};

const toUploadTaskResponse = (payload: M1UploadTaskResponse | { task_id?: string; tracking_task_id?: string }) => ({
  taskId: 'taskId' in payload ? payload.taskId : payload.task_id ?? '',
  ...(trackingTaskIdFrom(payload) ? { trackingTaskId: trackingTaskIdFrom(payload) } : {}),
});

const toBatchRecognitionResponse = (
  payload: M1BatchRecognitionResponse | { task_ids?: string[]; failed_files?: M1FailedFile[]; parent_id?: string },
): M1BatchRecognitionResponse => {
  const direct = 'taskIds' in payload;
  const taskIds = direct ? payload.taskIds : payload.task_ids ?? (payload.parent_id ? [payload.parent_id] : []);
  const failedFiles = direct ? payload.failedFiles : payload.failed_files ?? [];
  const parentId = direct ? payload.parentId : payload.parent_id;
  return {
    taskIds,
    failedFiles,
    ...(trackingTaskIdFrom(payload) ? { trackingTaskId: trackingTaskIdFrom(payload) } : {}),
    ...(parentId ? { parentId } : {}),
  };
};

const toArchiveRecognitionResponse = (
  payload: M1ArchiveRecognitionResponse | { task_id?: string; extracted_files?: number; failed_files?: M1FailedFile[]; tracking_task_id?: string },
) => ({
  taskId: 'taskId' in payload ? payload.taskId : payload.task_id ?? '',
  extractedFiles: 'extractedFiles' in payload ? payload.extractedFiles : payload.extracted_files ?? 0,
  failedFiles: 'failedFiles' in payload ? payload.failedFiles : payload.failed_files ?? [],
  ...(trackingTaskIdFrom(payload) ? { trackingTaskId: trackingTaskIdFrom(payload) } : {}),
});

const toTaskStatus = (status: string | undefined): M1RecognitionTask['status'] => {
  switch (status) {
    case 'created':
      return 'pending';
    case 'parsing':
    case 'extracting':
    case 'scoring':
      return 'running';
    case 'needs_review':
      return 'need_review';
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return status === 'need_review' || status === 'completed' || status === 'running' ? status : 'pending';
  }
};

const toTaskProgress = (status: M1RecognitionTask['status']) => {
  switch (status) {
    case 'pending':
      return 10;
    case 'running':
      return 60;
    case 'need_review':
      return 90;
    case 'completed':
      return 100;
    case 'failed':
    case 'cancelled':
      return 100;
  }
};

const toM1RecognitionTask = (payload: M1RecognitionTask | M1BackendTaskSummary): M1RecognitionTask => {
  if ('progress' in payload && 'fileStatus' in payload) {
    return payload;
  }

  const id = payload.task_id ?? payload.id ?? '';
  const status = toTaskStatus(payload.status);
  const filename = payload.filename ?? id;
  return {
    id,
    filename,
    status,
    progress: toTaskProgress(status),
    fileStatus: [{ filename, status }],
  };
};

const isM1ReviewItem = (payload: unknown): payload is M1ReviewItem => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const item = payload as Partial<M1ReviewItem>;
  return typeof item.id === 'string' && typeof item.taskId === 'string' && typeof item.field === 'string';
};

export function createSingleRecognition(file: File, metadata: M1Metadata, options: M1RequestOptions = {}) {
  const validMetadata = m1MetadataSchema.parse(metadata);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('metadata', JSON.stringify(validMetadata));

  return requestJson<M1UploadTaskResponse | { task_id?: string; tracking_task_id?: string }>('/m0/parser-compat/ingest', {
    method: 'POST',
    ...m1RequestOptions(options),
    body: formData,
  }).then(toUploadTaskResponse);
}

export function createSyncRecognition(file: File, metadata: M1Metadata, options: M1RequestOptions = {}) {
  const validMetadata = m1MetadataSchema.parse(metadata);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('metadata', JSON.stringify(validMetadata));

  return requestJson<unknown>('/m0/parser-compat/ingest/sync', {
    method: 'POST',
    ...m1RequestOptions(options),
    body: formData,
  });
}

export function createBatchRecognition(files: File[], metadata: M1Metadata, options: M1RequestOptions = {}) {
  const validMetadata = m1MetadataSchema.parse(metadata);
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  formData.append('metadata', JSON.stringify(validMetadata));

  return requestJson<M1BatchRecognitionResponse | { task_ids?: string[]; failed_files?: M1FailedFile[]; parent_id?: string; tracking_task_id?: string }>('/m0/parser-compat/ingest/batch', {
    method: 'POST',
    ...m1RequestOptions(options),
    body: formData,
  }).then(toBatchRecognitionResponse);
}

export function createArchiveRecognition(file: File, metadata: M1Metadata, options: M1RequestOptions = {}) {
  const validMetadata = m1MetadataSchema.parse(metadata);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('metadata', JSON.stringify(validMetadata));

  return requestJson<M1ArchiveRecognitionResponse | { task_id?: string; extracted_files?: number; failed_files?: M1FailedFile[]; tracking_task_id?: string }>('/m0/parser-compat/ingest/archive', {
    method: 'POST',
    ...m1RequestOptions(options),
    body: formData,
  }).then(toArchiveRecognitionResponse);
}

export function getM1Batch(parentId: string) {
  return requestJson<M1RecognitionTask[]>(`/m0/parser-compat/batch/${parentId}`);
}

export function listM1Tasks(status?: M1RecognitionTask['status']) {
  return requestJson<Array<M1RecognitionTask | M1BackendTaskSummary>>(withQuery('/m0/parser-compat/tasks', { status })).then((tasks) =>
    tasks.map(toM1RecognitionTask),
  );
}

export function getM1Tasks() {
  return listM1Tasks();
}

export function getM1Task(taskId: string) {
  return requestJson<M1RecognitionTask>(`/m0/parser-compat/tasks/${taskId}`);
}

export function previewM1File(taskId: string) {
  return requestBlob(`/m0/parser-compat/files/${taskId}`);
}

export async function getM1ReviewItems() {
  const queue = await requestJson<unknown[]>('/m0/parser-compat/review/queue');
  if (queue.every(isM1ReviewItem)) {
    return queue;
  }

  return queue.flatMap((task) => {
    const summary = task as M1BackendTaskSummary;
    const taskId = summary.task_id ?? summary.id ?? '';
    return (summary.review_fields ?? []).flatMap((field) => {
      if (!taskId || !field.name) return [];
      return [{
        id: `${taskId}:${field.name}`,
        taskId,
        field: field.name,
        recognizedValue: field.value_preview ?? '',
        confidence: field.confidence ?? 0,
        status: 'pending' as const,
        ...(field.value_truncated ? { recognizedValueTruncated: true } : {}),
      }];
    });
  });
}

export function confirmReviewItem(item: M1ReviewItem, payload: M1ReviewSubmit, approve = true) {
  const validPayload = m1ReviewSubmitSchema.parse(payload);
  const corrections =
    approve && validPayload.correctedValue !== item.recognizedValue
      ? { [item.field]: validPayload.correctedValue }
      : undefined;

  return requestJson<unknown>(
    withQuery(`/m0/parser-compat/review/${item.taskId}`, {
      approve,
      reviewer: 'frontend-reviewer',
      comment: validPayload.reason,
    }),
    {
    method: 'POST',
      body: corrections,
    },
  );
}

export function generateM1Report(taskId: string) {
  return requestJson<{ taskId: string; reportId?: string; status: string }>(`/m0/parser-compat/tasks/${taskId}/report`, {
    method: 'POST',
  });
}

export function downloadM1Report(taskId: string) {
  return requestBlob(`/m0/parser-compat/tasks/${taskId}/report/download`);
}

export function deleteM1Task(taskId: string) {
  return requestJson<{ taskId: string; deleted: boolean }>(`/m0/parser-compat/tasks/${taskId}`, {
    method: 'DELETE',
  });
}
