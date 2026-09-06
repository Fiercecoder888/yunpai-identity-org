import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { getWorkbenchActivities } from './activityApi';

const useHealthySources = () => {
  server.use(
    http.get('/api/audit/logs', () =>
      HttpResponse.json([
        { id: 'LOG-1', time: '2026-07-27T09:00:00Z', actor: 'tester', action: 'M1_TASK_COMPLETED', module: 'M1', targetId: 'T-1', result: 'success', detail: '识别完成' },
      ]),
    ),
    http.get('/api/m0/parser-compat/health', () => HttpResponse.json({ status: 'ok' })),
    http.get('/api/m2/health', () => HttpResponse.json({ status: 'ok' })),
    http.get('/api/m3/health', () => HttpResponse.json({ status: 'ok' })),
    http.get('/api/m4/health', () => HttpResponse.json({ status: 'ok' })),
    http.get('/api/m5/health', () => HttpResponse.json({ status: 'ok' })),
    http.get('/api/m5/ops/flow-dashboard', () =>
      HttpResponse.json({
        success: true,
        errors: [],
        data: [
          {
            plan_version: 'M5-PLAN-20260727-V2',
            overall_status: 'attention',
            progress_percent: 80,
            input: { scenario_id: 'SCENARIO-TEST', orders: [], order_count: 0, routing_step_count: 0, resource_count: 0, material_availability_count: 0, bom_item_count: 0, received_at: '2026-07-27T08:00:00Z' },
            output: { plan_version: 'M5-PLAN-20260727-V2', solver_status: 'optimal', validation_passed: true, lifecycle_status: 'released', scheduled_operation_count: 8, scheduled_order_count: 2, scheduled_resource_count: 5, dispatch_count: 1, failed_dispatch_count: 0, dispatch_item_count: 8, dispatch_acknowledged_count: 7, dispatch_failed_count: 0, execution_event_count: 3 },
            stages: [],
            jobs: [],
            tracking: { mode: 'off', event_count: 0, by_status: {}, sent_count: 0, pending_count: 0, retry_count: 0, processing_count: 0, dead_letter_count: 0 },
            updated_at: '2026-07-27T08:09:00Z',
          },
        ],
      }),
    ),
  );
};

describe('getWorkbenchActivities', () => {
  it('merges audit logs, dashboard health activities, and M5 flows sorted newest first', async () => {
    useHealthySources();

    const activities = await getWorkbenchActivities();

    expect(activities).toHaveLength(7);
    expect(activities[0]).toMatchObject({ source: 'audit', module: 'M1', status: 'success', time: '2026-07-27T09:00:00Z' });
    expect(activities[1]).toMatchObject({ source: 'm5', module: 'M5 排程', status: 'warning', message: expect.stringContaining('M5-PLAN-20260727-V2') });
    expect(activities.slice(2).every((activity) => activity.source === 'dashboard')).toBe(true);
  });

  it('limits the merged result to the requested count keeping newest first', async () => {
    server.use(
      http.get('/api/audit/logs', () =>
        HttpResponse.json([
          { id: 'LOG-1', time: '2026-07-27T09:00:00Z', actor: 'tester', action: 'A', module: 'M1', targetId: 'T', result: 'success', detail: 'a' },
          { id: 'LOG-2', time: '2026-07-27T09:05:00Z', actor: 'tester', action: 'B', module: 'M2', targetId: 'T', result: 'failed', detail: 'b' },
        ]),
      ),
      http.get('/api/m0/parser-compat/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m2/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m3/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m4/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/ops/flow-dashboard', () => HttpResponse.json({ success: true, data: [], errors: [] })),
    );

    const activities = await getWorkbenchActivities({ limit: 1 });

    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({ id: 'audit-LOG-2', status: 'error' });
  });

  it('degrades gracefully when a source endpoint fails', async () => {
    server.use(
      http.get('/api/audit/logs', () =>
        HttpResponse.json([{ id: 'LOG-1', time: '2026-07-27T09:00:00Z', actor: 'tester', action: 'A', module: 'M1', targetId: 'T', result: 'success', detail: 'a' }]),
      ),
      http.get('/api/m0/parser-compat/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m2/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m3/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m4/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/ops/flow-dashboard', () => HttpResponse.json({ code: 'INTERNAL' }, { status: 500 })),
    );

    const activities = await getWorkbenchActivities();

    expect(activities.length).toBeGreaterThanOrEqual(1);
    expect(activities[0]).toMatchObject({ source: 'audit', id: 'audit-LOG-1' });
    expect(activities.some((activity) => activity.source === 'm5')).toBe(false);
  });

  it('keeps dashboard health activities when the other sources are empty', async () => {
    server.use(
      http.get('/api/audit/logs', () => HttpResponse.json([])),
      http.get('/api/m0/parser-compat/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m2/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m3/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m4/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/ops/flow-dashboard', () => HttpResponse.json({ success: true, data: [], errors: [] })),
    );

    const activities = await getWorkbenchActivities();

    expect(activities.length).toBeGreaterThan(0);
    expect(activities.every((activity) => activity.source === 'dashboard')).toBe(true);
  });

  it('maps failed audit results to the error status and blocked to warning', async () => {
    server.use(
      http.get('/api/audit/logs', () =>
        HttpResponse.json([
          { id: 'LOG-1', time: '2026-07-27T09:00:00Z', actor: 'tester', action: 'FAIL', module: 'M3', targetId: 'T', result: 'failed', detail: 'failed' },
          { id: 'LOG-2', time: '2026-07-27T09:01:00Z', actor: 'tester', action: 'BLOCK', module: 'M4', targetId: 'T', result: 'blocked', detail: 'blocked' },
        ]),
      ),
      http.get('/api/m0/parser-compat/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m2/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m3/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m4/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/health', () => HttpResponse.json({ status: 'ok' })),
      http.get('/api/m5/ops/flow-dashboard', () => HttpResponse.json({ success: true, data: [], errors: [] })),
    );

    const activities = await getWorkbenchActivities({ limit: 2 });

    expect(activities[0]).toMatchObject({ id: 'audit-LOG-2', status: 'warning', source: 'audit' });
    expect(activities[1]).toMatchObject({ id: 'audit-LOG-1', status: 'error', source: 'audit' });
  });
});
