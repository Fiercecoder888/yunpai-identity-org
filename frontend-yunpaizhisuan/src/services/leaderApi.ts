import {
  leaderTodayTaskSchema,
  productionTeamSchema,
  teamMemberSchema,
  workerOrderBindingSchema,
  workloadComparisonSchema,
  workloadLedgerSchema,
  workloadQuerySchema,
  workerTaskSchema,
  type LeaderTodayTask,
  type ProductionTeam,
  type TeamMember,
  type WorkerOrderBinding,
  type WorkloadComparison,
  type WorkloadLedger,
  type WorkloadQuery,
  type WorkerTask,
} from '../schemas/leader';
import { withQuery } from './apiGateway';
import { unwrapEnvelope } from './apiResponse';
import { requestJson } from './httpClient';

export type LeaderReportPayload = {
  plan_version: string;
  order_id: string;
  operation_id: string;
  resource_id: string;
  team_id: string;
  leader_user_id: string;
  worker_id: string;
  station?: string;
  event_type: 'actual_start' | 'actual_finish' | 'quantity_report' | 'exception' | 'scrap' | 'pause' | 'resume';
  occurred_at?: string;
  actual_start_time?: string;
  actual_end_time?: string;
  reported_quantity?: number;
  reported_unit?: string;
  scrap_quantity?: number;
  status?: 'running' | 'completed' | 'paused' | 'exception' | 'scrapped';
  reason?: string;
  shift_date?: string;
  planned_min?: number;
  actual_min?: number;
  external_ref?: string;
  idempotency_key?: string;
  params?: Record<string, unknown>;
};

export type WorkloadQueryParams = {
  team_id?: string;
  shift_date?: string;
  date_from?: string;
  date_to?: string;
  order_id?: string;
  worker_id?: string;
  leader_user_id?: string;
  limit?: number;
  offset?: number;
};

export async function listLeaderTeams(leaderUserId?: string): Promise<ProductionTeam[]> {
  const response = await requestJson<unknown>(
    withQuery('/m5/leader/teams', leaderUserId ? { leader_user_id: leaderUserId } : {}),
  );
  const data = unwrapEnvelope<unknown>(response);
  return Array.isArray(data) ? data.map((item) => productionTeamSchema.parse(item)) : [];
}

export async function createLeaderTeam(payload: {
  team_code: string;
  team_name: string;
  leader_user_id: string;
  line_id?: string;
  resource_ids?: string[];
  shift_rule?: Record<string, unknown>;
}) {
  const response = await requestJson<unknown>('/m5/leader/teams', { method: 'POST', body: payload });
  return productionTeamSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getLeaderTeam(teamId: string): Promise<ProductionTeam> {
  const response = await requestJson<unknown>(`/m5/leader/teams/${encodeURIComponent(teamId)}`);
  return productionTeamSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function listLeaderTeamMembers(teamId: string): Promise<TeamMember[]> {
  const response = await requestJson<unknown>(`/m5/leader/teams/${encodeURIComponent(teamId)}/members`);
  const data = unwrapEnvelope<unknown>(response);
  return Array.isArray(data) ? data.map((item) => teamMemberSchema.parse(item)) : [];
}

export async function addLeaderTeamMember(
  teamId: string,
  payload: { worker_id: string; worker_name: string; station?: string; role?: string },
): Promise<TeamMember> {
  const response = await requestJson<unknown>(`/m5/leader/teams/${encodeURIComponent(teamId)}/members`, {
    method: 'POST',
    body: payload,
  });
  return teamMemberSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getLeaderTodayTasks(leaderUserId: string, day: string): Promise<LeaderTodayTask[]> {
  const response = await requestJson<unknown>(
    withQuery('/m5/leader/today-tasks', { leader_user_id: leaderUserId, day }),
  );
  const data = unwrapEnvelope<unknown>(response);
  return Array.isArray(data) ? data.map((item) => leaderTodayTaskSchema.parse(item)) : [];
}

export async function reportLeaderWork(
  payload: LeaderReportPayload,
  taskId?: string,
  path = '/m5/leader/report',
): Promise<WorkloadLedger> {
  const response = await requestJson<unknown>(path, {
    method: 'POST',
    body: payload,
    headers: taskId ? { 'X-Yunpai-Task-ID': taskId } : undefined,
  });
  return workloadLedgerSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function queryWorkload(params: WorkloadQueryParams = {}): Promise<WorkloadQuery> {
  const response = await requestJson<unknown>(withQuery('/m5/leader/workload', params));
  return workloadQuerySchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getWorkloadComparison(params: {
  team_id: string;
  date_from: string;
  date_to: string;
  leader_user_id?: string;
}): Promise<WorkloadComparison> {
  const response = await requestJson<unknown>(withQuery('/m5/leader/workload/comparison', params));
  return workloadComparisonSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function getOrderWorkload(orderId: string): Promise<WorkloadQuery> {
  const response = await requestJson<unknown>(withQuery('/m5/leader/orders/workload', { order_id: orderId }));
  return workloadQuerySchema.parse(unwrapEnvelope<unknown>(response));
}


export type WorkerOrderBindingCreatePayload = {
  order_id: string;
  worker_ids: string[];
  team_id: string;
  resource_id?: string;
  station?: string;
};

export type WorkerReportPayload = {
  worker_id: string;
  plan_version: string;
  order_id: string;
  /** 明确绑定已发布计划中的工序，避免多工序订单报工错位。 */
  operation_id: string;
  resource_id: string;
  /** 工位展示值；业务锚点仍以 resource_id 为准。 */
  station?: string;
  event_type: 'actual_start' | 'actual_finish' | 'quantity_report' | 'scrap' | 'exception';
  reported_quantity?: number;
  reported_unit?: string;
  scrap_quantity?: number;
  actual_min?: number;
  shift_date?: string;
  reason?: string;
  idempotency_key: string;
};

export async function listWorkerTasks(workerId: string): Promise<WorkerTask[]> {
  const response = await requestJson<unknown>(
    withQuery('/m5/worker/tasks', { worker_id: workerId }),
  );
  const data = unwrapEnvelope<unknown>(response);
  return Array.isArray(data) ? data.map((item) => workerTaskSchema.parse(item)) : [];
}

export async function listOrderBindings(params: {
  order_id?: string;
  team_id?: string;
  worker_id?: string;
} = {}): Promise<WorkerOrderBinding[]> {
  const response = await requestJson<unknown>(withQuery('/m5/leader/bindings', params));
  const data = unwrapEnvelope<unknown>(response);
  return Array.isArray(data) ? data.map((item) => workerOrderBindingSchema.parse(item)) : [];
}

export async function bindWorkersToOrder(payload: WorkerOrderBindingCreatePayload): Promise<WorkerOrderBinding[]> {
  const response = await requestJson<unknown>('/m5/leader/bindings', { method: 'POST', body: payload });
  const data = unwrapEnvelope<unknown>(response);
  return Array.isArray(data) ? data.map((item) => workerOrderBindingSchema.parse(item)) : [];
}

export async function unbindWorkerFromOrder(bindingId: string): Promise<WorkerOrderBinding> {
  const response = await requestJson<unknown>(`/m5/leader/bindings/${encodeURIComponent(bindingId)}`, {
    method: 'DELETE',
  });
  return workerOrderBindingSchema.parse(unwrapEnvelope<unknown>(response));
}

export async function reportWorkerWork(payload: WorkerReportPayload, taskId?: string): Promise<WorkloadLedger> {
  const response = await requestJson<unknown>('/m5/worker/report', {
    method: 'POST',
    body: payload,
    headers: taskId ? { 'X-Yunpai-Task-ID': taskId } : undefined,
  });
  return workloadLedgerSchema.parse(unwrapEnvelope<unknown>(response));
}

export type WorkerOrderOperation = {
  order_id: string;
  operation_id: string;
  operation_name: string;
  resource_id: string;
  plan_version: string;
  start_time: string | null;
};

/** 订单已发布计划的工位/工序列表（工人报工时选择具体工位）。 */
export async function listWorkerOrderOperations(orderId: string): Promise<WorkerOrderOperation[]> {
  const response = await requestJson<unknown>(withQuery('/m5/worker/order-operations', { order_id: orderId }));
  const data = unwrapEnvelope<unknown>(response) as { items?: WorkerOrderOperation[] };
  return data?.items ?? [];
}
