import { describe, expect, it } from 'vitest';
import {
  buildCapacityStackedOption,
  buildOnTimeTrendOption,
  buildOrderFunnelOption,
  buildShortageHeatmapOption,
  buildSupplierRadarOption,
  buildYieldTrendOption,
  extractDispatchAckRates,
  extractOperationYield,
} from '.';
import type { M5FlowDashboardItem } from '../../../../schemas/m5';

const flow: M5FlowDashboardItem[] = [
  {
    plan_version: 'v1',
    tracking_task_id: 'task-1',
    overall_status: 'complete',
    progress_percent: 100,
    input: {
      scenario_id: 's1',
      received_at: '2026-08-01T00:00:00Z',
      order_count: 2,
      orders: [],
      routing_step_count: 1,
      resource_count: 1,
      material_availability_count: 0,
      bom_item_count: 0,
    },
    output: {
      plan_version: 'v1',
      solver_status: 'solved',
      validation_passed: true,
      lifecycle_status: 'released',
      scheduled_operation_count: 4,
      scheduled_order_count: 2,
      scheduled_resource_count: 2,
      dispatch_count: 2,
      failed_dispatch_count: 0,
      dispatch_item_count: 4,
      dispatch_acknowledged_count: 3,
      dispatch_failed_count: 0,
      execution_event_count: 1,
      resource_load_minutes: { 'WC-1': 120, 'WC-2': 60 },
    },
    stages: [
      { key: 'input', label: '输入', status: 'succeeded', completed: 1, total: 1, message: '' },
      { key: 'scheduling', label: '排程', status: 'succeeded', completed: 1, total: 1, message: '' },
      { key: 'validation', label: '校验', status: 'succeeded', completed: 1, total: 1, message: '' },
      { key: 'approval', label: '审批', status: 'succeeded', completed: 1, total: 1, message: '' },
      { key: 'dispatch', label: '派发', status: 'succeeded', completed: 1, total: 1, message: '' },
      { key: 'execution', label: '执行', status: 'running', completed: 0, total: 1, message: '' },
    ],
    jobs: [],
    tracking: {
      mode: 'off',
      event_count: 0,
      by_status: {},
      sent_count: 0,
      pending_count: 0,
      retry_count: 0,
      processing_count: 0,
      dead_letter_count: 0,
    },
    updated_at: '2026-08-01T00:00:00Z',
  },
  {
    plan_version: 'v2',
    tracking_task_id: 'task-2',
    overall_status: 'attention',
    progress_percent: 60,
    input: {
      scenario_id: 's1',
      received_at: '2026-08-02T00:00:00Z',
      order_count: 1,
      orders: [],
      routing_step_count: 1,
      resource_count: 1,
      material_availability_count: 0,
      bom_item_count: 0,
    },
    output: {
      plan_version: 'v2',
      solver_status: 'solved',
      validation_passed: true,
      lifecycle_status: 'draft',
      scheduled_operation_count: 4,
      scheduled_order_count: 1,
      scheduled_resource_count: 1,
      dispatch_count: 0,
      failed_dispatch_count: 0,
      dispatch_item_count: 0,
      dispatch_acknowledged_count: 0,
      dispatch_failed_count: 0,
      execution_event_count: 0,
      resource_load_minutes: { 'WC-1': 90 },
    },
    stages: [
      { key: 'input', label: '输入', status: 'succeeded', completed: 1, total: 1, message: '' },
      { key: 'scheduling', label: '排程', status: 'succeeded', completed: 1, total: 1, message: '' },
      { key: 'validation', label: '校验', status: 'running', completed: 0, total: 1, message: '' },
      { key: 'approval', label: '审批', status: 'not_started', completed: 0, total: 1, message: '' },
      { key: 'dispatch', label: '派发', status: 'not_started', completed: 0, total: 1, message: '' },
      { key: 'execution', label: '执行', status: 'not_started', completed: 0, total: 1, message: '' },
    ],
    jobs: [],
    tracking: {
      mode: 'off',
      event_count: 0,
      by_status: {},
      sent_count: 0,
      pending_count: 0,
      retry_count: 0,
      processing_count: 0,
      dead_letter_count: 0,
    },
    updated_at: '2026-08-02T00:00:00Z',
  },
];

const readinessLines = [
  {
    material_code: 'MAT-1',
    material_name: '铝板',
    uom: '件',
    gross_required_qty: 10,
    available_qty: 2,
    open_po_qty: 0,
    shortage_qty: 8,
    suggest_purchase_qty: 8,
    line_status: 'shortage' as const,
  },
  {
    material_code: 'MAT-1',
    material_name: '铝板',
    uom: '件',
    gross_required_qty: 10,
    available_qty: 12,
    open_po_qty: 0,
    shortage_qty: 0,
    suggest_purchase_qty: 0,
    line_status: 'ready' as const,
  },
  {
    material_code: 'MAT-2',
    material_name: '螺丝',
    uom: '件',
    gross_required_qty: 50,
    available_qty: 30,
    open_po_qty: 20,
    shortage_qty: 0,
    suggest_purchase_qty: 0,
    line_status: 'covered_by_stock_or_open_po' as const,
  },
];

const alerts = [
  {
    id: 1,
    alert_type: 'overdue' as const,
    purchase_order_no: 'PO-1',
    supplier_name: '华东供应商',
    item_code: 'MAT-1',
    item_name: '铝板',
    promised_date: '2026-08-01',
    days_overdue: 3,
    status: 'open' as const,
  },
  {
    id: 2,
    alert_type: 'supplier_exception' as const,
    purchase_order_no: 'PO-2',
    supplier_name: '华东供应商',
    item_code: 'MAT-2',
    item_name: '螺丝',
    promised_date: '2026-08-05',
    days_overdue: 0,
    status: 'processing' as const,
  },
];

describe('dashboard chart builders', () => {
  it('builds an on-time dispatch ack rate line option', () => {
    const points = extractDispatchAckRates(flow);
    expect(points).toEqual([
      { version: 'v1', acknowledged: 3, total: 4 },
      { version: 'v2', acknowledged: 0, total: 0 },
    ]);

    const option = buildOnTimeTrendOption(flow);
    expect(option.title).toMatchObject({ text: expect.stringContaining('派发确认率') });
    expect(option.xAxis).toMatchObject({ data: ['v1', 'v2'] });
    const series = option.series as Array<{ type: string; data: number[] }>;
    expect(series[0]!.type).toBe('line');
    expect(series[0]!.data).toEqual([75, 0]);
  });

  it('builds a material x status shortage heatmap option', () => {
    const option = buildShortageHeatmapOption(readinessLines);
    expect(option.title).toMatchObject({ text: expect.stringContaining('缺料热力') });
    const series = option.series as Array<{ type: string; data: Array<[number, number, number]> }>;
    expect(series[0]!.type).toBe('heatmap');
    expect(series[0]!.data.length).toBeGreaterThan(0);
  });

  it('builds a capacity stacked option from flow resource load minutes', () => {
    const option = buildCapacityStackedOption({ flow });
    const series = option.series as Array<{ name: string; type: string; stack: string; data: number[] }>;
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ name: 'WC-1', type: 'bar', stack: 'total', data: [120, 90] });
    expect(series[1]).toMatchObject({ name: 'WC-2', data: [60, 0] });
  });

  it('builds an M5 stage order funnel option', () => {
    const option = buildOrderFunnelOption(flow);
    const series = option.series as Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    expect(series[0]!.type).toBe('funnel');
    const names = series[0]!.data.map((entry) => entry.name);
    expect(names[0]).toBe('输入');
    expect(series[0]!.data.find((entry) => entry.name === '派发')).toMatchObject({ value: 1 });
  });

  it('builds a supplier risk radar option derived from alerts', () => {
    const option = buildSupplierRadarOption(alerts);
    const series = option.series as Array<{ type: string; data: Array<{ name: string; value: number[] }> }>;
    expect(series[0]!.type).toBe('radar');
    const profile = series[0]!.data[0];
    expect(profile).toBeDefined();
    expect(profile).toMatchObject({ name: '华东供应商' });
    expect(profile!.value).toEqual([1, 3, 2, 1]);
  });

  it('builds an operation yield trend option from finished goods', () => {
    const finished = {
      items: [
        {
          yield_summary: [
            { operation_id: 'OP-10', produced: 60, defect: 2 },
            { operation_id: 'OP-20', produced: 58, defect: 5 },
          ],
        },
        {
          yield_summary: [{ operation_id: 'OP-10', produced: 40, defect: 1 }],
        },
      ],
    };
    const points = extractOperationYield(finished);
    expect(points).toEqual([
      { operationId: 'OP-10', produced: 100, defect: 3, rate: 97.1 },
      { operationId: 'OP-20', produced: 58, defect: 5, rate: 92.1 },
    ]);

    const option = buildYieldTrendOption(finished);
    const series = option.series as Array<{ type: string; data: number[] }>;
    expect(series[0]!.type).toBe('line');
    expect(series[0]!.data).toEqual([97.1, 92.1]);
  });

  it('degrades gracefully with empty inputs', () => {
    expect(buildOnTimeTrendOption([])).toMatchObject({ title: { text: expect.any(String) } });
    expect(buildShortageHeatmapOption([])).toBeDefined();
    expect(buildCapacityStackedOption({ flow: [] })).toBeDefined();
    expect(buildOrderFunnelOption([])).toBeDefined();
    expect(buildSupplierRadarOption([])).toBeDefined();
    expect(buildYieldTrendOption(undefined)).toBeDefined();
    expect(extractOperationYield(undefined)).toEqual([]);
  });
});
