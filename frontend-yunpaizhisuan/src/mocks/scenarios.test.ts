import { describe, expect, it } from 'vitest';
import { createAuditLog } from '../services/auditLogger';
import { getAuditLogs, writeAuditLog } from '../services/auditApi';
import { listM4Alerts } from '../services/m4Api';
import { unwrapEnvelope } from '../services/apiResponse';
import { requestJson } from '../services/httpClient';
import type { DashboardSummary, ScheduleBoard } from '../types/api';
import { setServerMockScenario } from './server';

describe('mock scenarios', () => {
  it('returns shaped empty payloads for dashboard and schedule', async () => {
    setServerMockScenario('empty');

    await expect(requestJson<DashboardSummary>('/dashboard/summary')).resolves.toEqual({
      modules: [],
      activities: [],
      risks: [],
    });
    const schedule = unwrapEnvelope<ScheduleBoard>(await requestJson<unknown>('/m5/schedules/current'));
    expect(schedule).toEqual({
      resources: [],
      tasks: [],
      conflicts: [],
    });
  });

  it('normalizes error scenario responses', async () => {
    setServerMockScenario('error');

    await expect(requestJson('/dashboard/summary')).rejects.toMatchObject({
      error: { code: 'server_error', status: 500 },
    });
  });

  it('blocks protected APIs but keeps audit logs readable in permission denied scenario', async () => {
    setServerMockScenario('permissionDenied');

    await expect(requestJson('/dashboard/summary')).rejects.toMatchObject({
      error: { code: 'forbidden', status: 403 },
    });

    await writeAuditLog(
      createAuditLog({
        actor: '审计只读员',
        action: 'PERMISSION_DENIED',
        module: 'Dashboard',
        targetId: 'dashboard',
        result: 'blocked',
        detail: '访问 Dashboard 操作权限不足',
      }),
    );

    await expect(getAuditLogs()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'PERMISSION_DENIED',
          module: 'Dashboard',
          result: 'blocked',
        }),
      ]),
    );
  });

  it('supports timeout scenario with client timeout normalization', async () => {
    setServerMockScenario('timeout');

    await expect(requestJson('/dashboard/summary', { timeoutMs: 5 })).rejects.toMatchObject({
      error: { code: 'timeout' },
    });
  });

  it('supports M4 normal, empty, error, permission denied and timeout scenarios', async () => {
    setServerMockScenario('normal');
    const normalAlerts = await listM4Alerts();
    expect(normalAlerts.total).toBe(3);
    expect(normalAlerts.items).toEqual(expect.arrayContaining([expect.objectContaining({ purchase_order_no: 'PO-20260703-001' })]));

    setServerMockScenario('empty');
    await expect(listM4Alerts()).resolves.toEqual({ items: [], page: 1, page_size: 20, total: 0 });

    setServerMockScenario('error');
    await expect(listM4Alerts()).rejects.toMatchObject({
      error: { code: 'server_error', status: 500 },
    });

    setServerMockScenario('permissionDenied');
    await expect(listM4Alerts()).rejects.toMatchObject({
      error: { code: 'forbidden', status: 403 },
    });

    setServerMockScenario('timeout');
    await expect(requestJson('/m4/alerts', { timeoutMs: 5 })).rejects.toMatchObject({
      error: { code: 'timeout' },
    });
  });
});
