import { describe, expect, it } from 'vitest';
import { sampleWorkOrderSchema } from './sampleWorkOrderApi';

describe('sampleWorkOrderApi contract', () => {
  it('parses a sample work order ledger record', () => {
    const record = sampleWorkOrderSchema.parse({
      tenant_id: 'tenant-1',
      order_id: 'SAMPLE-1',
      order_type: 'sample',
      sample_group: null,
      product_name: 'HDMI 样品',
      qty: 3,
      status: 'done',
      reviewer: '质检员A',
      result: 'pass',
      run_id: 'flow_abc',
      tracking_task_id: 'task_abc',
      attributes: { status_history: ['created', 'executing', 'inspecting', 'done'] },
      created_at: '2026-08-10T10:00:00Z',
      updated_at: '2026-08-10T11:00:00Z',
    });
    expect(record.order_type).toBe('sample');
    expect(record.status).toBe('done');
    expect(record.attributes?.status_history).toHaveLength(4);
  });

  it('rejects an unknown status', () => {
    expect(() =>
      sampleWorkOrderSchema.parse({ order_id: 'X', status: 'weird' }),
    ).toThrow();
  });
});
