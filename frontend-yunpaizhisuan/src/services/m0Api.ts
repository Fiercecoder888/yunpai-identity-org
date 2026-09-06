import { unwrapEnvelope } from './apiResponse';
import { HttpClientError, requestJson } from './httpClient';
import { toApiUrl, withQuery } from './apiGateway';

export const M0_UPLOAD_PROCESSING_HINT = '文件较大，服务端可能仍在处理，可稍后在「数据建设」页查看结果';

export type M0Document = {
  id: number;
  batch_id: string;
  original_name: string;
  stored_name: string;
  content_hash: string;
  detected_format: string;
  declared_ext: string;
  domain: string;
  confidence: number;
  status: string;
  message: string;
  row_count: number;
  extract_status: string;
  extract_task_id: string;
  extract_content: string;
  document_kind?: string;
  agent_state?: string;
  agent_trace?: string;
  proposed_schema?: string;
  content_preview?: string;
};

export type M0AgentEvidence = {
  id?: string;
  tool?: string;
  kind?: string;
  summary?: string;
  payload?: unknown;
  locator?: Record<string, unknown>;
};

export type M0AgentTraceEntry = {
  step?: number;
  action?: string;
  tool?: string;
  query?: string;
  reason?: string;
  status?: string;
  evidence_id?: string;
  error?: string;
  model?: string;
  arguments?: Record<string, unknown>;
};

export type M0AgentState = {
  objective?: string;
  source?: Record<string, unknown>;
  content_hypotheses?: Array<Record<string, unknown>>;
  known_facts?: Array<Record<string, unknown>>;
  unknowns?: Array<Record<string, unknown>>;
  evidence?: M0AgentEvidence[];
  tool_history?: M0AgentTraceEntry[];
  document_summary?: string;
  document_kind?: string;
  compatibility_domain?: string;
  business_objects?: Array<Record<string, unknown>>;
  relationships?: Array<Record<string, unknown>>;
  proposed_schema?: Record<string, unknown>;
  uncertainties?: Array<Record<string, unknown>>;
  confidence?: number;
  model_level?: number;
  model_name?: string;
  status?: string;
  review_reasons?: string[];
};

export type M0Row = {
  id: number;
  batch_id: string;
  document_id: number;
  domain: string;
  sheet_name: string;
  row_index: number;
  fields: Record<string, unknown>;
  status: string;
  issues: string[];
  raw_preview: string;
};

export type M0Entity = {
  id: number;
  batch_id: string;
  code: string;
  name: string;
  uom: string;
  spec: string;
  aliases: string[];
  identity_conflict: string;
  status: string;
};

export type M0Mapping = {
  id: number;
  batch_id: string;
  entity_id: number;
  source_ref: string;
  target_ref: string;
  status: string;
  evidence: string;
  resolved_by: string;
  resolved_at: string;
};

export type M0Batch = {
  id: string;
  status: string;
  processing_stage?: string;
  source_names: string;
  stats: Record<string, unknown>;
  tenant_id: string;
  created_by: string;
  tracking_task_id?: string;
  created_at: string;
  updated_at: string;
};

const parseJsonRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const M0_TERMINAL_STATUSES = new Set([
  'awaiting_review',
  'ready',
  'committed',
  'rolled_back',
  'failed',
]);

const normalizeM0Batch = (batch: M0Batch): M0Batch => {
  const staleStage = !batch.processing_stage || batch.processing_stage === 'received';
  return {
    ...batch,
    processing_stage:
      staleStage && M0_TERMINAL_STATUSES.has(batch.status)
        ? batch.status
        : batch.processing_stage,
    stats: parseJsonRecord(batch.stats),
  };
};

export const m0BatchFileCount = (batch: M0Batch): number => {
  if (Array.isArray(batch.source_names)) return batch.source_names.length;
  if (typeof batch.source_names !== 'string' || !batch.source_names.trim()) return 0;
  try {
    const parsed = JSON.parse(batch.source_names) as unknown;
    return Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    return 1;
  }
};

export type M0Quarantine = {
  id: number;
  batch_id: string;
  original_name: string;
  stored_name: string;
  content_hash: string;
  reason: string;
  detail: string;
  created_at: string;
};

export type M0Preview = {
  batch: M0Batch;
  documents: M0Document[];
  rows: M0Row[];
  entities: M0Entity[];
  mappings: M0Mapping[];
  quarantine: M0Quarantine[];
  ledger: Array<Record<string, unknown>>;
};

const parse = <T>(payload: unknown): T => unwrapEnvelope<T>(payload);

const M0_PROCESSING_STATUSES = new Set(['received', 'ingesting', 'classifying', 'parsing']);

export class M0BatchProcessingError extends Error {
  readonly batch: M0Batch;

  constructor(batch: M0Batch) {
    super(`${M0_UPLOAD_PROCESSING_HINT} (batch ${batch.id})`);
    this.name = 'M0BatchProcessingError';
    this.batch = batch;
  }
}

export type WaitForM0BatchOptions = {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  trackingTaskId?: string;
};

export const createM0TrackingTaskId = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `task_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const waitForDelay = (delayMs: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('批次轮询已取消', 'AbortError'));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException('批次轮询已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });

export async function waitForM0Batch(
  batch: M0Batch,
  options: WaitForM0BatchOptions = {},
): Promise<M0Batch> {
  if (!M0_PROCESSING_STATUSES.has(batch.status)) {
    return batch;
  }
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 1_200_000;
  const deadline = Date.now() + timeoutMs;
  let current = batch;
  while (Date.now() < deadline) {
    await waitForDelay(intervalMs, options.signal);
    try {
      current = (await getM0BatchDetail(current.id, options.signal)).batch;
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DOMException('批次轮询已取消', 'AbortError');
      }
      if (
        error instanceof HttpClientError &&
        (error.error.code === 'timeout' ||
          error.error.code === 'network_error' ||
          error.error.status === 502 ||
          error.error.status === 504)
      ) {
        continue;
      }
      throw error;
    }
    if (!M0_PROCESSING_STATUSES.has(current.status)) {
      return current;
    }
  }
  throw new M0BatchProcessingError(current);
}

export function uploadM0Files(files: File[], options: WaitForM0BatchOptions = {}) {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  const trackingTaskId = options.trackingTaskId?.trim() || createM0TrackingTaskId();
  return requestJson<unknown>('/m0/import/upload?wait=false', {
    method: 'POST',
    headers: { 'X-Yunpai-Task-ID': trackingTaskId },
    body: form,
    timeoutMs: 120_000,
    signal: options.signal,
  })
    .then((response) => normalizeM0Batch(parse<M0Batch>(response)))
    .catch((error: unknown) => {
      // 504/超时/网络中断 ≠ 任务失败：m0 服务端可能仍在处理，引导到数据建设页查看。
      if (error instanceof HttpClientError) {
        const { code, status } = error.error;
        if (code === 'timeout' || code === 'network_error' || status === 504) {
          throw new Error(M0_UPLOAD_PROCESSING_HINT);
        }
      }
      throw error;
    });
}

export function listM0Batches(limit = 50, offset = 0) {
  return requestJson<unknown>(withQuery('/m0/import/batches', { limit, offset })).then(
    (response) => {
      const payload = parse<{ batches: M0Batch[] }>(response);
      return { batches: payload.batches.map(normalizeM0Batch) };
    },
  );
}

export type M0MasterRow = Record<string, unknown>;

export function listM0Master(table: string, limit = 50) {
  return requestJson<unknown>(withQuery(`/m0/import/master/${table}`, { limit })).then(
    (response) => parse<{ items: M0MasterRow[] }>(response),
  );
}

/** 人工修改主数据单行（PUT /m0/import/master/{table}/{rowId}）。 */
export function updateM0MasterRow(table: string, rowId: number, values: Record<string, unknown>) {
  return requestJson<unknown>(`/m0/import/master/${table}/${rowId}`, {
    method: 'PUT',
    body: { values },
  }).then((response) => parse<{ row: M0MasterRow; affected: number }>(response));
}

/** 人工新增主数据行（POST /m0/import/master/{table}）。 */
export function createM0MasterRow(table: string, values: Record<string, unknown>) {
  return requestJson<unknown>(`/m0/import/master/${table}`, {
    method: 'POST',
    body: { values },
  }).then((response) => parse<{ row: M0MasterRow; id: number }>(response));
}

/** 人工删除主数据行（DELETE /m0/import/master/{table}/{rowId}）。 */
export function deleteM0MasterRow(table: string, rowId: number) {
  return requestJson<unknown>(`/m0/import/master/${table}/${rowId}`, {
    method: 'DELETE',
  }).then((response) => parse<{ deleted: number }>(response));
}

export type M0InventoryRow = {
  id?: number;
  material_code?: string;
  material_name?: string;
  qty?: number;
  uom?: string;
  spec?: string;
  warehouse?: string;
  warehouse_code?: string;
  status?: string;
  [key: string]: unknown;
};

/** 分页拉取 m0 已入库的物料库存（m0_master_inventory），支持物料编码过滤。 */
export function listM0Inventory(limit = 200, offset = 0, materialCode = '') {
  const params: Record<string, string | number> = { limit, offset };
  if (materialCode) params.material_code = materialCode;
  return requestJson<unknown>(withQuery('/m0/import/master/m0_master_inventory', params)).then(
    (response) => parse<{ items: M0InventoryRow[] }>(response),
  );
}

export function getM0BatchDetail(batchId: string, signal?: AbortSignal) {
  return requestJson<unknown>(`/m0/import/batch/${batchId}`, { signal }).then(
    (response) => {
      const payload = parse<{ batch: M0Batch; documents: M0Document[]; stats: Record<string, unknown> }>(response);
      return { ...payload, batch: normalizeM0Batch(payload.batch) };
    },
  );
}

/**
 * 批次文档原始文件流 URL（前端 iframe / 下载预览用）。
 */
export function m0BatchDocumentFileUrl(batchId: string, documentId: number) {
  return toApiUrl(`/m0/import/batch/${batchId}/documents/${documentId}/file`);
}

/** 表格类文档（xls/xlsx/csv 等）的 HTML 内嵌预览端点。 */
export function m0BatchDocumentPreviewUrl(batchId: string, documentId: number) {
  return toApiUrl(`/m0/import/batch/${batchId}/documents/${documentId}/preview.html`);
}

export function retryM0Extraction(batchId: string) {
  return requestJson<unknown>(`/m0/import/batch/${batchId}/extract/retry`, {
    method: 'POST',
    body: {},
    timeoutMs: 300_000,
  }).then((response) =>
    parse<{ batch_id: string; retried: number; document_ids: number[] }>(response),
  );
}

export function previewM0Batch(batchId: string) {
  return requestJson<unknown>(`/m0/import/batch/${batchId}/preview`).then((response) => {
    const payload = parse<M0Preview>(response);
    return { ...payload, batch: normalizeM0Batch(payload.batch) };
  });
}

export function resolveM0Entity(
  batchId: string,
  entityId: number,
  action: 'approve' | 'reject',
  decisionReason: string,
) {
  return requestJson<unknown>(`/m0/import/batch/${batchId}/resolve/entity`, {
    method: 'POST',
    body: { entity_id: entityId, action, decision_reason: decisionReason },
  }).then((response) => parse<M0Entity>(response));
}

export function resolveM0Document(batchId: string, documentId: number, action: 'approve' | 'reject') {
  return requestJson<unknown>(`/m0/import/batch/${batchId}/resolve/document`, {
    method: 'POST',
    body: { document_id: documentId, action },
  }).then((response) => parse<M0Document>(response));
}

export function resolveM0Mapping(
  batchId: string,
  mappingId: number,
  action: 'approve' | 'reject',
  targetRef: string,
  decisionReason: string,
) {
  return requestJson<unknown>(`/m0/import/batch/${batchId}/resolve/mapping`, {
    method: 'POST',
    body: {
      mapping_id: mappingId,
      action,
      target_ref: targetRef,
      decision_reason: decisionReason,
    },
  }).then((response) => parse<M0Mapping>(response));
}

export function commitM0Batch(batchId: string) {
  return requestJson<unknown>(`/m0/import/batch/${batchId}/commit`, {
    method: 'POST',
    body: {},
  }).then((response) => parse<Record<string, unknown>>(response));
}

export function rollbackM0Batch(batchId: string) {
  return requestJson<unknown>(`/m0/import/batch/${batchId}/rollback`, {
    method: 'POST',
    body: {},
  }).then((response) => parse<Record<string, unknown>>(response));
}

export function listM0Quarantine(batchId?: string, limit = 100) {
  return requestJson<unknown>(withQuery('/m0/import/quarantine', { batch_id: batchId, limit })).then(
    (response) => parse<{ items: M0Quarantine[] }>(response),
  );
}
