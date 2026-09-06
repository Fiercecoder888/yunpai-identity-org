import { isNotImplementedResponse, requestJson } from './httpClient';
import type { TaskItem } from '../types/api';
import { withQuery } from './apiGateway';

export type AgentCode = 'm0' | 'm1' | 'm2' | 'm3' | 'm4' | 'm5';
export type AgentTaskReminderStatus = 'unread' | 'read' | 'dismissed';
export type AgentTaskReminderAction = 'read' | 'dismiss' | 'restore';

export type AgentTask = TaskItem & {
  agent: AgentCode;
  kind: 'business_flow_attention';
  business_status:
    | 'human_input_required'
    | 'blocked'
    | 'data_incomplete'
    | 'failed'
    | 'completed'
    | 'resolved'
    | 'skipped';
  reminder_status: AgentTaskReminderStatus;
  detail: string;
  tracking_task_id: string;
  run_id: string;
  order_id?: string | null;
  current_node: string;
  step_status: string;
  is_history: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  target: {
    type: 'business_flow';
    run_id: string;
    tracking_task_id: string;
    order_id?: string | null;
    section: 'human_gate';
  };
};

const AGENTS = new Set<AgentCode>(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
const BUSINESS_STATUSES = new Set<AgentTask['business_status']>([
  'human_input_required',
  'blocked',
  'data_incomplete',
  'failed',
  'completed',
  'resolved',
  'skipped',
]);
const REMINDER_STATUSES = new Set<AgentTaskReminderStatus>(['unread', 'read', 'dismissed']);

const isAgentTask = (value: unknown): value is AgentTask => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<AgentTask>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.run_id === 'string' &&
    typeof item.tracking_task_id === 'string' &&
    typeof item.current_node === 'string' &&
    typeof item.step_status === 'string' &&
    typeof item.is_history === 'boolean' &&
    AGENTS.has(item.agent as AgentCode) &&
    BUSINESS_STATUSES.has(item.business_status as AgentTask['business_status']) &&
    REMINDER_STATUSES.has(item.reminder_status as AgentTaskReminderStatus)
  );
};

type M1TaskPayload = {
  task_id?: string;
  id?: string;
  filename?: string;
  status?: string;
  needs_review?: boolean;
  updated_at?: string;
  created_at?: string;
};

const normalizeM1Status = (task: M1TaskPayload): Pick<TaskItem, 'status' | 'riskLevel'> => {
  const status = task.needs_review ? 'needs_review' : task.status?.toLowerCase();

  if (status === 'needs_review' || status === 'need_review') {
    return { status: 'need_review', riskLevel: 'high' };
  }
  if (status === 'failed' || status === 'error') {
    return { status: 'failed', riskLevel: 'high' };
  }
  if (status === 'done' || status === 'completed' || status === 'success') {
    return { status: 'completed', riskLevel: 'low' };
  }
  if (status === 'created' || status === 'queued' || status === 'pending') {
    return { status: 'pending', riskLevel: 'low' };
  }
  if (status === 'cancelled' || status === 'canceled') {
    return { status: 'cancelled', riskLevel: 'low' };
  }
  return { status: 'running', riskLevel: 'medium' };
};

const toTaskItem = (task: M1TaskPayload, index: number): TaskItem => {
  const id = task.task_id ?? task.id ?? `m1-task-${index + 1}`;
  const normalized = normalizeM1Status(task);

  const item: TaskItem = {
    id,
    title: `M0 文档解析：${task.filename ?? id}`,
    owner: normalized.status === 'need_review' ? 'M0 解析审核员' : 'M0 解析服务',
    ...normalized,
  };
  const updatedAt = task.updated_at ?? task.created_at;
  if (updatedAt) {
    item.updatedAt = updatedAt;
  }
  return item;
};

export async function getTasks() {
  try {
    const payload = await requestJson<unknown>('/tasks');
    if (Array.isArray(payload)) {
      return payload as TaskItem[];
    }
    return [];
  } catch (error) {
    if (!isNotImplementedResponse(error)) {
      throw error;
    }
  }

  const payload = await requestJson<unknown>('/m0/parser-compat/tasks');
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.map((task, index) => toTaskItem(task as M1TaskPayload, index));
}

export async function getAgentTasks(
  options: {
    agent?: AgentCode;
    includeDismissed?: boolean;
    includeHistory?: boolean;
    historyLimit?: number;
  } = {},
): Promise<AgentTask[]> {
  const payload = await requestJson<unknown>(
    withQuery('/orchestrator/tasks', {
      include_dismissed: options.includeDismissed ?? true,
      agent: options.agent,
      include_history: options.includeHistory,
      history_limit: options.includeHistory ? options.historyLimit ?? 100 : undefined,
    }),
  );
  if (!Array.isArray(payload)) return [];
  return payload.filter(isAgentTask);
}

export async function updateAgentTaskReminder(
  id: string,
  action: AgentTaskReminderAction,
): Promise<AgentTask> {
  const payload = await requestJson<unknown>(`/orchestrator/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { action },
  });
  if (!isAgentTask(payload)) {
    throw new Error('Agent task reminder response is invalid');
  }
  return payload;
}

export type TaskUpdatePayload = Partial<Pick<TaskItem, 'title' | 'owner' | 'status' | 'riskLevel' | 'updatedAt'>>;

export async function updateTask(id: string, payload: TaskUpdatePayload): Promise<TaskItem> {
  return requestJson<TaskItem>(`/tasks/${id}`, {
    method: 'PATCH',
    body: payload,
  });
}
