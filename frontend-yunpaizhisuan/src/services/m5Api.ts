import {
  m5FlowDashboardSchema,
  m5ExecutionSummarySchema,
  m5JobSchema,
  m5PmcProgressSchema,
  m5ScheduleListSchema,
  m5ScheduleOperationSchema,
  m5ScheduleSchema,
  type M5ExecutionSummary,
  type M5PmcProgress,
  type M5Schedule,
} from '../schemas/m5';
import type { ScheduleBoard, ScheduleDependency, ScheduleTask } from '../types/api';
import { withQuery } from './apiGateway';
import { unwrapEnvelope } from './apiResponse';
import { requestJson } from './httpClient';

const scheduleStatuses = ['draft', 'solving', 'solved', 'conflict', 'adjusted', 'published'] as const;
type ScheduleStatus = (typeof scheduleStatuses)[number];
const dayMs = 24 * 60 * 60 * 1000;

const isScheduleBoard = (value: unknown): value is ScheduleBoard => {
  const candidate = value as Partial<ScheduleBoard>;
  return Array.isArray(candidate.resources) && Array.isArray(candidate.tasks) && Array.isArray(candidate.conflicts);
};

const toScheduleStatus = (status: string | undefined): ScheduleStatus => {
  if (scheduleStatuses.includes(status as ScheduleStatus)) {
    return status as ScheduleStatus;
  }
  if (status === 'scheduled') {
    return 'solved';
  }
  if (status === 'locked' || status === 'wip') {
    return 'adjusted';
  }
  return 'solving';
};

const parseTime = (value: string | undefined) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : undefined;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
};

const toOptionalBoolean = (value: unknown): boolean | undefined => {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  return undefined;
};

export function adaptM5ScheduleToBoard(schedule: unknown): ScheduleBoard {
  if (isScheduleBoard(schedule)) {
    return schedule;
  }

  const parsed = m5ScheduleSchema.parse(schedule);
  const operations = parsed.operations ?? [];
  const resourcesById = new Map<string, { id: string; name: string }>();
  const timelineStartMs = operations
    .map((operation) => parseTime(operation.start_time))
    .filter((value): value is number => value !== undefined)
    .reduce<number | undefined>((earliest, value) => (earliest === undefined || value < earliest ? value : earliest), undefined);
  const taskIdentityBases = operations.map((operation, index) => {
    const operationId = operation.operation_id ?? operation.id ?? `operation-${index + 1}`;
    return operation.order_id ? `${operation.order_id}::${operationId}` : operationId;
  });
  const baseIdentityCounts = new Map<string, number>();
  for (const identity of taskIdentityBases) {
    baseIdentityCounts.set(identity, (baseIdentityCounts.get(identity) ?? 0) + 1);
  }
  const resourceIdentities = operations.map((operation, index) => {
    const base = taskIdentityBases[index]!;
    if ((baseIdentityCounts.get(base) ?? 0) === 1) return base;
    const resourceId = operation.resource_id ?? operation.resource_name ?? 'unassigned';
    return `${base}::${resourceId}`;
  });
  const resourceIdentityCounts = new Map<string, number>();
  for (const identity of resourceIdentities) {
    resourceIdentityCounts.set(identity, (resourceIdentityCounts.get(identity) ?? 0) + 1);
  }
  const identityOccurrences = new Map<string, number>();
  const taskIds = operations.map((operation, index) => {
    const resourceIdentity = resourceIdentities[index]!;
    const evidenceIdentity = (resourceIdentityCounts.get(resourceIdentity) ?? 0) > 1
      ? `${resourceIdentity}::${operation.id ?? operation.start_time ?? operation.end_time ?? 'duplicate'}`
      : resourceIdentity;
    const occurrence = (identityOccurrences.get(evidenceIdentity) ?? 0) + 1;
    identityOccurrences.set(evidenceIdentity, occurrence);
    return occurrence === 1 ? evidenceIdentity : `${evidenceIdentity}::${occurrence}`;
  });
  const tasks: ScheduleTask[] = operations.map((operation, index) => {
    const id = taskIds[index]!;
    const resourceId = operation.resource_id ?? operation.resource_name ?? 'unassigned';
    const startMs = parseTime(operation.start_time);
    const endMs = parseTime(operation.end_time);
    const actualStartMs = parseTime(operation.actual_start_time);
    const actualEndMs = parseTime(operation.actual_end_time);
    const actualStartDay =
      actualStartMs !== undefined && timelineStartMs !== undefined ? Math.floor((actualStartMs - timelineStartMs) / dayMs) : toOptionalNumber(operation.actual_start_day);
    const actualDurationDays =
      actualStartMs !== undefined
        ? Math.max(1, Math.ceil(((actualEndMs ?? Date.now()) - actualStartMs) / dayMs))
        : toOptionalNumber(operation.actual_duration_days);
    resourcesById.set(resourceId, { id: resourceId, name: operation.resource_name ?? resourceId });
    return {
      id,
      title: operation.title ?? operation.operation_name ?? id,
      resourceId,
      startDay: startMs !== undefined && timelineStartMs !== undefined ? Math.max(0, Math.floor((startMs - timelineStartMs) / dayMs)) : operation.start_day ?? 0,
      durationDays:
        startMs !== undefined && endMs !== undefined ? Math.max(1, Math.ceil((endMs - startMs) / dayMs)) : operation.duration_days ?? 1,
      status: toScheduleStatus(operation.status),
      rawStatus: operation.status,
      planVersion: operation.plan_version ?? parsed.plan_version,
      orderId: operation.order_id,
      operationId: operation.operation_id ?? id,
      // 透传原始精确时间，供拖拽平移保持小时级精度。
      startAt: operation.start_time,
      endAt: operation.end_time,
      actualStartDay,
      actualDurationDays,
      actualStartAt: operation.actual_start_time,
      actualEndAt: operation.actual_end_time,
      actualQty: operation.actual_qty,
      actualStatus: operation.actual_status,
      critical: toOptionalBoolean(operation.critical ?? operation.is_critical),
      workHours: toOptionalNumber(operation.work_hours),
    };
  });

  return {
    resources: parsed.resources ?? Array.from(resourcesById.values()),
    tasks,
    conflicts: isScheduleBoard(parsed) ? parsed.conflicts : [],
    timelineStart: timelineStartMs === undefined ? undefined : new Date(timelineStartMs).toISOString(),
    lifecycleStatus: parsed.lifecycle_status,
    validationPassed: parsed.validation_passed,
    scenarioPurpose: parsed.scenario_purpose,
    planVersion: parsed.plan_version,
    approvedAt: parsed.approved_at,
    releasedAt: parsed.released_at,
  };
}

export function adaptM5OperationToTask(operation: unknown): ScheduleTask {
  const response = operation as { operation?: unknown };
  const payload = response?.operation ?? operation;
  if (payload && typeof payload === 'object' && 'resourceId' in payload) {
    const source = payload as Record<string, unknown>;
    return {
      ...(payload as ScheduleTask),
      startAt:
        source.startAt !== undefined
          ? String(source.startAt)
          : source.start_time !== undefined
            ? String(source.start_time)
            : undefined,
      endAt:
        source.endAt !== undefined
          ? String(source.endAt)
          : source.end_time !== undefined
            ? String(source.end_time)
            : undefined,
      validationPassed: toOptionalBoolean(source.validation_passed),
    };
  }
  const parsed = m5ScheduleOperationSchema.parse(payload);
  const id = parsed.id ?? parsed.operation_id ?? 'operation';
  const startMs = parseTime(parsed.start_time);
  const endMs = parseTime(parsed.end_time);
  const actualStartMs = parseTime(parsed.actual_start_time);
  const actualEndMs = parseTime(parsed.actual_end_time);
  const hasTimeline = startMs !== undefined && endMs !== undefined;
  return {
    id,
    title: parsed.title ?? parsed.operation_name ?? id,
    resourceId: parsed.resource_id ?? parsed.resource_name ?? 'unassigned',
    startDay: parsed.start_day ?? 0,
    durationDays: parsed.duration_days ?? (hasTimeline ? Math.max(1, Math.ceil((endMs - startMs) / dayMs)) : 1),
    status: toScheduleStatus(parsed.status),
    rawStatus: parsed.status,
    planVersion: parsed.plan_version,
    orderId: parsed.order_id,
    operationId: parsed.operation_id ?? id,
    startAt: parsed.start_time,
    endAt: parsed.end_time,
    validationPassed: toOptionalBoolean((parsed as { validation_passed?: unknown }).validation_passed),
    actualStartDay: toOptionalNumber((parsed as { actual_start_day?: unknown }).actual_start_day),
    actualDurationDays:
      actualStartMs !== undefined
        ? Math.max(1, Math.ceil(((actualEndMs ?? Date.now()) - actualStartMs) / dayMs))
        : toOptionalNumber((parsed as { actual_duration_days?: unknown }).actual_duration_days),
    actualStartAt: parsed.actual_start_time,
    actualEndAt: parsed.actual_end_time,
    actualQty: parsed.actual_qty,
    actualStatus: parsed.actual_status,
    critical: toOptionalBoolean((parsed as { critical?: unknown; is_critical?: unknown }).critical ?? (parsed as { is_critical?: unknown }).is_critical),
    workHours: toOptionalNumber((parsed as { work_hours?: unknown }).work_hours),
  };
}

export async function createM5Schedule(payload: unknown) {
  const response = await requestJson<unknown>('/m5/schedules', { method: 'POST', body: payload });
  return m5ScheduleSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function listM5Schedules(params: { limit?: number } = {}) {
  const response = await requestJson<unknown>(withQuery('/m5/schedules', params));
  const parsed = m5ScheduleListSchema.parse(unwrapEnvelope<unknown>(response));
  return Array.isArray(parsed) ? parsed : parsed.items;
}

export async function getM5Schedule(planVersion: string): Promise<M5Schedule | ScheduleBoard> {
  const response = await requestJson<unknown>(`/m5/schedules/${planVersion}`);
  const payload = unwrapEnvelope<unknown>(response);
  return isScheduleBoard(payload) ? payload : m5ScheduleSchema.parse(payload);
}

export async function createM5IntelligentSchedule(payload: unknown) {
  const response = await requestJson<unknown>('/m5/schedules/intelligent', { method: 'POST', body: payload });
  return m5ScheduleSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function updateM5Operation(planVersion: string, orderId: string, operationId: string, payload: unknown) {
  const response = await requestJson<unknown>(`/m5/schedules/${planVersion}/operations/${orderId}/${operationId}`, {
    method: 'PATCH',
    body: payload,
  });
  return unwrapEnvelope<unknown>(response);
}

export async function lockM5Operation(planVersion: string, orderId: string, operationId: string, reason = '前端锁定') {
  const response = await requestJson<unknown>(`/m5/schedules/${planVersion}/operations/${orderId}/${operationId}/lock`, {
    method: 'POST',
    body: { reason },
  });
  return unwrapEnvelope<unknown>(response);
}

export async function unlockM5Operation(planVersion: string, orderId: string, operationId: string, reason = '前端解锁') {
  const response = await requestJson<unknown>(`/m5/schedules/${planVersion}/operations/${orderId}/${operationId}/unlock`, {
    method: 'POST',
    body: { reason },
  });
  return unwrapEnvelope<unknown>(response);
}

export async function dispatchM5Schedule(planVersion: string, payload: unknown) {
  const response = await requestJson<unknown>(`/m5/schedules/${planVersion}/dispatch`, { method: 'POST', body: payload });
  return unwrapEnvelope<unknown>(response);
}

export async function createM5ExecutionEvent(planVersion: string, payload: unknown) {
  const response = await requestJson<unknown>(`/m5/schedules/${planVersion}/execution-events`, { method: 'POST', body: payload });
  return unwrapEnvelope<unknown>(response);
}

export async function getM5ExecutionSummary(planVersion: string): Promise<M5ExecutionSummary> {
  const response = await requestJson<unknown>(`/m5/schedules/${planVersion}/execution-summary`);
  return m5ExecutionSummarySchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getM5PmcProgress(planVersion: string): Promise<M5PmcProgress> {
  const normalizedPlanVersion = planVersion.trim();
  if (!normalizedPlanVersion) {
    throw new Error('PMC 进度查询缺少计划版本');
  }
  const response = await requestJson<unknown>(withQuery('/m5/pmc/progress', {
    plan_version: normalizedPlanVersion,
  }));
  return m5PmcProgressSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function createM5ScheduleJob(payload: unknown) {
  const response = await requestJson<unknown>('/m5/schedules/jobs', { method: 'POST', body: payload });
  return m5JobSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getM5Job(jobId: string) {
  const response = await requestJson<unknown>(`/m5/ops/jobs/${jobId}`);
  return m5JobSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getM5FlowDashboard(params: {
  trackingTaskId?: string;
  planVersion?: string;
  limit?: number;
} = {}) {
  const response = await requestJson<unknown>(withQuery('/m5/ops/flow-dashboard', {
    tracking_task_id: params.trackingTaskId?.trim(),
    plan_version: params.planVersion?.trim(),
    limit: params.limit ?? 20,
  }));
  return m5FlowDashboardSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getM5SnapshotReadiness(scenarioId: string) {
  const response = await requestJson<unknown>(`/m5/integrations/snapshots/${scenarioId}/readiness`);
  return unwrapEnvelope<unknown>(response);
}

export async function createM5MaterialProcurementPlan(payload: unknown) {
  const response = await requestJson<unknown>('/m5/materials/procurement-plan', { method: 'POST', body: payload });
  return unwrapEnvelope<unknown>(response);
}

export async function submitScheduleFeedback(
  planVersion: string,
  action: 'approve' | 'reject' | 'release',
  reason: string,
  trackingTaskId?: string,
) {
  const response = await requestJson<unknown>(`/m5/schedules/${encodeURIComponent(planVersion)}/feedback`, {
    method: 'POST',
    body: { action, reason },
    ...(trackingTaskId ? { headers: { 'X-Yunpai-Task-ID': trackingTaskId } } : {}),
  });
  return unwrapEnvelope<unknown>(response);
}

export function getM5ScheduleDependencies(_planVersion?: string) {
  void _planVersion;
  return Promise.resolve<ScheduleDependency[]>([]);
}
