import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import type { AuditLogItem } from '../types/api';
import { getAuditLogs, writeAuditLog } from './auditApi';

describe('auditApi fallback', () => {
  it('stores and reads audit logs locally when the aggregate endpoint is not implemented', async () => {
    server.use(
      http.get('/api/audit/logs', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.post('/api/audit/logs', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.get('/api/m0/parser-compat/tasks', () => HttpResponse.json([])),
    );
    const log: AuditLogItem = {
      id: 'LOG-local-001',
      time: '2026-07-14T09:00:00Z',
      actor: 'demo-user',
      action: 'M3_TEST_STARTED',
      module: 'M3',
      targetId: 'm3-test-001',
      result: 'success',
      detail: '启动 M3 单模块测试',
    };

    await expect(writeAuditLog(log)).resolves.toEqual(log);
    await expect(getAuditLogs()).resolves.toEqual([log]);
  });
});
