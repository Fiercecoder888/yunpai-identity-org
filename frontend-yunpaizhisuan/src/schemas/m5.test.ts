import { describe, expect, it } from 'vitest';
import { m5PmcProgressSchema, m5ScheduleOperationSchema } from './m5';

describe('m5 schemas', () => {
  it('normalizes nullable actual projection fields on schedule operations', () => {
    expect(m5ScheduleOperationSchema.parse({
      operation_id: 'OP-1',
      actual_start_time: null,
      actual_end_time: null,
      actual_qty: null,
      actual_status: null,
    })).toMatchObject({
      operation_id: 'OP-1',
      actual_start_time: undefined,
      actual_end_time: undefined,
      actual_qty: undefined,
      actual_status: undefined,
    });
  });

  it('accepts unfinished PMC orders with null on-time evidence', () => {
    const result = m5PmcProgressSchema.parse({
      plan_version: 'PV-1',
      generated_at: '2026-08-20T08:30:00Z',
      summary: {
        order_count: 1,
        completed_order_count: 0,
        wip_order_count: 1,
        late_order_count: 0,
        on_time_order_count: 0,
        on_time_rate_percent: null,
      },
      orders: [{
        order_id: 'SO-1',
        product_id: null,
        planned_quantity: null,
        unit: null,
        due_time: null,
        actual_qty: null,
        actual_quantity_supported: false,
        terminal_operation_id: null,
        completion_rate_percent: null,
        status: 'wip',
        on_time: null,
        planned_completion_time: null,
        actual_completion_time: null,
        operations: [{
          order_id: 'SO-1',
          product_id: 'SKU-1',
          operation_id: 'OP-1',
          operation_name: '切割',
          resource_id: 'WC-1',
          planned_start_time: '2026-08-20T07:00:00Z',
          planned_end_time: '2026-08-20T09:00:00Z',
          planned_quantity: null,
          unit: null,
          actual_start_time: '2026-08-20T08:00:00Z',
          actual_end_time: null,
          actual_qty: null,
          actual_status: 'running',
          completion_rate_percent: 30,
        }],
      }],
    });

    expect(result.summary.on_time_rate_percent).toBeUndefined();
    expect(result.orders[0]?.on_time).toBeUndefined();
    expect(result.orders[0]?.actual_quantity_supported).toBe(false);
    expect(result.orders[0]?.planned_quantity).toBeUndefined();
    expect(result.orders[0]?.unit).toBeUndefined();
    expect(result.orders[0]?.planned_completion_time).toBeUndefined();
    expect(result.orders[0]?.completion_rate_percent).toBeUndefined();
    expect(result.orders[0]?.operations[0]?.planned_quantity).toBeUndefined();
    expect(result.orders[0]?.operations[0]?.actual_qty).toBeUndefined();
    expect(result.orders[0]?.operations[0]?.actual_end_time).toBeUndefined();
  });

  it('rejects PMC statuses outside the backend enums', () => {
    const base = {
      plan_version: 'PV-1',
      generated_at: '2026-08-20T08:30:00Z',
      summary: {
        order_count: 1,
        completed_order_count: 0,
        wip_order_count: 1,
        late_order_count: 0,
        on_time_order_count: 0,
        on_time_rate_percent: null,
      },
      orders: [{
        order_id: 'SO-1',
        actual_quantity_supported: false,
        status: 'in_progress',
        operations: [],
      }],
    };
    expect(m5PmcProgressSchema.safeParse(base).success).toBe(false);
    expect(m5PmcProgressSchema.safeParse({
      ...base,
      orders: [{
        ...base.orders[0],
        status: 'wip',
        operations: [{
          order_id: 'SO-1',
          product_id: 'SKU-1',
          operation_id: 'OP-1',
          operation_name: '切割',
          resource_id: 'WC-1',
          planned_start_time: '2026-08-20T07:00:00Z',
          planned_end_time: '2026-08-20T09:00:00Z',
          actual_status: 'started',
        }],
      }],
    }).success).toBe(false);
  });
});
