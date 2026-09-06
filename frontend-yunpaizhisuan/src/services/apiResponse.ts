import type { ApiError } from '../types/api';
import { HttpClientError } from './httpClient';

export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  errors?: Array<{ code?: string; message: string; field?: string }>;
  trace_id?: string;
};

export type Page<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function unwrapEnvelope<T>(payload: unknown): T {
  if (!isRecord(payload) || typeof payload.success !== 'boolean') {
    return payload as T;
  }

  if (!payload.success) {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const firstError = errors.find((item): item is { code?: string; message: string; field?: string } => isRecord(item) && typeof item.message === 'string');
    const error: ApiError = {
      code: (firstError?.code as ApiError['code']) ?? 'business_error',
      message: firstError?.message ?? 'Business request failed',
      detail: payload,
      traceId: typeof payload.trace_id === 'string' ? payload.trace_id : undefined,
    };
    throw new HttpClientError(error);
  }

  return payload.data as T;
}

export function parsePage<T>(payload: unknown, itemParser: (value: unknown) => T): Page<T> {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new HttpClientError({ code: 'parse_error', message: 'Invalid page response', detail: payload });
  }

  const page = Number(payload.page);
  const pageSize = Number(payload.page_size);
  const total = Number(payload.total);
  if (!Number.isFinite(page) || !Number.isFinite(pageSize) || !Number.isFinite(total)) {
    throw new HttpClientError({ code: 'parse_error', message: 'Invalid page response', detail: payload });
  }

  return {
    items: payload.items.map(itemParser),
    page,
    page_size: pageSize,
    total,
  };
}
