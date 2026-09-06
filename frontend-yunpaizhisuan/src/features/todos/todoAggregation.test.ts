import { describe, expect, it } from 'vitest';
import type { M4Alert } from '../../schemas/m4';
import type { M5FlowDashboardItem } from '../../schemas/m5';
import type { M1ReviewItem } from '../../types/api';
import { aggregateTodoGroups, aggregateTodoItems, aggregateTodos, canViewTodoSource, todoSourceCounts, todoSourceProgress, todoTotal, type TodoAggregateInput, type TodoM3PlanSummary } from './todoAggregation';

const pendingReviewItem = (id: string): M1ReviewItem => ({
  id,
  taskId: `TASK-${id}`,
  field: '交付日期',
  recognizedValue: '2026-07-08',
  confidence: 0.62,
  status: 'pending',
});

const confirmedReviewItem: M1ReviewItem = {
  id: 'CONFIRMED-1',
  taskId: 'TASK-C',
  field: '材料牌号',
  recognizedValue: 'AL6061',
  confidence: 0.9,
  status: 'confirmed',
};

const alert = (overrides: Partial<M4Alert>): M4Alert => ({
  id: 501,
  alert_type: 'overdue',
  purchase_order_no: 'PO-001',
  supplier_name: '华东五金供应商',
  item_code: 'MAT-001',
  item_name: '轴承',
  promised_date: '2026-07-01',
  days_overdue: 4,
  status: 'open',
  ...overrides,
});

const flow = (
  overrides: Partial<Omit<M5FlowDashboardItem, 'tracking'>> & { tracking?: Partial<M5FlowDashboardItem['tracking']> },
): M5FlowDashboardItem =>
  ({
    plan_version: 'M5-PLAN-V1',
    overall_status: 'attention',
    progress_percent: 80,
    tracking: { retry_count: 1, dead_letter_count: 0 },
    ...overrides,
  }) as unknown as M5FlowDashboardItem;

const plansWithShortages = (): TodoM3PlanSummary[] => [
  {
    procurement_plan_id: 'PROC-001',
    order_id: 'ORD-A',
    project_id: 'PRJ-A',
    plan_version: 'v1',
    status: 'ready_for_m4',
    availability_status: 'partial_shortage',
    line_count: 7,
    shortage_count: 2,
    created_at: '2026-08-09T00:00:00Z',
  },
  {
    procurement_plan_id: 'PROC-002',
    order_id: 'ORD-B',
    project_id: 'PRJ-B',
    plan_version: 'v1',
    status: 'ready_for_m4',
    availability_status: 'available',
    line_count: 7,
    shortage_count: 0,
    created_at: '2026-08-09T00:00:00Z',
  },
];

const baseInput = (overrides: Partial<TodoAggregateInput> = {}): TodoAggregateInput => ({
  m1ReviewItems: [],
  m3Plans: [],
  m4Alerts: [],
  m5Flows: [],
  ...overrides,
});

describe('todoAggregation', () => {
  it('aggregates pending M1 review items into one todo', () => {
    const items = aggregateTodos(
      baseInput({ m1ReviewItems: [pendingReviewItem('A'), pendingReviewItem('B'), confirmedReviewItem] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'm1', kind: 'review_pending', count: 2, link: '/modules/m0-review', severity: 'high' });
    expect(todoTotal(items)).toBe(2);
  });

  it('aggregates M3 shortage across persisted plans into one todo', () => {
    const items = aggregateTodos(baseInput({ m3Plans: plansWithShortages() }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'm3', kind: 'material_shortage', count: 2, link: '/modules/m3-procurement' });
  });

  it('aggregates only open overdue M4 alerts, excluding due-soon and closed alerts', () => {
    const items = aggregateTodos(
      baseInput({
        m4Alerts: [
          alert({ id: 501 }),
          alert({ id: 502, alert_type: 'due_soon', days_overdue: 0, status: 'processing' }),
          alert({ id: 503, alert_type: 'overdue', status: 'closed' }),
        ],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'm4', kind: 'alert_overdue', count: 1, link: '/modules/purchase-warnings' });
    expect(todoTotal(items)).toBe(1);
  });

  it('aggregates M5 flows needing attention', () => {
    const items = aggregateTodos(
      baseInput({
        m5Flows: [
          flow({ plan_version: 'V1', overall_status: 'attention', progress_percent: 80 }),
          flow({ plan_version: 'V2', overall_status: 'complete', progress_percent: 100, tracking: { retry_count: 0, dead_letter_count: 0 } }),
        ],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'm5', kind: 'flow_attention', count: 1, link: '/modules/m5-flow', severity: 'medium' });
  });

  it('returns an empty list and zero total for empty inputs', () => {
    const items = aggregateTodos(baseInput());

    expect(items).toEqual([]);
    expect(todoTotal(items)).toBe(0);
    expect(todoSourceCounts(items)).toEqual({ m1: 0, m3: 0, m4: 0, m5: 0 });
  });

  it('respects the current role permissions when aggregating sources', () => {
    const input = baseInput({
      m1ReviewItems: [pendingReviewItem('A')],
      m3Plans: plansWithShortages(),
      m4Alerts: [alert({ id: 501 })],
      m5Flows: [flow({ plan_version: 'V1' })],
    });

    const qc = aggregateTodos({ ...input, permissions: ['m1:read', 'schedule:read'] });
    expect(qc.map((item) => item.source).sort()).toEqual(['m1', 'm5']);

    const buyer = aggregateTodos({ ...input, permissions: ['m4:read'] });
    expect(buyer.map((item) => item.source).sort()).toEqual(['m3', 'm4']);

    const empty = aggregateTodos({ ...input, permissions: [] });
    expect(empty).toEqual([]);
  });

  it('computes per-source counts including zero sources', () => {
    const items = aggregateTodos(
      baseInput({
        m1ReviewItems: [pendingReviewItem('A'), pendingReviewItem('B')],
        m4Alerts: [alert({ id: 501 })],
      }),
    );

    expect(todoSourceCounts(items)).toEqual({ m1: 2, m3: 0, m4: 1, m5: 0 });
    expect(todoTotal(items)).toBe(3);
  });

  it('exposes the permission rule per source', () => {
    expect(canViewTodoSource(undefined, 'm1')).toBe(true);
    expect(canViewTodoSource(['m1:read'], 'm1')).toBe(true);
    expect(canViewTodoSource([], 'm1')).toBe(false);
    expect(canViewTodoSource(['m1:read'], 'm4')).toBe(false);
    expect(canViewTodoSource(['schedule:read'], 'm5')).toBe(true);
  });
});

describe('todoAggregation detail items', () => {
  it('splits pending M1 review items into one detail row per field', () => {
    const items = aggregateTodoItems(
      baseInput({ m1ReviewItems: [pendingReviewItem('A'), pendingReviewItem('B'), confirmedReviewItem] }),
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id)).toEqual(['m1-review-A', 'm1-review-B']);
    expect(items[0]).toMatchObject({
      source: 'm1',
      kind: 'review_pending',
      count: 1,
      done: false,
      severity: 'high',
      link: '/modules/m0-review',
    });
    expect(items[0]?.preview).toMatchObject({ type: 'm1-field', summary: 'TASK-A · 交付日期' });
    expect(items[0]?.action).toEqual({ label: '去处理', link: '/modules/m0-review' });
  });

  it('splits M3 shortages into one detail row per plan with dueAt', () => {
    const items = aggregateTodoItems(baseInput({ m3Plans: plansWithShortages() }));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'm3-shortage-PROC-001',
      source: 'm3',
      count: 2,
      dueAt: '2026-08-09T00:00:00Z',
      severity: 'high',
    });
    expect(items[0]?.preview).toMatchObject({ type: 'm3-plan' });
  });

  it('splits M4 alerts into one detail row per alert with promised due date', () => {
    const items = aggregateTodoItems(
      baseInput({
        m4Alerts: [
          alert({ id: 501 }),
          alert({ id: 502, alert_type: 'due_soon', days_overdue: 0, status: 'processing' }),
          alert({ id: 503, alert_type: 'overdue', status: 'closed' }),
        ],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'm4-alert-501',
      source: 'm4',
      dueAt: '2026-07-01',
      severity: 'high',
      link: '/modules/purchase-warnings',
    });
    expect(items[0]?.preview).toMatchObject({ type: 'm4-alert' });
  });

  it('splits M5 flows into one detail row per plan with updated_at due date', () => {
    const items = aggregateTodoItems(
      baseInput({
        m5Flows: [
          flow({ plan_version: 'V1', overall_status: 'attention', progress_percent: 80, updated_at: '2026-08-09T00:00:00Z' }),
          flow({ plan_version: 'V2', overall_status: 'complete', progress_percent: 100, tracking: { retry_count: 0, dead_letter_count: 0 } }),
        ],
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'm5-flow-V1',
      source: 'm5',
      severity: 'medium',
      dueAt: '2026-08-09T00:00:00Z',
    });
  });

  it('respects permissions when building detail items', () => {
    const input = baseInput({
      m1ReviewItems: [pendingReviewItem('A')],
      m3Plans: plansWithShortages(),
      m4Alerts: [alert({ id: 501 })],
      m5Flows: [flow({ plan_version: 'V1' })],
    });

    expect(aggregateTodoItems({ ...input, permissions: ['m1:read'] }).map((item) => item.source).sort()).toEqual(['m1']);
    expect(aggregateTodoItems({ ...input, permissions: ['m4:read'] }).map((item) => item.source).sort()).toEqual(['m3', 'm4']);
    expect(aggregateTodoItems({ ...input, permissions: [] })).toEqual([]);
  });
});

describe('todoAggregation groups and progress', () => {
  const detailItems = aggregateTodoItems(
    baseInput({
      m1ReviewItems: [pendingReviewItem('A'), pendingReviewItem('B')],
      m3Plans: plansWithShortages(),
      m4Alerts: [alert({ id: 501 })],
      m5Flows: [flow({ plan_version: 'V1' })],
    }),
  );

  it('groups detail items by source in source order', () => {
    const groups = aggregateTodoGroups(detailItems);

    expect(groups.map((group) => group.source)).toEqual(['m1', 'm3', 'm4', 'm5']);
    expect(groups[0]).toMatchObject({ source: 'm1', label: 'M0 解析待审', count: 2, description: '识别字段人工确认' });
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[1]).toMatchObject({ source: 'm3', count: 2, items: [{ id: 'm3-shortage-PROC-001' }] });
  });

  it('skips sources without items and returns empty for no items', () => {
    expect(aggregateTodoGroups([])).toEqual([]);
    expect(aggregateTodoGroups(detailItems.filter((item) => item.source === 'm5')).map((group) => group.source)).toEqual(['m5']);
  });

  it('computes per-source done/total progress from dismissed ids', () => {
    const dismissed = new Set(['m1-review-A', 'm4-alert-501']);
    const progress = todoSourceProgress(detailItems, (id) => dismissed.has(id));

    expect(progress).toEqual({
      m1: { done: 1, total: 2 },
      m3: { done: 0, total: 2 },
      m4: { done: 1, total: 1 },
      m5: { done: 0, total: 1 },
    });
  });

  it('counts explicitly done items as handled', () => {
    const items = aggregateTodoItems(baseInput({ m1ReviewItems: [pendingReviewItem('A')] })).map((item) => ({
      ...item,
      done: true,
    }));
    const progress = todoSourceProgress(items, () => false);

    expect(progress.m1).toEqual({ done: 1, total: 1 });
  });
});
