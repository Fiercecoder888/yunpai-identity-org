import { scheduleAdjustmentSchema, scheduleEventSchema, type ScheduleAdjustment, type ScheduleEvent } from '../schemas/schedule';
import type { ScheduleBoard, ScheduleDependency, ScheduleTask } from '../types/api';
import { unwrapEnvelope } from './apiResponse';
import { withQuery } from './apiGateway';
import { requestJson } from './httpClient';
import { adaptM5OperationToTask, adaptM5ScheduleToBoard, getM5Schedule, listM5Schedules, updateM5Operation } from './m5Api';

export async function getScheduleBoard(): Promise<ScheduleBoard> {
  const schedules = await listM5Schedules();
  const head = schedules[0];
  const planVersion = head?.plan_version;
  if (!planVersion) {
    return { resources: [], tasks: [], conflicts: [] };
  }
  const schedule = await getM5Schedule(planVersion);
  const board = adaptM5ScheduleToBoard(schedule);
  return {
    ...board,
    planVersion,
    // 详情接口可能不返回生命周期（兼容 board 形态），以列表 head 为准补全，
    // 让甘特页始终能看到最新计划的 draft/approved/released 状态。
    lifecycleStatus: board.lifecycleStatus ?? head.lifecycle_status,
    validationPassed: board.validationPassed ?? head.validation_passed,
    scenarioPurpose: board.scenarioPurpose ?? head.scenario_purpose,
    approvedAt: board.approvedAt ?? head.approved_at,
    releasedAt: board.releasedAt ?? head.released_at,
    trackingTaskId: head.tracking_task_id ?? undefined,
  };
}

export async function adjustScheduleTask(payload: ScheduleAdjustment): Promise<ScheduleTask> {
  const validPayload = scheduleAdjustmentSchema.parse(payload);
  const planVersion = validPayload.planVersion;
  const orderId = validPayload.orderId ?? validPayload.taskId;
  const operationId = validPayload.operationId ?? validPayload.taskId;
  if (!planVersion) {
    throw new Error('排程调整缺少计划版本：无法定位当前 head 下的工序');
  }
  const response = await updateM5Operation(planVersion, orderId, operationId, {
    reason: validPayload.reason,
    start_time: validPayload.startAt,
    end_time: validPayload.endAt,
    lock_after_adjust: false,
  });
  return adaptM5OperationToTask(response);
}

const isScheduleDependency = (value: unknown): value is ScheduleDependency => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.predecessorId === 'string' &&
    typeof candidate.successorId === 'string' &&
    (candidate.type === 'finish_to_start' || candidate.type === 'start_to_start') &&
    typeof candidate.lagDays === 'number'
  );
};

const normalizeScheduleDependencies = (payload: unknown): ScheduleDependency[] =>
  Array.isArray(payload) ? payload.filter(isScheduleDependency) : [];

export async function getScheduleDependencies(): Promise<ScheduleDependency[]> {
  // M5 尚未交付 /schedules/{plan_version}/dependencies 端点。前端真实请求该端点，
  // 失败或字段不符时兜底返回空数组（生产不伪造依赖），由 UI 展示「依赖端点未提供」。
  try {
    const schedules = await listM5Schedules();
    const planVersion = schedules[0]?.plan_version;
    if (!planVersion) {
      return [];
    }
    const response = await requestJson<unknown>(`/m5/schedules/${encodeURIComponent(planVersion)}/dependencies`);
    return normalizeScheduleDependencies(unwrapEnvelope<unknown>(response));
  } catch {
    return [];
  }
}

/** 计划事件时间线（B2R-E1 只读）：按事件发生时间倒序返回。 */
export async function getScheduleEvents(
  planVersion: string,
  limit = 50,
): Promise<ScheduleEvent[]> {
  const response = await requestJson<unknown>(
    withQuery(`/m5/schedules/${encodeURIComponent(planVersion)}/events`, { limit }),
  );
  const data = unwrapEnvelope<unknown>(response);
  return Array.isArray(data) ? data.map((item) => scheduleEventSchema.parse(item)) : [];
}

export type ReplanFromVersionPayload = {
  idempotency_key: string;
  expected_head_plan_version?: string;
  event: {
    event_id: string;
    sequence: number;
    occurred_at: string;
    event_type:
      | 'insert_order'
      | 'equipment_down'
      | 'material_shortage'
      | 'material_delay'
      | 'material_supply_update'
      | 'labor_shortage'
      | 'order_cancel'
      | 'manual_lock'
      | 'capacity_change';
    source: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    payload?: Record<string, unknown>;
  };
  freeze_policy?: {
    enabled: boolean;
    horizon_minutes: number;
    locked_by: string;
    reason: string;
  };
};

/** 从不可变版本重排（B2R-V2）：生成新子版本并返回 diff / 重验信息。 */
export async function replanFromVersion(
  basePlanVersion: string,
  payload: ReplanFromVersionPayload,
  taskId?: string,
): Promise<unknown> {
  const response = await requestJson<unknown>(
    `/m5/schedules/${encodeURIComponent(basePlanVersion)}/replan-from-version`,
    {
      method: 'POST',
      body: payload,
      headers: taskId ? { 'X-Yunpai-Task-ID': taskId } : undefined,
    },
  );
  return unwrapEnvelope<unknown>(response);
}
