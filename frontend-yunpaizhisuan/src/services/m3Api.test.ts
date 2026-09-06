import { describe, expect, it, vi } from 'vitest';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';
import {
  approveM3ApprovalTask,
  exportM3ProcurementSuggestions,
  getM3MaterialReadiness,
  getM3Order,
  handoffM3PlanToM4,
  listM3Orders,
  listM3ProcurementPlans,
  runM3ProcurementPlan,
  runM3ProcurementPlanJson,
  runM3ProcurementRequirements,
  runM3ProcurementRequirementsEnvelope,
} from './m3Api';

describe('m3Api', () => {
  it('uses /api/m3 paths and unwraps success envelopes', async () => {
    await expect(listM3Orders()).resolves.toEqual([expect.objectContaining({ order_id: 'ORD-001' })]);
    await expect(getM3Order('ORD-001')).resolves.toMatchObject({ order_id: 'ORD-001' });
    await expect(runM3ProcurementRequirements({ order_id: 'ORD-001' })).resolves.toMatchObject({ plan_id: 'PLAN-001' });
    await expect(runM3ProcurementRequirementsEnvelope({ order_id: 'ORD-001' })).resolves.toMatchObject({
      success: true,
      data: { plan_id: 'PLAN-001' },
      errors: [],
    });
    await expect(runM3ProcurementPlanJson({ order_id: 'ORD-001' })).resolves.toMatchObject({ plan_id: 'PLAN-001' });
    await expect(runM3ProcurementPlan('ORD-001')).resolves.toMatchObject({ procurement_plan_id: 'PLAN-001', order_id: 'ORD-001' });
    await expect(approveM3ApprovalTask('APP-001')).resolves.toMatchObject({ status: 'approved' });
    await expect(handoffM3PlanToM4('PLAN-001')).resolves.toMatchObject({ handed_off: true });
  });

  it('does not call native /api/v1/m3 paths', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await listM3Orders();

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/m3/orders');
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain('/api/v1/m3');
    fetchSpy.mockRestore();
  });

  it('creates a root TaskID for standalone runs and preserves an existing one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await runM3ProcurementRequirements({ order_id: 'ORD-NEW' });
    await runM3ProcurementRequirementsEnvelope(
      { order_id: 'ORD-EXISTING' },
      { trackingTaskId: 'task-existing-opaque' },
    );

    const generated = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers).get('X-Yunpai-Task-ID');
    const preserved = new Headers(fetchSpy.mock.calls[1]?.[1]?.headers).get('X-Yunpai-Task-ID');
    expect(generated).toMatch(/^task_[a-f0-9]{32}$/);
    expect(preserved).toBe('task-existing-opaque');
    fetchSpy.mockRestore();
  });

  it('rejects a blank caller-owned TaskID before sending the request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(() =>
      runM3ProcurementRequirements({ order_id: 'ORD-BLANK' }, { trackingTaskId: '   ' }),
    ).toThrow(/non-empty X-Yunpai-Task-ID/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('throws business errors for failed envelopes', async () => {
    server.use(http.get('/api/m3/orders', () => HttpResponse.json({ success: false, data: null, errors: [{ message: 'MRP failed' }] })));

    await expect(listM3Orders()).rejects.toMatchObject({ error: { code: 'business_error', message: 'MRP failed' } });
  });

  it('normalizes the real single-plan response to a list', async () => {
    server.use(
      http.get('/api/m3/procurement-plan', () =>
        HttpResponse.json({
          success: true,
          data: { procurement_plan_id: 'PLAN-REAL-001', order_id: 'ORD-001' },
          errors: [],
        }),
      ),
    );

    await expect(listM3ProcurementPlans('ORD-001')).resolves.toEqual([
      expect.objectContaining({ procurement_plan_id: 'PLAN-REAL-001', order_id: 'ORD-001' }),
    ]);
  });

  it('exports suggestions as a JSON envelope', async () => {
    await expect(exportM3ProcurementSuggestions('PLAN-001')).resolves.toMatchObject({ plan_id: 'PLAN-001', count: 0 });
  });

  it('rejects an empty readiness order id before issuing a request', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    expect(() => getM3MaterialReadiness('   ')).toThrow('requires a non-empty orderId');
    expect(() => getM3MaterialReadiness(undefined as unknown as string)).toThrow('requires a non-empty orderId');
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
