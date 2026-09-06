import { withQuery } from './apiGateway';
import { requestJson } from './httpClient';
import { createM1TrackingTaskId } from './m1Api';

export type M1IngestStatus = 'queued' | 'running' | 'needs_review' | 'done' | 'failed' | 'cancelled';

export type M1IngestSummary = {
  task_id: string;
  tracking_task_id?: string;
  tenant_id?: string;
  filename: string;
  status: string;
  needs_review: boolean;
  overall_confidence?: number | null;
  file_type?: string | null;
  doc_type?: string | null;
  document_subtype?: string | null;
  processing_stage?: string | null;
  error?: string | null;
};

export type M1IngestDetail = M1IngestSummary & {
  file_path?: string;
  knowledge_sync_status?: string | null;
  knowledge_document_id?: string | null;
  knowledge_version_id?: string | null;
  parent_id?: string | null;
  child_ids?: string[];
  parsed_content?: string;
  extraction?: Record<string, unknown> | null;
  scored_result?: Record<string, unknown> | null;
  document?: Record<string, unknown> | null;
  reviewed_result?: Record<string, unknown> | null;
  sync_complete?: boolean;
  poll_url?: string;
  child_count?: number;
  children?: M1IngestSummary[];
};

export type M1IngestRequest = {
  file: File;
  docTypeHint?: string;
  documentSubtypeHint?: string;
  semanticEnrichment?: boolean;
  trackingTaskId?: string;
  signal?: AbortSignal;
};

export type M1TaskFilter = {
  status?: string;
  docType?: string;
  limit?: number;
  cursor?: string;
};

const normalizeStatus = (value: unknown) => {
  const status = typeof value === 'string' ? value : '';
  if (status === 'need_review') return 'needs_review';
  if (status === 'completed') return 'done';
  return status;
};

const normalizeDetail = (value: unknown): M1IngestDetail | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const rawTaskId = record.task_id ?? record.taskId ?? record.id;
  if (typeof rawTaskId !== 'string' || !rawTaskId.trim()) return null;
  const taskId = rawTaskId.trim();
  const status = normalizeStatus(record.status);
  const trackingTaskId = record.tracking_task_id ?? record.trackingTaskId;
  return {
    ...record,
    task_id: taskId,
    ...(typeof trackingTaskId === 'string' && trackingTaskId.trim()
      ? { tracking_task_id: trackingTaskId.trim() }
      : {}),
    filename: typeof record.filename === 'string' && record.filename.trim() ? record.filename : taskId,
    status,
    needs_review: typeof record.needs_review === 'boolean' ? record.needs_review : status === 'needs_review',
  } as M1IngestDetail;
};

const toDetail = (payload: unknown): M1IngestDetail => {
  const direct = normalizeDetail(payload);
  if (direct) return direct;
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const nested = normalizeDetail((payload as { data?: unknown }).data);
    if (nested) return nested;
  }
  throw new Error('M1 ingest 返回格式无法识别');
};

export async function uploadOrderFile(request: M1IngestRequest): Promise<M1IngestDetail> {
  const form = new FormData();
  form.append('file', request.file, request.file.name);
  if (request.docTypeHint) form.append('doc_type_hint', request.docTypeHint);
  if (request.documentSubtypeHint) form.append('document_subtype_hint', request.documentSubtypeHint);
  form.append('semantic_enrichment', String(request.semanticEnrichment ?? true));
  const trackingTaskId = request.trackingTaskId?.trim() || createM1TrackingTaskId();
  const payload = await requestJson<unknown>('/m0/parser-compat/ingest', {
    method: 'POST',
    headers: { 'X-Yunpai-Task-ID': trackingTaskId },
    body: form,
    timeoutMs: 60_000,
    signal: request.signal,
  });
  return toDetail(payload);
}

export async function getM1Task(taskId: string, signal?: AbortSignal): Promise<M1IngestDetail> {
  const payload = await requestJson<unknown>(`/m0/parser-compat/tasks/${encodeURIComponent(taskId)}`, { signal });
  return toDetail(payload);
}

export async function listM1Tasks(filter: M1TaskFilter = {}): Promise<M1IngestSummary[]> {
  const params: Record<string, string | number> = {};
  if (filter.status) params.status = filter.status;
  if (filter.docType) params.doc_type = filter.docType;
  if (filter.limit !== undefined) params.limit = filter.limit;
  if (filter.cursor) params.cursor = filter.cursor;
  const payload = await requestJson<unknown>(withQuery('/m0/parser-compat/tasks', params));
  if (Array.isArray(payload)) {
    return payload as M1IngestSummary[];
  }
  const record = payload as { items?: unknown; tasks?: unknown };
  return (Array.isArray(record.items) ? record.items : Array.isArray(record.tasks) ? record.tasks : []) as M1IngestSummary[];
}

export async function waitForM1Task(
  taskId: string,
  options: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<M1IngestDetail> {
  const timeoutMs = options.timeoutMs ?? 300_000;
  const intervalMs = options.intervalMs ?? 1500;
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (options.signal?.aborted) {
      throw new Error('上传识别任务已取消');
    }
    const detail = await getM1Task(taskId, options.signal);
    if (detail.status === 'done' || detail.status === 'needs_review' || detail.status === 'failed' || detail.status === 'cancelled') {
      return detail;
    }
    if (Date.now() >= deadline) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export function isM1TaskTerminal(detail: M1IngestDetail): boolean {
  return detail.status === 'done' || detail.status === 'needs_review' || detail.status === 'failed' || detail.status === 'cancelled';
}

export function isM1TaskSuccessful(detail: M1IngestDetail): boolean {
  return detail.status === 'done' || detail.status === 'needs_review';
}

export function isM1TaskFailed(detail: M1IngestDetail): boolean {
  return detail.status === 'failed' || detail.status === 'cancelled';
}
