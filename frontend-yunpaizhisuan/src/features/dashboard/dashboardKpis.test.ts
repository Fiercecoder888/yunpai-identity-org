import { describe, expect, it } from 'vitest';
import {
  buildKpiRow,
  buildRiskBuckets,
  classifyRiskSeverity,
  computeCumulativeOrderCount,
  computeGoalAchievement,
  computeOnTimeRate,
  computeOrderCount,
  computeOverdueAmount,
  computeShortageCount,
  computeTrend,
  computeWipOrderCount,
  computeYieldRate,
  kpiTargets,
} from './dashboardKpis';
import type { M4Alert, M4Tracking } from '../../schemas/m4';
import type { M5FlowDashboardItem } from '../../schemas/m5';

const tracking: M4Tracking[] = [
  { id: 1, purchase_order_item_id: 301, unit_price: '12.5', currency: 'CNY', arrival_status: 'not_received', is_overdue: false },
  { id: 2, purchase_order_item_id: 302, unit_price: '86', currency: 'CNY', arrival_status: 'not_received', is_overdue: false },
  { id: 3, purchase_order_item_id: 303, unit_price: '245.80', currency: 'CNY', arrival_status: 'overdue', is_overdue: true },
];

const alerts: M4Alert[] = [
  { id: 1, alert_type: 'overdue', purchase_order_no: 'PO-1', supplier_name: 'S1', item_code: 'A', item_name: '轴承', promised_date: '2026-07-01', days_overdue: 4, status: 'open' },
  { id: 2, alert_type: 'due_soon', purchase_order_no: 'PO-2', supplier_name: 'S2', item_code: 'B', item_name: '传感器', promised_date: '2026-07-08', days_overdue: 0, status: 'processing' },
];

const flow: M5FlowDashboardItem[] = [
  {
    plan_version: 'V2',
    overall_status: 'attention',
    progress_percent: 80,
    input: { scenario_id: 'S1', received_at: '2026-07-27T08:00:00Z', order_count: 2, orders: [{ order_id: 'O1', product_id: 'P1', quantity: 1, unit: 'pcs', is_expedited: false }, { order_id: 'O2', product_id: 'P2', quantity: 1, unit: 'pcs', is_expedited: false }], routing_step_count: 1, resource_count: 1, material_availability_count: 1, bom_item_count: 1 },
    output: { plan_version: 'V2', solver_status: 'optimal', validation_passed: true, lifecycle_status: 'released', scheduled_operation_count: 2, scheduled_order_count: 2, scheduled_resource_count: 1, dispatch_count: 0, failed_dispatch_count: 0, dispatch_item_count: 0, dispatch_acknowledged_count: 0, dispatch_failed_count: 0, execution_event_count: 0 },
    stages: [],
    jobs: [],
    tracking: { mode: 'shadow', event_count: 0, by_status: {}, sent_count: 0, pending_count: 0, retry_count: 0, processing_count: 0, dead_letter_count: 0 },
    updated_at: '2026-07-27T08:09:00Z',
  },
  {
    plan_version: 'V1',
    overall_status: 'complete',
    progress_percent: 100,
    input: { scenario_id: 'S1', received_at: '2026-07-27T07:40:00Z', order_count: 1, orders: [{ order_id: 'O1', product_id: 'P1', quantity: 1, unit: 'pcs', is_expedited: false }], routing_step_count: 1, resource_count: 1, material_availability_count: 1, bom_item_count: 1 },
    output: { plan_version: 'V1', solver_status: 'optimal', validation_passed: true, lifecycle_status: 'released', scheduled_operation_count: 1, scheduled_order_count: 1, scheduled_resource_count: 1, dispatch_count: 0, failed_dispatch_count: 0, dispatch_item_count: 0, dispatch_acknowledged_count: 0, dispatch_failed_count: 0, execution_event_count: 0 },
    stages: [],
    jobs: [],
    tracking: { mode: 'shadow', event_count: 0, by_status: {}, sent_count: 0, pending_count: 0, retry_count: 0, processing_count: 0, dead_letter_count: 0 },
    updated_at: '2026-07-27T07:47:00Z',
  },
];

const readinessLines = [
  { material_code: 'MAT-001', material_name: '轴承', uom: 'PCS', gross_required_qty: 120, available_qty: 30, open_po_qty: 40, shortage_qty: 50, suggest_purchase_qty: 50, line_status: 'shortage' as const },
  { material_code: 'MAT-003', material_name: '联轴器', uom: 'SET', gross_required_qty: 24, available_qty: 6, open_po_qty: 0, shortage_qty: 18, suggest_purchase_qty: 18, line_status: 'shortage' as const },
  { material_code: 'MAT-002', material_name: '传感器', uom: 'PCS', gross_required_qty: 60, available_qty: 60, open_po_qty: 0, shortage_qty: 0, suggest_purchase_qty: 0, line_status: 'ready' as const },
];

describe('dashboardKpis computation', () => {
  it('computes order count as distinct order ids', () => {
    expect(computeOrderCount(flow)).toBe(2);
  });

  it('computes on-time rate as non-overdue over total', () => {
    expect(computeOnTimeRate(tracking)).toBe(66.7);
    expect(computeOnTimeRate([])).toBeNull();
  });

  it('computes shortage count from shortage lines', () => {
    expect(computeShortageCount(readinessLines)).toBe(2);
    expect(computeShortageCount([])).toBe(0);
  });

  it('computes overdue purchase amount', () => {
    expect(computeOverdueAmount(tracking)).toBe(245.8);
  });

  it('computes wip order count from the latest plan', () => {
    expect(computeWipOrderCount(flow)).toBe(2);
    expect(computeWipOrderCount([])).toBe(0);
  });

  it('computes weighted yield rate from finished goods', () => {
    expect(computeYieldRate({ items: [{ good_total: 116, defect_total: 4 }] })).toBe(96.7);
    expect(computeYieldRate({ items: [] })).toBeNull();
    expect(computeYieldRate(undefined)).toBeNull();
  });

  it('builds the full KPI row with statuses', () => {
    const kpis = buildKpiRow({
      trackingItems: tracking,
      trackingError: false,
      alertItems: alerts,
      readinessLines,
      readinessError: false,
      flow,
      flowError: false,
      finished: { items: [{ good_total: 116, defect_total: 4 }] },
      finishedError: false,
      loading: false,
    });

    expect(kpis.map((kpi) => kpi.key)).toEqual(['orders', 'onTime', 'shortage', 'overdueAmount', 'wip', 'yield']);
    expect(kpis.find((kpi) => kpi.key === 'orders')?.display).toBe('2');
    expect(kpis.find((kpi) => kpi.key === 'onTime')?.display).toBe('66.7%');
    expect(kpis.find((kpi) => kpi.key === 'shortage')?.display).toBe('2');
    expect(kpis.find((kpi) => kpi.key === 'overdueAmount')?.display).toBe('¥245.80');
    expect(kpis.find((kpi) => kpi.key === 'wip')?.display).toBe('2');
    expect(kpis.find((kpi) => kpi.key === 'yield')?.display).toBe('96.7%');
  });

  it('fills P3 KPI extensions: secondary / goal / icon / trend', () => {
    const kpis = buildKpiRow({
      trackingItems: tracking,
      trackingError: false,
      alertItems: alerts,
      readinessLines,
      readinessError: false,
      flow,
      flowError: false,
      finished: { items: [{ good_total: 116, defect_total: 4 }] },
      finishedError: false,
      loading: false,
    });

    const orders = kpis.find((kpi) => kpi.key === 'orders');
    expect(orders?.secondary).toBe(2);
    expect(orders?.secondaryLabel).toBe('累计');
    expect(orders?.icon).toBe('orders');
    expect(orders?.trend).toBe('down');

    const onTime = kpis.find((kpi) => kpi.key === 'onTime');
    expect(onTime?.goal).toBe(90);
    expect(onTime?.goalValue).toBe(66.7);
    expect(onTime?.secondary).toBe(1);
    expect(onTime?.secondaryLabel).toBe('逾期单');

    const shortage = kpis.find((kpi) => kpi.key === 'shortage');
    expect(shortage?.secondary).toBe(68);
    expect(shortage?.secondaryLabel).toBe('缺料总量');

    const overdue = kpis.find((kpi) => kpi.key === 'overdueAmount');
    expect(overdue?.secondary).toBe(1);
    expect(overdue?.secondaryLabel).toBe('逾期笔数');

    const wip = kpis.find((kpi) => kpi.key === 'wip');
    expect(wip?.secondary).toBe(2);
    expect(wip?.secondaryLabel).toBe('计划版本');

    const yieldKpi = kpis.find((kpi) => kpi.key === 'yield');
    expect(yieldKpi?.goal).toBe(95);
    expect(yieldKpi?.goalValue).toBe(96.7);
    expect(yieldKpi?.secondary).toBe(1);
  });

  it('marks KPI cards as error when a source fails', () => {
    const kpis = buildKpiRow({
      trackingItems: [],
      trackingError: true,
      alertItems: [],
      readinessLines: [],
      readinessError: false,
      flow: [],
      flowError: false,
      finished: undefined,
      finishedError: true,
      loading: false,
    });

    expect(kpis.find((kpi) => kpi.key === 'onTime')?.status).toBe('error');
    expect(kpis.find((kpi) => kpi.key === 'yield')?.status).toBe('error');
  });

  it('does not present skipped order-scoped readiness as zero shortages', () => {
    const kpis = buildKpiRow({
      trackingItems: [],
      trackingError: false,
      alertItems: [],
      readinessLines: [],
      readinessError: false,
      readinessAvailable: false,
      flow: [],
      flowError: false,
      finished: undefined,
      finishedError: false,
      loading: false,
    });

    expect(kpis.find((kpi) => kpi.key === 'shortage')).toMatchObject({
      status: 'empty',
      value: null,
      display: '--',
      secondary: null,
      hint: '订单级指标，请进入 M3 选择订单后查看',
    });
  });

  it('builds risk buckets by severity', () => {
    const buckets = buildRiskBuckets({
      alertItems: alerts,
      readinessLines,
      flow,
      dashboardRisks: [{ id: 'R1', title: '高风险项', module: 'M4', level: 'high', description: 'desc' }],
      healthyModuleCount: 3,
    });

    const danger = buckets.find((bucket) => bucket.key === 'danger');
    const warning = buckets.find((bucket) => bucket.key === 'warning');
    const success = buckets.find((bucket) => bucket.key === 'success');

    expect(danger?.count).toBe(4); // 1 dashboard high + 1 overdue alert + 2 shortage lines
    expect(warning?.count).toBe(2); // 1 due_soon alert + 1 attention plan
    expect(success?.count).toBe(4); // 1 complete plan + 3 healthy modules
    expect(danger?.items.some((item) => item.title.includes('轴承 逾期'))).toBe(true);
    expect(warning?.items.some((item) => item.title.includes('传感器 即将到期'))).toBe(true);
    expect(success?.items.find((item) => item.id === 'flow-V1')).toMatchObject({
      title: '排程 V1 求解完成',
      description: '当前流程进度 100%，审批、派发和执行状态请进入 M5 查看',
    });
  });

  it('assigns module and severity to risk bucket items', () => {
    const buckets = buildRiskBuckets({
      alertItems: alerts,
      readinessLines,
      flow,
      dashboardRisks: [{ id: 'R1', title: '高风险项', module: 'M4', level: 'high', description: 'desc' }],
      healthyModuleCount: 0,
    });

    const danger = buckets.find((bucket) => bucket.key === 'danger');
    const warning = buckets.find((bucket) => bucket.key === 'warning');
    const success = buckets.find((bucket) => bucket.key === 'success');

    expect(danger?.items.find((item) => item.id === 'dashboard-R1')?.module).toBe('M4');
    expect(danger?.items.find((item) => item.id === 'dashboard-R1')?.severity).toBe('high');
    expect(danger?.items.find((item) => item.id === 'readiness-MAT-001')?.module).toBe('M3');
    expect(warning?.items.find((item) => item.id === 'alert-2')?.module).toBe('M4');
    expect(success?.items.find((item) => item.id.includes('V1'))?.module).toBe('M5');
  });
});

describe('dashboardKpis P3 helpers', () => {
  it('computes cumulative order count across plan versions', () => {
    expect(computeCumulativeOrderCount(flow)).toBe(2);
    expect(computeCumulativeOrderCount([])).toBe(0);
  });

  it('keeps computeOrderCount as distinct order ids across versions', () => {
    expect(computeOrderCount(flow)).toBe(2);
  });

  it('computes goal achievement with target guards', () => {
    expect(computeGoalAchievement(66.7, 90)).toBe(74.1);
    expect(computeGoalAchievement(96.7, 95)).toBe(100);
    expect(computeGoalAchievement(0, 90)).toBe(0);
    expect(computeGoalAchievement(50, 0)).toBeNull();
    expect(computeGoalAchievement(50, -1)).toBeNull();
    expect(computeGoalAchievement(null, 90)).toBeNull();
    expect(computeGoalAchievement(50, null)).toBeNull();
    expect(computeGoalAchievement(undefined, undefined)).toBeNull();
  });

  it('rounds goal achievement to one decimal', () => {
    expect(computeGoalAchievement(1, 3)).toBe(33.3);
    expect(computeGoalAchievement(2, 6)).toBe(33.3);
  });

  it('classifies risk severity from base level and domain signals', () => {
    expect(classifyRiskSeverity('high')).toBe('high');
    expect(classifyRiskSeverity('medium')).toBe('medium');
    expect(classifyRiskSeverity('low')).toBe('low');
    expect(classifyRiskSeverity('none')).toBe('none');
    expect(classifyRiskSeverity('unknown')).toBe('none');
    expect(classifyRiskSeverity('high', { down: true })).toBe('critical');
    expect(classifyRiskSeverity('low', { down: true })).toBe('critical');
    expect(classifyRiskSeverity('low', { daysOverdue: 15 })).toBe('critical');
    expect(classifyRiskSeverity('low', { daysOverdue: 8 })).toBe('high');
    expect(classifyRiskSeverity('low', { daysOverdue: 4 })).toBe('medium');
    expect(classifyRiskSeverity('medium', { shortageQty: 120 })).toBe('critical');
    expect(classifyRiskSeverity('low', { shortageQty: 60 })).toBe('high');
    expect(classifyRiskSeverity('low', { shortageQty: 12 })).toBe('medium');
    expect(classifyRiskSeverity('medium', { daysOverdue: 1 })).toBe('medium');
    expect(classifyRiskSeverity('high', { daysOverdue: 2 })).toBe('high');
  });

  it('exposes the static kpi targets table', () => {
    expect(kpiTargets).toEqual({ onTime: 90, yield: 95, shortage: 3, overdueAmount: 0 });
  });

  it('computes trend from the last two series points', () => {
    expect(computeTrend([1, 2, 3])).toBe('up');
    expect(computeTrend([3, 2, 1])).toBe('down');
    expect(computeTrend([2, 2])).toBe('flat');
    expect(computeTrend([])).toBe('flat');
    expect(computeTrend([1])).toBe('flat');
  });
});
