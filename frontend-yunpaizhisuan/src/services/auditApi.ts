import { auditLogListSchema } from '../schemas/audit';
import { isNotImplementedResponse, requestJson } from './httpClient';
import type { AuditLogItem } from '../types/api';

const LOCAL_AUDIT_LOG_KEY = 'yunpai.audit.logs';

type M1TaskPayload = {
  task_id?: string;
  id?: string;
  filename?: string;
  status?: string;
  needs_review?: boolean;
  updated_at?: string;
  created_at?: string;
};

const readLocalAuditLogs = (): AuditLogItem[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(LOCAL_AUDIT_LOG_KEY);
    return stored ? auditLogListSchema.parse(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
};

const storeLocalAuditLogs = (logs: AuditLogItem[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LOCAL_AUDIT_LOG_KEY, JSON.stringify(logs));
  } catch {
    // The page can still use the current in-memory result when storage is unavailable.
  }
};

const toM1AuditLog = (task: M1TaskPayload, index: number): AuditLogItem => {
  const targetId = task.task_id ?? task.id ?? `m1-task-${index + 1}`;
  const status = task.needs_review ? 'needs_review' : task.status?.toLowerCase();
  const filename = task.filename ?? targetId;

  if (status === 'needs_review' || status === 'need_review') {
    return {
      id: `M1-${targetId}-review`,
      time: task.updated_at ?? task.created_at ?? new Date(0).toISOString(),
      actor: 'M1 服务',
      action: 'M1_REVIEW_REQUIRED',
      module: 'M1',
      targetId,
      result: 'blocked',
      detail: `文档 ${filename} 需要人工复核`,
    };
  }
  if (status === 'failed' || status === 'error') {
    return {
      id: `M1-${targetId}-failed`,
      time: task.updated_at ?? task.created_at ?? new Date(0).toISOString(),
      actor: 'M1 服务',
      action: 'M1_TASK_FAILED',
      module: 'M1',
      targetId,
      result: 'failed',
      detail: `文档 ${filename} 识别失败`,
    };
  }
  if (status === 'done' || status === 'completed' || status === 'success') {
    return {
      id: `M1-${targetId}-completed`,
      time: task.updated_at ?? task.created_at ?? new Date(0).toISOString(),
      actor: 'M1 服务',
      action: 'M1_TASK_COMPLETED',
      module: 'M1',
      targetId,
      result: 'success',
      detail: `文档 ${filename} 识别完成`,
    };
  }
  return {
    id: `M1-${targetId}-updated`,
    time: task.updated_at ?? task.created_at ?? new Date(0).toISOString(),
    actor: 'M1 服务',
    action: 'M1_TASK_UPDATED',
    module: 'M1',
    targetId,
    result: 'success',
    detail: `文档 ${filename} 当前状态：${status ?? 'unknown'}`,
  };
};

const mergeAuditLogs = (...groups: AuditLogItem[][]) => {
  const byId = new Map<string, AuditLogItem>();
  groups.flat().forEach((log) => byId.set(log.id, log));
  return [...byId.values()].sort((left, right) => Date.parse(right.time) - Date.parse(left.time));
};

export async function getAuditLogs() {
  try {
    const payload = await requestJson<unknown>('/audit/logs');
    return auditLogListSchema.parse(payload) as AuditLogItem[];
  } catch (error) {
    if (!isNotImplementedResponse(error)) {
      throw error;
    }
  }

  const localLogs = readLocalAuditLogs();
  try {
    const payload = await requestJson<unknown>('/m0/parser-compat/tasks');
    const m1Logs = Array.isArray(payload) ? payload.map((task, index) => toM1AuditLog(task as M1TaskPayload, index)) : [];
    return mergeAuditLogs(localLogs, m1Logs);
  } catch {
    return localLogs;
  }
}

export async function writeAuditLog(log: AuditLogItem) {
  try {
    return await requestJson<AuditLogItem>('/audit/logs', {
      method: 'POST',
      body: log,
    });
  } catch (error) {
    if (!isNotImplementedResponse(error)) {
      throw error;
    }
  }

  storeLocalAuditLogs(mergeAuditLogs(readLocalAuditLogs(), [log]));
  return log;
}
