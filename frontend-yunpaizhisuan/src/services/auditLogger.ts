import { writeAuditLog } from './auditApi';
import type { AuditLogItem } from '../types/api';

export const AUDIT_LOG_SYNC_FAILURE_MESSAGE = '日志同步失败';

type AuditLogInput = Omit<AuditLogItem, 'id' | 'time' | 'actor'> & {
  actor?: string;
};

export const createAuditLog = ({ actor = 'demo-user', ...input }: AuditLogInput): AuditLogItem => ({
  id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  time: new Date().toISOString(),
  actor,
  ...input,
});

export async function writeAuditLogSafely(log: AuditLogItem) {
  try {
    const data = await writeAuditLog(log);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, error };
  }
}
