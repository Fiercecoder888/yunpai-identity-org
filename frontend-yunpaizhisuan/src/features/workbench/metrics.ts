import type { DashboardKpiCard } from '../dashboard/dashboardKpis';

export type WorkbenchMetricTone = 'good' | 'warning' | 'danger';

export type WorkbenchMetric = {
  key: string;
  label: string;
  value: number | null;
  display: string;
  href: string;
  tone: WorkbenchMetricTone;
};

export type WorkbenchMetricInput = {
  kpis: DashboardKpiCard[];
  dangerCount: number;
  todoTotal: number;
  loading: boolean;
};

export function buildMetrics(input: WorkbenchMetricInput): WorkbenchMetric[] {
  const order = input.kpis.find((kpi) => kpi.key === 'orders');
  const wip = input.kpis.find((kpi) => kpi.key === 'wip');
  const loading = input.loading;

  return [
    {
      key: 'orders',
      label: '订单',
      value: order?.value ?? null,
      display: loading ? '--' : order?.display ?? '--',
      href: '/modules/m5-flow',
      tone: 'good',
    },
    {
      key: 'risk',
      label: '高风险',
      value: input.dangerCount,
      display: loading ? '--' : String(input.dangerCount),
      href: '/dashboard',
      tone: input.dangerCount > 0 ? 'danger' : 'good',
    },
    {
      key: 'todo',
      label: '待办',
      value: input.todoTotal,
      display: loading ? '--' : String(input.todoTotal),
      href: '/home',
      tone: input.todoTotal > 0 ? 'warning' : 'good',
    },
    {
      key: 'production',
      label: '在产工单',
      value: wip?.value ?? null,
      display: loading ? '--' : wip?.display ?? '--',
      href: '/modules/m5-flow',
      tone: 'good',
    },
  ];
}
