import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuditLogs, writeAuditLog } from './auditApi';
import { getBomItems } from './bomApi';
import { getDashboardSummary } from './dashboardApi';
import { getAgentFlow } from './flowApi';
import { getLegalRisks } from './legalApi';
import { getM1ReviewItems, getM1Tasks } from './m1Api';
import { getModuleStatuses } from './moduleApi';
import { getPurchaseWarnings } from './purchaseApi';
import { getScheduleBoard, getScheduleDependencies } from './scheduleApi';
import { getSopSteps } from './sopApi';
import { getTasks } from './taskApi';

describe('service layer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads module statuses through MSW handlers', async () => {
    const statuses = await getModuleStatuses();

    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.some((item) => item.id === 'm1')).toBe(true);
  });

  it('loads task board data through taskApi', async () => {
    const tasks = await getTasks();

    expect(tasks[0]).toMatchObject({ id: 'T-1001' });
  });

  it('validates audit logs through Zod before returning them', async () => {
    const logs = await getAuditLogs();

    expect(logs[0]).toMatchObject({ action: 'M1_UPLOAD_CREATED' });
  });

  it('writes audit logs through the service boundary', async () => {
    const log = await writeAuditLog({
      id: 'LOG-TEST',
      time: '2026-06-26 18:05',
      actor: 'tester',
      action: 'TEST_ACTION',
      module: 'TEST',
      targetId: 'TARGET-1',
      result: 'success',
      detail: 'service test',
    });

    expect(log).toMatchObject({ id: 'LOG-TEST', action: 'TEST_ACTION' });
  });

  it('loads agent flow through flowApi and schema validation', async () => {
    const flow = await getAgentFlow();

    expect(flow.nodes.length).toBeGreaterThan(0);
    expect(flow.edges.length).toBeGreaterThan(0);
  });

  it('loads dashboard summary through dashboardApi', async () => {
    const summary = await getDashboardSummary();

    expect(summary.modules.map((item) => item.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(summary.modules.every((item) => item.status === 'normal')).toBe(true);
    expect(summary.risks).toEqual([]);
  });

  it('loads M1 tasks and review items through m1Api', async () => {
    await expect(getM1Tasks()).resolves.toHaveLength(2);
    await expect(getM1ReviewItems()).resolves.toHaveLength(2);
  });

  it('loads demo fixtures and the M5 schedule facade through services', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    vi.stubEnv('VITE_ENABLE_MSW', 'true');

    await expect(getBomItems()).resolves.toMatchObject({ source: 'api', items: expect.any(Array) });
    await expect(getSopSteps()).resolves.toMatchObject({ source: 'api', items: expect.any(Array) });
    await expect(getPurchaseWarnings()).resolves.toHaveLength(3);
    await expect(getLegalRisks()).resolves.toHaveLength(2);
    await expect(getScheduleBoard()).resolves.toMatchObject({ resources: expect.any(Array), tasks: expect.any(Array) });
    await expect(getScheduleDependencies()).resolves.toEqual([
      { id: 'DEP-1', predecessorId: 'SCH-1', successorId: 'SCH-2', type: 'finish_to_start', lagDays: 0 },
      { id: 'DEP-2', predecessorId: 'SCH-2', successorId: 'SCH-3', type: 'start_to_start', lagDays: 1 },
    ]);
  });
});
