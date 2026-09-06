import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getBusinessCostVariance,
  getBusinessFinishedGoods,
  getBusinessMaterialTrace,
  getBusinessOrderTrace,
  publishBusinessFact,
  publishExecutionOutput,
} from './businessTraceApi';


function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const receiptFact = {
  fact: { fact_type: 'receipt', payload_digest: 'test' },
  recalculation: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('businessTraceApi', () => {
  it('reads order trace through the gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ order_id: 'SO-1', order_materials: [] })));
    const trace = await getBusinessOrderTrace('SO-1');
    expect(trace.order_id).toBe('SO-1');
    expect(trace.order_materials).toBeDefined();
  });

  it('reads material trace with lots and yield', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ lots: [], yield_summary: [] })));
    const trace = await getBusinessMaterialTrace('MAT-1');
    expect(Array.isArray(trace.lots)).toBe(true);
    expect(Array.isArray(trace.yield_summary)).toBe(true);
  });

  it('reads cost variance for a period', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ period: '2026-08', method: 'actual_vs_standard_v1' })),
    );
    const report = await getBusinessCostVariance('2026-08');
    expect(report.period).toBe('2026-08');
    expect(report.method).toBe('actual_vs_standard_v1');
  });

  it('reads finished-goods summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ tenant_id: 't', items: [] })),
    );
    const summary = await getBusinessFinishedGoods();
    expect(Array.isArray(summary.items)).toBe(true);
  });

  it('publishes a receipt fact', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(receiptFact, 202)));
    const result = await publishBusinessFact({
      fact_type: 'receipt',
      aggregate_type: 'material',
      aggregate_id: 'MAT-1',
      source_module: 'm4',
      source_event_id: 'ui-test-receipt',
      payload: {
        material_id: 'MAT-1',
        order_id: 'SO-1',
        purchase_order_id: 'PO-1',
        location_id: 'WH-1',
        quantity: '3',
      },
    });
    expect((result.fact as Record<string, unknown>)?.fact_type).toBe('receipt');
  });

  it('publishes execution output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { fact: { fact_type: 'production_output', payload_digest: 'test' }, recalculation: null },
          202,
        ),
      ),
    );
    const result = await publishExecutionOutput({
      order_id: 'SO-1',
      location_id: 'FG-WH',
      execution_event: {
        event_type: 'actual_finish',
        event_id: 'ui-test-finish',
        source: 'mes',
        reported_quantity: 3,
      },
    });
    expect((result.fact as Record<string, unknown>)?.fact_type).toBe('production_output');
  });
});
