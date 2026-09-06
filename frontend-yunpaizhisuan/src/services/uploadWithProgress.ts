import { authRuntime } from '../auth/authRuntime';
import { unwrapEnvelope } from './apiResponse';
import { toApiUrl } from './apiGateway';
import type { M1Metadata } from '../schemas/m1';
import type {
  M1ArchiveRecognitionResponse,
  M1BatchRecognitionResponse,
  M1FailedFile,
} from './m1Api';
import { createM1TrackingTaskId } from './m1Api';
import {
  createM0TrackingTaskId,
  M0_UPLOAD_PROCESSING_HINT,
  type M0Batch,
} from './m0Api';

export const UPLOAD_CANCELLED_MESSAGE = '上传已取消';

/**
 * m0 上传的前端安全上限（MiB）。网关请求体上限是 200 MiB；预留 1 MiB 给
 * multipart 边界和字段，避免文件本体恰好 200 MiB 时在线路层超限。
 */
export const M0_GATEWAY_MAX_UPLOAD_MB = 199;

/**
 * m0 上传 UI 的「大文件」阈值（MiB）。达到该大小的批次在传输完成、服务端处理
 * 阶段附加大文件提示（解压/识别可能需要几分钟），中小文件保持轻量提示。
 */
export const M0_LARGE_UPLOAD_MB = 30;

/**
 * m0 批次「等待较久」阈值（秒）。批次处理超过该时长后，即使文件本身不大，
 * 也附加大文件提示，让用户明白长时间等待是正常的。
 */
export const M0_SLOW_PROCESSING_SEC = 60;

/** 服务端处理中的大文件友好提示（用于传输完成 100% 后、轮询批次期间）。 */
export const M0_LARGE_FILE_PROCESSING_HINT = '大文件解压/识别可能需要几分钟，请耐心等待';

/**
 * 传输完成（100%）后等待服务端响应期间的提示文案。大文件才附加大文件说明，
 * 中小文件只提示「服务端处理中」，避免过度提示。
 */
export const m0UploadCompletedText = (large: boolean): string =>
  large ? `传输完成，服务端处理中（${M0_LARGE_FILE_PROCESSING_HINT}）…` : '传输完成，服务端处理中，请稍候…';

/**
 * 批次轮询期间的附加提示片段：仅当文件较大或等待较久时返回大文件说明，
 * 否则返回空字符串（保持中小文件的轻量提示）。
 */
export const m0ProcessingNote = (opts: { large?: boolean; slow?: boolean } = {}): string =>
  opts.large || opts.slow ? M0_LARGE_FILE_PROCESSING_HINT : '';

export const m0UploadTotalMb = (files: readonly { size: number }[]): number =>
  files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024;

export const isM0UploadOverGatewayLimit = (files: readonly { size: number }[]): boolean =>
  m0UploadTotalMb(files) > M0_GATEWAY_MAX_UPLOAD_MB;

export const m0UploadOverLimitMessage = (files: readonly { size: number }[]): string =>
  `文件总大小约 ${m0UploadTotalMb(files).toFixed(1)}MB，超过网关单请求上限（${M0_GATEWAY_MAX_UPLOAD_MB}MB），会被网关拒绝。请拆分文件后分批上传。`;

/**
 * 把 m0 上传失败转成用户可理解的中文提示。网关超限响应固定为 JSON 413；
 * 同时兼容旧 Nginx 文案。普通 HTTP 500 保留原错误，不能误报成文件超限。
 */
export const describeM0UploadError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '上传已取消';
  }
  const message = error instanceof Error ? error.message : '';
  if (!message) {
    return 'm0 导入失败，请检查文件';
  }
  if (/HTTP 413|\b413\b|PAYLOAD_TOO_LARGE|payload[^\n]*too large|body[^\n]*too large|too large body/i.test(message)) {
    return `上传被网关拒绝（${message}）：文件总大小可能超过网关单请求上限（${M0_GATEWAY_MAX_UPLOAD_MB}MB），请拆分文件后分批上传`;
  }
  return message;
};

const trackingTaskIdFrom = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as { trackingTaskId?: unknown; tracking_task_id?: unknown };
  return typeof record.trackingTaskId === 'string'
    ? record.trackingTaskId
    : typeof record.tracking_task_id === 'string'
      ? record.tracking_task_id
      : undefined;
};

/**
 * m0 大文件上传的友好提示：m0 服务端可能仍在处理（网关 504/客户端超时/网络中断
 * 都不等于任务失败），引导用户稍后到「数据建设」页查看批次结果。
 */
export type UploadWithProgressOptions = {
  method?: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  retryOnUnauthorized?: boolean;
  /** 长耗时上传的友好提示：504/超时/网络中断时拼进错误文案，避免误报“上传失败” */
  longRunningHint?: string;
};

export type UploadWithProgressResult = {
  status: number;
  data: unknown;
};

const parseResponseText = (responseText: string): unknown => {
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
};

const formatHttpError = (status: number, data: unknown): string => {
  if (data && typeof data === 'object') {
    const record = data as { errors?: Array<{ message?: string }>; message?: string; detail?: { message?: string } };
    const message = record.errors?.find((item) => typeof item?.message === 'string')?.message ?? record.message ?? record.detail?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  return `请求失败（HTTP ${status}）`;
};

const isRecoverableUploadAuthFailure = (status: number, data: unknown) => {
  if (status === 401) return true;
  if (status !== 403 || !data || typeof data !== 'object') return false;
  const record = data as { code?: unknown; detail?: unknown };
  const detail = record.detail && typeof record.detail === 'object'
    ? record.detail as { code?: unknown }
    : record;
  return detail.code === 'invalid_csrf' || detail.code === 'FORBIDDEN';
};

export function uploadWithProgress(
  path: string,
  body: FormData | string,
  options: UploadWithProgressOptions = {},
): Promise<UploadWithProgressResult> {
  const {
    method = 'POST',
    headers = {},
    timeoutMs = 300_000,
    signal,
    onProgress,
    retryOnUnauthorized = true,
    longRunningHint,
  } = options;

  const perform = (allowRetry: boolean) =>
    new Promise<UploadWithProgressResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, toApiUrl(path));
      xhr.responseType = 'text';
      xhr.timeout = timeoutMs;

      const csrf = authRuntime.getCsrfToken();
      if (csrf) {
        xhr.setRequestHeader('X-CSRF-Token', csrf);
      }
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      if (typeof body === 'string') {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }

      let settled = false;
      const handleAbort = () => {
        if (settled) {
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        xhr.abort();
        reject(new DOMException(UPLOAD_CANCELLED_MESSAGE, 'AbortError'));
      };
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      signal?.addEventListener('abort', handleAbort, { once: true });

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        }
      };
      xhr.ontimeout = () => {
        if (settled) {
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        reject(new Error(longRunningHint ? `上传超时：${longRunningHint}` : `上传超时：${timeoutMs}ms`));
      };
      xhr.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        reject(new Error(longRunningHint ? `网络中断：${longRunningHint}` : '上传网络错误'));
      };
      xhr.onabort = () => {
        if (settled) {
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        reject(new DOMException(UPLOAD_CANCELLED_MESSAGE, 'AbortError'));
      };
      xhr.onload = () => {
        if (settled) {
          return;
        }
        const data = parseResponseText(xhr.responseText);
        if (allowRetry && retryOnUnauthorized && isRecoverableUploadAuthFailure(xhr.status, data)) {
          void authRuntime.recover().then((recovered) => {
            if (!recovered) {
              settled = true;
              signal?.removeEventListener('abort', handleAbort);
              reject(new Error('会话已过期，请重新登录'));
              return;
            }
            settled = true;
            signal?.removeEventListener('abort', handleAbort);
            void perform(false).then(resolve, reject);
          });
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ status: xhr.status, data });
          return;
        }
        if (longRunningHint && xhr.status === 504) {
          reject(new Error(`网关处理超时（HTTP 504）：${longRunningHint}`));
          return;
        }
        reject(new Error(formatHttpError(xhr.status, data)));
      };

      xhr.send(body);
    });

  return perform(true);
}

export type M0UploadProgressOptions = {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  pollIntervalMs?: number;
  processingTimeoutMs?: number;
  trackingTaskId?: string;
};

/** /m0/import/upload 的 XHR 进度包装；端点契约由 m0.import.upload 覆盖。 */
export async function uploadM0FilesWithProgress(
  files: File[],
  options: M0UploadProgressOptions = {},
): Promise<M0Batch> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  const trackingTaskId = options.trackingTaskId?.trim() || createM0TrackingTaskId();
  const result = await uploadWithProgress('/m0/import/upload?wait=false', form, {
    method: 'POST',
    headers: { 'X-Yunpai-Task-ID': trackingTaskId },
    // m0 收到大压缩包后会先同步解压+识别再返回，响应可能长达 100-200 秒
    // （网关 proxy_read_timeout 300s）。客户端超时对齐网关，避免「上传已 100%
    // 但响应稍慢」被 120s 超时误杀成上传失败。
    timeoutMs: 300_000,
    signal: options.signal,
    onProgress: options.onProgress,
    longRunningHint: M0_UPLOAD_PROCESSING_HINT,
  });
  return unwrapEnvelope<M0Batch>(result.data);
}

type M1BatchUploadPayload = M1BatchRecognitionResponse | {
  task_ids?: string[];
  failed_files?: M1FailedFile[];
  parent_id?: string;
  tracking_task_id?: string;
};

const toM1BatchResponse = (payload: unknown): M1BatchRecognitionResponse => {
  const record = (payload ?? {}) as M1BatchUploadPayload;
  const direct = 'taskIds' in record;
  const taskIds = direct ? record.taskIds : record.task_ids ?? (record.parent_id ? [record.parent_id] : []);
  const failedFiles = direct ? record.failedFiles : record.failed_files ?? [];
  const parentId = direct ? record.parentId : record.parent_id;
  return {
    taskIds,
    failedFiles,
    ...(trackingTaskIdFrom(record) ? { trackingTaskId: trackingTaskIdFrom(record) } : {}),
    ...(parentId ? { parentId } : {}),
  };
};

/** M0 parser compatibility batch-upload progress wrapper. */
export async function createM1BatchRecognitionWithProgress(
  files: File[],
  metadata: M1Metadata,
  options: M0UploadProgressOptions = {},
): Promise<M1BatchRecognitionResponse> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file));
  form.append('metadata', JSON.stringify(metadata));
  const result = await uploadWithProgress('/m0/parser-compat/ingest/batch', form, {
    method: 'POST',
    headers: { 'X-Yunpai-Task-ID': options.trackingTaskId?.trim() || createM1TrackingTaskId() },
    timeoutMs: 300_000,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  return toM1BatchResponse(result.data);
}

type M1ArchiveUploadPayload = M1ArchiveRecognitionResponse | {
  task_id?: string;
  extracted_files?: number;
  failed_files?: M1FailedFile[];
  tracking_task_id?: string;
};

/** M0 parser compatibility archive-upload progress wrapper. */
export async function createM1ArchiveRecognitionWithProgress(
  file: File,
  metadata: M1Metadata,
  options: M0UploadProgressOptions = {},
): Promise<M1ArchiveRecognitionResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('metadata', JSON.stringify(metadata));
  const result = await uploadWithProgress('/m0/parser-compat/ingest/archive', form, {
    method: 'POST',
    headers: { 'X-Yunpai-Task-ID': options.trackingTaskId?.trim() || createM1TrackingTaskId() },
    timeoutMs: 300_000,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  const record = (result.data ?? {}) as M1ArchiveUploadPayload;
  const direct = 'taskId' in record;
  return {
    taskId: direct ? record.taskId : record.task_id ?? '',
    extractedFiles: direct ? record.extractedFiles : record.extracted_files ?? 0,
    failedFiles: direct ? record.failedFiles : record.failed_files ?? [],
    ...(trackingTaskIdFrom(record) ? { trackingTaskId: trackingTaskIdFrom(record) } : {}),
  };
}

export const CANDIDATE_RUNS_KEY = 'yunpai-candidate-runs';

export type CandidateRun = {
  task_id?: string;
  run_id?: string;
};

export const readCandidateRuns = (): Record<string, CandidateRun> => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(CANDIDATE_RUNS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, CandidateRun>) : {};
  } catch {
    return {};
  }
};

export type ContinueTrackingResult = {
  run?: import('./businessFlowRunApi').BusinessFlowRun;
  taskId?: string;
};

/**
 * 断线重连续传：从 localStorage['yunpai-candidate-runs'] 找回 run_id 对应的
 * task_id 上下文后轮询业务流终态，避免超时后重复创建根 TaskID。
 */
export async function continueTrackingRun(
  runId: string,
  options: { maxAttempts?: number; intervalMs?: number; signal?: AbortSignal } = {},
): Promise<ContinueTrackingResult> {
  const { getBusinessFlow } = await import('./businessFlowRunApi');
  const maxAttempts = options.maxAttempts ?? 40;
  const intervalMs = options.intervalMs ?? 1500;
  const entry = Object.values(readCandidateRuns()).find((item) => item.run_id === runId);
  let attempts = 0;
  let last;
  while (attempts < maxAttempts) {
    if (options.signal?.aborted) {
      throw new DOMException('续传轮询已取消', 'AbortError');
    }
    const run = await getBusinessFlow(runId, options.signal);
    last = run;
    if (!['queued', 'running'].includes(run.status)) {
      return { run, taskId: entry?.task_id };
    }
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { run: last, taskId: entry?.task_id };
}
