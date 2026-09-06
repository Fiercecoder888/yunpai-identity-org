import type { ApiError } from '../types/api';
import { toApiUrl } from './apiGateway';
import { authRuntime } from '../auth/authRuntime';

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  timeoutMs?: number;
};

export class HttpClientError extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'HttpClientError';
    this.error = error;
  }
}

/** 请求默认超时：弱网/网关挂起时避免 mutation 无限 loading（可被调用方显式覆盖）。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export const isNotImplementedResponse = (error: unknown) =>
  error instanceof HttpClientError && error.error.status === 501;

class InternalTimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'InternalTimeoutError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const toApiError = (status: number, detail: unknown): ApiError => {
  if (isRecord(detail) && detail.success === false && Array.isArray(detail.errors)) {
    const errors = detail.errors as Array<Record<string, unknown>>;
    const firstError = errors.find((item) => isRecord(item) && typeof item.message === 'string');
    return {
      code: (typeof firstError?.code === 'string' ? firstError.code : 'server_error') as ApiError['code'],
      status,
      message: typeof firstError?.message === 'string' ? firstError.message : `Request failed with status ${status}`,
      detail,
      traceId: typeof detail.trace_id === 'string' ? detail.trace_id : undefined,
    };
  }
  if (status === 401) {
    return { code: 'unauthorized', status, message: 'Unauthorized', detail };
  }
  if (status === 403) {
    return { code: 'forbidden', status, message: 'Forbidden', detail };
  }
  if (isRecord(detail)) {
    const nested = isRecord(detail.detail) ? detail.detail : detail;
    const message = typeof nested.message === 'string'
      ? nested.message
      : typeof detail.message === 'string'
        ? detail.message
        : undefined;
    const code = typeof nested.code === 'string'
      ? nested.code
      : typeof detail.code === 'string'
        ? detail.code
        : 'server_error';
    if (message) {
      return { code: code as ApiError['code'], status, message, detail };
    }
  }
  return { code: 'server_error', status, message: `Request failed with status ${status}`, detail };
};

const isRecoverableAuthFailure = (status: number, detail: unknown) => {
  if (status === 401) return true;
  if (status !== 403 || !isRecord(detail)) return false;
  const nested = isRecord(detail.detail) ? detail.detail : detail;
  // Nginx auth_request replaces the identity BFF body with a stable gateway
  // envelope, so an expired CSRF token appears as FORBIDDEN at this boundary.
  return nested.code === 'invalid_csrf' || nested.code === 'FORBIDDEN';
};

type ResponseKind = 'json' | 'text' | 'blob';

const createFetchAbortController = (timeoutMs: number | undefined) => {
  if (timeoutMs === undefined || typeof AbortController === 'undefined') {
    return null;
  }
  const controller = new AbortController();
  if (typeof Request === 'function') {
    try {
      new Request('http://localhost/__abort_signal_probe__', { signal: controller.signal });
    } catch {
      return null;
    }
  }
  return controller;
};

const prepareRequest = (options: RequestOptions) => {
  const { timeoutMs, signal: requestSignal, ...fetchOptions } = options;
  const headers = new Headers(options.headers);
  const csrf = authRuntime.getCsrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);
  const requestBody = options.body;
  const isFormData = requestBody instanceof FormData;
  const abortController = createFetchAbortController(timeoutMs);
  let didExternalAbort = false;

  if (abortController && requestSignal) {
    const abortForExternalSignal = () => {
      didExternalAbort = true;
      abortController.abort();
    };

    if (requestSignal.aborted) {
      abortForExternalSignal();
    } else {
      requestSignal.addEventListener('abort', abortForExternalSignal, { once: true });
    }
  }

  let body: BodyInit | undefined;
  if (isFormData) {
    body = requestBody;
  } else if (requestBody !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(requestBody);
  }

  return {
    fetchOptions,
    headers,
    body,
    timeoutMs,
    requestSignal,
    abortController,
    didExternalAbort: () => didExternalAbort,
  };
};

async function request<T>(path: string, options: RequestOptions, responseKind: ResponseKind): Promise<T> {
  const normalizedOptions = { ...options, timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS };
  const prepared = prepareRequest(normalizedOptions);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const fetchPayload = async (allowRecovery = true): Promise<T> => {
    const response = await fetch(toApiUrl(path), {
      ...prepared.fetchOptions,
      headers: prepared.headers,
      body: prepared.body,
      signal: prepared.abortController?.signal ?? prepared.requestSignal,
      credentials: 'same-origin',
    });

    let payload: unknown;
    if (responseKind === 'json') {
      try {
        payload = await response.json();
      } catch (error) {
        // 解析失败时带上状态码与原始响应片段，避免终端用户看到无意义的
        // "Invalid JSON response"（例如网关 502/HTML 错误页）。
        const raw = await response.text().catch(() => '');
        const snippet = raw.slice(0, 300).replace(/\s+/g, ' ').trim();
        throw new HttpClientError({
          code: 'parse_error',
          status: response.status,
          message: snippet
            ? `服务返回异常（HTTP ${response.status}）：${snippet}`
            : `服务返回异常（HTTP ${response.status}，非 JSON 响应）`,
          detail: error,
        });
      }
    } else if (responseKind === 'blob') {
      payload = await response.blob();
    } else {
      payload = await response.text();
    }

    if (allowRecovery && isRecoverableAuthFailure(response.status, payload) && (await authRuntime.recover())) {
      const csrf = authRuntime.getCsrfToken();
      if (csrf) prepared.headers.set('X-CSRF-Token', csrf);
      return fetchPayload(false);
    }

    if (!response.ok) {
      throw new HttpClientError(toApiError(response.status, payload));
    }

    return payload as T;
  };

  const timeout = () =>
    new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new InternalTimeoutError());
        prepared.abortController?.abort();
      }, prepared.timeoutMs);
    });

  try {
    return prepared.timeoutMs === undefined ? await fetchPayload() : await Promise.race([fetchPayload(), timeout()]);
  } catch (error) {
    if (error instanceof HttpClientError) {
      throw error;
    }
    if (error instanceof InternalTimeoutError) {
      throw new HttpClientError({ code: 'timeout', message: 'Request timed out', detail: error });
    }
    throw new HttpClientError({ code: 'network_error', message: 'Network request failed', detail: error });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, options, 'json');
}

export async function requestText(path: string, options: RequestOptions = {}): Promise<string> {
  return request<string>(path, options, 'text');
}

export async function requestBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  return request<Blob>(path, options, 'blob');
}
