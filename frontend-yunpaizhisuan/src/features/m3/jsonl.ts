import type { ApiEnvelope } from '../../services/apiResponse';
import { HttpClientError } from '../../services/httpClient';

export type M3JsonlEnvelope = Required<ApiEnvelope<Record<string, unknown>>>;

export type M3JsonlInputLine = {
  lineNumber: number;
  payload: Record<string, unknown> | null;
  orderId: string;
  parseError?: string;
};

export type M3JsonlResult = M3JsonlInputLine & {
  envelope: M3JsonlEnvelope;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const orderIdFromPayload = (payload: Record<string, unknown>) => {
  const order = payload.order;
  if (!isRecord(order)) {
    return '';
  }
  return typeof order.order_id === 'string' ? order.order_id : '';
};

const frontendFailure = (lineNumber: number, code: string, message: string): M3JsonlEnvelope => ({
  success: false,
  data: null,
  errors: [{ code, message, field: `line:${lineNumber}` }],
  trace_id: `frontend-jsonl-line-${lineNumber}`,
});

const asEnvelope = (value: unknown): M3JsonlEnvelope | null => {
  if (!isRecord(value) || typeof value.success !== 'boolean') {
    return null;
  }
  if (!('data' in value) || !Array.isArray(value.errors) || typeof value.trace_id !== 'string') {
    return null;
  }
  return value as M3JsonlEnvelope;
};

export function parseM3Jsonl(content: string): M3JsonlInputLine[] {
  const entries: M3JsonlInputLine[] = [];
  content.split(/\r?\n/).forEach((rawLine, index) => {
    if (!rawLine.trim()) {
      return;
    }
    const lineNumber = index + 1;
    try {
      const parsed: unknown = JSON.parse(rawLine);
      if (!isRecord(parsed)) {
        entries.push({
          lineNumber,
          payload: null,
          orderId: '',
          parseError: '每行必须是一个 JSON 对象',
        });
        return;
      }
      entries.push({
        lineNumber,
        payload: parsed,
        orderId: orderIdFromPayload(parsed),
      });
    } catch (error) {
      entries.push({
        lineNumber,
        payload: null,
        orderId: '',
        parseError: error instanceof Error ? error.message : 'JSON 解析失败',
      });
    }
  });
  return entries;
}

export function serializeM3Jsonl(rows: unknown[]) {
  if (rows.length === 0) {
    return '';
  }
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

export async function runM3JsonlBatch(
  entries: M3JsonlInputLine[],
  runner: (payload: Record<string, unknown>) => Promise<M3JsonlEnvelope>,
): Promise<M3JsonlResult[]> {
  const results: M3JsonlResult[] = [];
  for (const entry of entries) {
    if (!entry.payload) {
      results.push({
        ...entry,
        envelope: frontendFailure(
          entry.lineNumber,
          'JSONL_PARSE_ERROR',
          entry.parseError ?? 'JSON 解析失败',
        ),
      });
      continue;
    }

    try {
      results.push({ ...entry, envelope: await runner(entry.payload) });
    } catch (error) {
      const serverEnvelope =
        error instanceof HttpClientError ? asEnvelope(error.error.detail) : null;
      results.push({
        ...entry,
        envelope:
          serverEnvelope ??
          frontendFailure(
            entry.lineNumber,
            error instanceof HttpClientError ? error.error.code : 'JSONL_REQUEST_ERROR',
            error instanceof Error ? error.message : 'M3 请求失败',
          ),
      });
    }
  }
  return results;
}

export function downloadM3Jsonl(filename: string, rows: unknown[]) {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }
  const content = serializeM3Jsonl(rows);
  const url = URL.createObjectURL(
    new Blob([content], { type: 'application/x-ndjson;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
