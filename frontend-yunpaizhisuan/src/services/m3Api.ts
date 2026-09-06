import {
  m3ApprovalTaskSchema,
  m3MaterialReadinessSchema,
  m3OrderSchema,
  m3PrPoDraftSchema,
  m3ProcurementPlanSchema,
} from '../schemas/m3';
import { unwrapEnvelope, type ApiEnvelope } from './apiResponse';
import { withQuery } from './apiGateway';
import { requestJson } from './httpClient';
import type { z } from 'zod';

const parseEnvelope = <T>(payload: unknown, schema: z.ZodType<T>) => schema.parse(unwrapEnvelope<unknown>(payload));
const parseApprovalTask = (payload: unknown) => {
  const result = unwrapEnvelope<Record<string, unknown>>(payload);
  return m3ApprovalTaskSchema.parse(result.task ?? result);
};
const parseProcurementPlanList = (payload: unknown) => {
  const result = unwrapEnvelope<unknown>(payload);
  return Array.isArray(result)
    ? m3ProcurementPlanSchema.array().parse(result)
    : [m3ProcurementPlanSchema.parse(result)];
};
type M3OrderScopedQuery = Record<string, string | number | undefined>;
const orderScopedQuery = (orderIdOrParams: string | M3OrderScopedQuery): M3OrderScopedQuery =>
  typeof orderIdOrParams === 'string' ? { order_id: orderIdOrParams } : orderIdOrParams;

export type M3RunOptions = {
  /** Reuse an existing root TaskID unchanged; omit only for a new standalone M3 run. */
  trackingTaskId?: string;
};

export const createM3TrackingTaskId = () => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `task_${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
};

const m3TrackingHeaders = (options: M3RunOptions = {}) => {
  const trackingTaskId = options.trackingTaskId ?? createM3TrackingTaskId();
  if (!trackingTaskId.trim() || trackingTaskId.length > 80) {
    throw new Error('M3 procurement run requires a non-empty X-Yunpai-Task-ID of at most 80 characters');
  }
  return { 'X-Yunpai-Task-ID': trackingTaskId };
};

export type M3PersistedPlanSummary = {
  procurement_plan_id: string;
  order_id: string;
  project_id: string;
  bom_id?: string;
  plan_version: string;
  status: string;
  availability_status: string;
  line_count: number;
  shortage_count: number;
  trace_id?: string;
  source_type?: string;
  created_at: string;
};

export async function listPersistedM3Plans(
  params: { tenantId?: string; page?: number; pageSize?: number } = {},
): Promise<M3PersistedPlanSummary[]> {
  const response = await requestJson<unknown>(
    withQuery('/m3/persisted/procurement-plans', {
      tenant_id: params.tenantId ?? '',
      page: params.page ?? 1,
      page_size: params.pageSize ?? 50,
    }),
  );
  const payload = unwrapEnvelope<{ items?: M3PersistedPlanSummary[] }>(response);
  return payload.items ?? [];
}

export function listM3Orders(params: Record<string, string | number | undefined> = {}) {
  return requestJson<unknown>(withQuery('/m3/orders', params)).then((response) => parseEnvelope(response, m3OrderSchema.array()));
}

export function getM3Order(orderId: string) {
  return requestJson<unknown>(`/m3/orders/${orderId}`).then((response) => parseEnvelope(response, m3OrderSchema));
}

export function runM3ProcurementRequirements(payload: unknown, options: M3RunOptions = {}) {
  return requestJson<unknown>('/m3/procurement-requirements:run-json', {
    method: 'POST',
    headers: m3TrackingHeaders(options),
    body: payload,
  }).then((response) => parseEnvelope(response, m3ProcurementPlanSchema));
}

export function runM3ProcurementRequirementsEnvelope(payload: unknown, options: M3RunOptions = {}) {
  return requestJson<ApiEnvelope<Record<string, unknown>>>('/m3/procurement-requirements:run-json', {
    method: 'POST',
    headers: m3TrackingHeaders(options),
    body: payload,
  });
}

/** @deprecated Legacy aggregated M3 contract. Use runM3ProcurementRequirements. */
export function runM3ProcurementPlanJson(
  payload: unknown,
  options: { useDemoSupplements?: boolean; expandBom?: boolean } = {},
) {
  return requestJson<unknown>(
    withQuery('/m3/procurement-plan:run-json', {
      use_demo_supplements: options.useDemoSupplements,
      expand_bom: options.expandBom,
    }),
    { method: 'POST', body: payload },
  ).then((response) => parseEnvelope(response, m3ProcurementPlanSchema));
}

/** @deprecated Legacy order-based M3 contract. */
export function runM3ProcurementPlan(orderId: string) {
  return requestJson<unknown>('/m3/procurement-plan:run', {
    method: 'POST',
    body: { order_id: orderId },
  }).then((response) => {
    const plan = unwrapEnvelope<Record<string, unknown>>(response);
    const envelope = response as { approval_tasks?: unknown[] };
    return { ...plan, approval_tasks: envelope.approval_tasks ?? [] };
  });
}

export function listM3ProcurementPlans(orderId: string, params: Record<string, string | number | undefined> = {}) {
  return requestJson<unknown>(withQuery('/m3/procurement-plan', { order_id: orderId, ...params })).then(parseProcurementPlanList);
}

export function getM3ProcurementPlan(planId: string) {
  return requestJson<unknown>(`/m3/procurement-plan/${planId}`).then((response) => parseEnvelope(response, m3ProcurementPlanSchema));
}

export function listM3ApprovalTasks(params: Record<string, string | number | undefined> = {}) {
  return requestJson<unknown>(withQuery('/m3/approval-tasks', params)).then((response) =>
    parseEnvelope(response, m3ApprovalTaskSchema.array()),
  );
}

export function approveM3ApprovalTask(taskId: string, payload: unknown = {}) {
  return requestJson<unknown>(`/m3/approval-tasks/${taskId}:approve`, { method: 'POST', body: payload }).then(parseApprovalTask);
}

export function rejectM3ApprovalTask(taskId: string, payload: unknown = {}) {
  return requestJson<unknown>(`/m3/approval-tasks/${taskId}:reject`, { method: 'POST', body: payload }).then(parseApprovalTask);
}

export function requestChangeM3ApprovalTask(taskId: string, payload: unknown = {}) {
  return requestJson<unknown>(`/m3/approval-tasks/${taskId}:request-change`, { method: 'POST', body: payload }).then(parseApprovalTask);
}

export function approveM3ApprovalTaskToSend(taskId: string, payload: unknown = {}) {
  return requestJson<unknown>(`/m3/approval-tasks/${taskId}:approve_to_send`, { method: 'POST', body: payload }).then(parseApprovalTask);
}

export function getM3MaterialReadiness(orderId: string) {
  const normalizedOrderId = typeof orderId === 'string' ? orderId.trim() : '';
  if (!normalizedOrderId) {
    throw new Error('M3 material readiness requires a non-empty orderId');
  }
  return requestJson<unknown>(withQuery('/m3/material-readiness', { order_id: normalizedOrderId })).then((response) =>
    parseEnvelope(response, m3MaterialReadinessSchema),
  );
}

export function getM3PrPoDrafts(orderIdOrParams: string | M3OrderScopedQuery = {}) {
  return requestJson<unknown>(withQuery('/m3/pr-po-drafts', orderScopedQuery(orderIdOrParams))).then((response) =>
    parseEnvelope(response, m3PrPoDraftSchema),
  );
}

export function handoffM3PlanToM4(planId: string, payload: unknown = {}) {
  return requestJson<unknown>(`/m3/procurement-plan/${planId}/handoff-to-m4`, { method: 'POST', body: payload }).then((response) =>
    unwrapEnvelope<unknown>(response),
  );
}

export function exportM3ProcurementSuggestions(planId: string) {
  return requestJson<unknown>(`/m3/procurement-plan/${planId}/export-suggestions`).then((response) => unwrapEnvelope(response));
}
