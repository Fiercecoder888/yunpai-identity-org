import type { M3MaterialReadinessLine } from '../../schemas/m3';
import type { M4Alert, M4Tracking } from '../../schemas/m4';
import type { M5FlowDashboardItem } from '../../schemas/m5';
import type { JsonRecord } from '../../services/businessTraceApi';
import type { RiskItem } from '../../types/api';

export type KpiCardStatus = 'loading' | 'ok' | 'empty' | 'error';
export type KpiTone = 'good' | 'warning' | 'danger';
export type KpiTrend = 'up' | 'down' | 'flat';
export type KpiIconKey = 'orders' | 'onTime' | 'shortage' | 'overdueAmount' | 'wip' | 'yield';

export type DashboardKpiCard = {
  key: string;
  label: string;
  href: string;
  status: KpiCardStatus;
  tone: KpiTone;
  value: number | null;
  display: string;
  delta?: string;
  chart?: 'ring' | 'bars';
  ringPercent?: number;
  barValues?: number[];
  barLabels?: string[];
  hint?: string;
  secondary?: number | string | null;
  secondaryLabel?: string;
  goal?: number | null;
  goalValue?: number | null;
  icon?: KpiIconKey;
  trend?: KpiTrend;
  onRetry?: () => void;
};

export type KpiSource = {
  trackingItems: M4Tracking[];
  trackingError: boolean;
  alertItems: M4Alert[];
  readinessLines: M3MaterialReadinessLine[];
  readinessError: boolean;
  readinessAvailable?: boolean;
  flow: M5FlowDashboardItem[];
  flowError: boolean;
  finished?: JsonRecord;
  finishedError: boolean;
  loading: boolean;
};

export const computeCumulativeOrderCount = (flow: M5FlowDashboardItem[]): number => {
  const orderIds = new Set<string>();
  for (const item of flow) {
    for (const order of item.input.orders) {
      orderIds.add(order.order_id);
    }
  }
  return orderIds.size;
};

export const computeOrderCount = computeCumulativeOrderCount;

export const computeOnTimeRate = (tracking: M4Tracking[]): number | null => {
  if (tracking.length === 0) {
    return null;
  }
  const onTime = tracking.filter((item) => !item.is_overdue).length;
  return Math.round((onTime / tracking.length) * 1000) / 10;
};

export const computeShortageCount = (readinessLines: M3MaterialReadinessLine[]): number =>
  readinessLines.filter((line) => line.line_status === 'shortage' || line.shortage_qty > 0).length;

export const computeOverdueAmount = (tracking: M4Tracking[]): number =>
  tracking
    .filter((item) => item.is_overdue)
    .reduce((sum, item) => sum + Number(item.unit_price ?? 0), 0);

export const computeWipOrderCount = (flow: M5FlowDashboardItem[]): number =>
  flow[0]?.output.scheduled_order_count ?? 0;

export const computeYieldRate = (finished?: JsonRecord): number | null => {
  const items = Array.isArray(finished?.items) ? (finished.items as JsonRecord[]) : [];
  let good = 0;
  let defect = 0;
  for (const item of items) {
    good += Number(item.good_total ?? 0);
    defect += Number(item.defect_total ?? 0);
  }
  if (good + defect <= 0) {
    return null;
  }
  return Math.round((good / (good + defect)) * 1000) / 10;
};

export function computeGoalAchievement(
  current: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (target === null || target === undefined || target <= 0) {
    return null;
  }
  if (current === null || current === undefined) {
    return null;
  }
  if (current >= target) {
    return 100;
  }
  return Math.round((current / target) * 1000) / 10;
}

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';

export type RiskSeveritySignals = {
  daysOverdue?: number;
  shortageQty?: number;
  down?: boolean;
};

export const riskSeverityRank: Record<RiskSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function classifyRiskSeverity(level: string, signals: RiskSeveritySignals = {}): RiskSeverity {
  const base: RiskSeverity = level === 'high' || level === 'medium' || level === 'low' ? level : 'none';
  const { daysOverdue = 0, shortageQty = 0, down = false } = signals;
  let boosted: RiskSeverity = 'none';
  if (down) {
    boosted = 'critical';
  } else if (daysOverdue >= 14) {
    boosted = 'critical';
  } else if (daysOverdue >= 7) {
    boosted = 'high';
  } else if (daysOverdue >= 3) {
    boosted = 'medium';
  } else if (shortageQty >= 100) {
    boosted = 'critical';
  } else if (shortageQty >= 50) {
    boosted = 'high';
  } else if (shortageQty >= 10) {
    boosted = 'medium';
  }
  return riskSeverityRank[boosted] >= riskSeverityRank[base] ? boosted : base;
}

export const kpiTargets: Record<string, number> = {
  onTime: 90,
  yield: 95,
  shortage: 3,
  overdueAmount: 0,
};

export const kpiIconMap: Record<string, KpiIconKey> = {
  orders: 'orders',
  onTime: 'onTime',
  shortage: 'shortage',
  overdueAmount: 'overdueAmount',
  wip: 'wip',
  yield: 'yield',
};

export function computeTrend(values: number[]): KpiTrend {
  if (values.length < 2) {
    return 'flat';
  }
  const last = values[values.length - 1] ?? 0;
  const previous = values[values.length - 2] ?? 0;
  if (last > previous) {
    return 'up';
  }
  if (last < previous) {
    return 'down';
  }
  return 'flat';
}

const planOrderBars = (flow: M5FlowDashboardItem[]) => ({
  barValues: flow.map((item) => item.input.order_count),
  barLabels: flow.map((item) => item.plan_version),
});

const planWipBars = (flow: M5FlowDashboardItem[]) => ({
  barValues: flow.map((item) => item.output.scheduled_order_count),
  barLabels: flow.map((item) => item.plan_version),
});

export function buildKpiRow(source: KpiSource): DashboardKpiCard[] {
  const { trackingItems, readinessLines, flow, finished, loading } = source;

  const currentOrderCount = flow[0]?.input.order_count ?? 0;
  const cumulativeOrderCount = computeCumulativeOrderCount(flow);
  const onTimeRate = computeOnTimeRate(trackingItems);
  const shortageCount = computeShortageCount(readinessLines);
  const overdueAmount = computeOverdueAmount(trackingItems);
  const overdueCount = trackingItems.filter((item) => item.is_overdue).length;
  const wipCount = computeWipOrderCount(flow);
  const yieldRate = computeYieldRate(finished);
  const finishedItems = Array.isArray(finished?.items) ? (finished.items as JsonRecord[]).length : 0;

  const shortageLines = readinessLines.filter((line) => line.line_status === 'shortage' || line.shortage_qty > 0);
  const totalShortageQty = shortageLines.reduce((sum, line) => sum + line.shortage_qty, 0);
  const readinessAvailable = source.readinessAvailable ?? true;

  return [
    {
      key: 'orders',
      label: '本月订单数',
      href: '/modules/m5-flow',
      status: loading ? 'loading' : source.flowError ? 'error' : 'ok',
      tone: currentOrderCount > 0 ? 'good' : 'good',
      value: currentOrderCount,
      display: String(currentOrderCount),
      secondary: cumulativeOrderCount,
      secondaryLabel: '累计',
      icon: 'orders',
      trend: computeTrend(flow.map((item) => item.input.order_count)),
      chart: 'bars',
      ...planOrderBars(flow),
    },
    {
      key: 'onTime',
      label: '准交率',
      href: '/modules/purchase-warnings',
      status: loading ? 'loading' : source.trackingError ? 'error' : onTimeRate === null ? 'empty' : 'ok',
      tone: onTimeRate === null ? 'good' : onTimeRate >= 90 ? 'good' : onTimeRate >= 70 ? 'warning' : 'danger',
      value: onTimeRate,
      display: onTimeRate === null ? '--' : `${onTimeRate}%`,
      secondary: overdueCount,
      secondaryLabel: '逾期单',
      goal: kpiTargets.onTime,
      goalValue: onTimeRate,
      icon: 'onTime',
      chart: 'ring',
      ringPercent: onTimeRate ?? 0,
      hint: onTimeRate === null ? '暂无追踪数据' : undefined,
    },
    {
      key: 'shortage',
      label: '缺料物料数',
      href: '/modules/m3-procurement',
      status: loading ? 'loading' : source.readinessError ? 'error' : readinessAvailable ? 'ok' : 'empty',
      tone: shortageCount === 0 ? 'good' : shortageCount <= 3 ? 'warning' : 'danger',
      value: readinessAvailable ? shortageCount : null,
      display: readinessAvailable ? String(shortageCount) : '--',
      secondary: readinessAvailable ? totalShortageQty : null,
      secondaryLabel: '缺料总量',
      hint: readinessAvailable ? undefined : '订单级指标，请进入 M3 选择订单后查看',
      icon: 'shortage',
      chart: 'bars',
      barValues: shortageLines.map((line) => line.shortage_qty),
      barLabels: shortageLines.map((line) => line.material_code),
    },
    {
      key: 'overdueAmount',
      label: '逾期采购金额',
      href: '/modules/purchase-warnings',
      status: loading ? 'loading' : source.trackingError ? 'error' : 'ok',
      tone: overdueAmount > 0 ? 'danger' : 'good',
      value: overdueAmount,
      display: `¥${overdueAmount.toFixed(2)}`,
      secondary: overdueCount,
      secondaryLabel: '逾期笔数',
      icon: 'overdueAmount',
      chart: 'bars',
      barValues: trackingItems.filter((item) => item.is_overdue).map((item) => Number(item.unit_price ?? 0)),
      barLabels: trackingItems.filter((item) => item.is_overdue).map((item) => String(item.purchase_order_item_id)),
    },
    {
      key: 'wip',
      label: '在产工单数',
      href: '/modules/m5-flow',
      status: loading ? 'loading' : source.flowError ? 'error' : 'ok',
      tone: wipCount > 0 ? 'good' : 'good',
      value: wipCount,
      display: String(wipCount),
      secondary: flow.length,
      secondaryLabel: '计划版本',
      icon: 'wip',
      trend: computeTrend(flow.map((item) => item.output.scheduled_order_count)),
      chart: 'bars',
      ...planWipBars(flow),
    },
    {
      key: 'yield',
      label: '良率',
      href: '/modules/finished-goods',
      status: loading ? 'loading' : source.finishedError ? 'error' : yieldRate === null ? 'empty' : 'ok',
      tone: yieldRate === null ? 'good' : yieldRate >= 95 ? 'good' : yieldRate >= 90 ? 'warning' : 'danger',
      value: yieldRate,
      display: yieldRate === null ? '--' : `${yieldRate}%`,
      secondary: finishedItems,
      secondaryLabel: '成品',
      goal: kpiTargets.yield,
      goalValue: yieldRate,
      icon: 'yield',
      chart: 'ring',
      ringPercent: yieldRate ?? 0,
      hint: yieldRate === null ? '暂无成品数据' : undefined,
    },
  ];
}

export type RiskBucketKey = 'danger' | 'warning' | 'success';

export type RiskBucketItem = {
  id: string;
  title: string;
  description: string;
  module?: string;
  severity?: RiskSeverity;
};

export type RiskBucket = {
  key: RiskBucketKey;
  label: string;
  count: number;
  href: string;
  items: RiskBucketItem[];
};

export type RiskInput = {
  alertItems: M4Alert[];
  readinessLines: M3MaterialReadinessLine[];
  flow: M5FlowDashboardItem[];
  dashboardRisks: RiskItem[];
  healthyModuleCount: number;
};

export function buildRiskBuckets(input: RiskInput): RiskBucket[] {
  const danger: RiskBucket['items'] = [];
  const warning: RiskBucket['items'] = [];
  const success: RiskBucket['items'] = [];

  for (const risk of input.dashboardRisks) {
    const item: RiskBucketItem = {
      id: `dashboard-${risk.id}`,
      title: risk.title,
      description: risk.description,
      module: risk.module,
      severity: classifyRiskSeverity(risk.level),
    };
    if (risk.level === 'high') danger.push(item);
    else if (risk.level === 'medium') warning.push(item);
    else success.push(item);
  }

  for (const alert of input.alertItems) {
    const overdue = alert.days_overdue > 0;
    const item: RiskBucketItem = {
      id: `alert-${alert.id}`,
      title: overdue ? `${alert.item_name} 逾期 ${alert.days_overdue} 天` : `${alert.item_name} 即将到期`,
      description: overdue ? `${alert.supplier_name} · ${alert.purchase_order_no}` : `${alert.supplier_name} · 承诺 ${alert.promised_date}`,
      module: 'M4',
      severity: classifyRiskSeverity(overdue ? 'high' : 'medium', { daysOverdue: alert.days_overdue }),
    };
    if (overdue) {
      danger.push(item);
    } else {
      warning.push(item);
    }
  }

  for (const line of input.readinessLines) {
    if (line.line_status === 'shortage' || line.shortage_qty > 0) {
      danger.push({
        id: `readiness-${line.material_code}`,
        title: `${line.material_name} 缺料`,
        description: `缺料 ${line.shortage_qty} ${line.uom}，建议采购 ${line.suggest_purchase_qty}`,
        module: 'M3',
        severity: classifyRiskSeverity('high', { shortageQty: line.shortage_qty }),
      });
    }
  }

  for (const plan of input.flow) {
    if (plan.overall_status === 'attention') {
      warning.push({
        id: `flow-${plan.plan_version}`,
        title: `排程 ${plan.plan_version} 需关注`,
        description: `进度 ${plan.progress_percent}%，存在未完成环节`,
        module: 'M5',
        severity: classifyRiskSeverity('medium'),
      });
    } else if (plan.overall_status === 'complete') {
      success.push({
        id: `flow-${plan.plan_version}`,
        title: `排程 ${plan.plan_version} 求解完成`,
        description: `当前流程进度 ${plan.progress_percent}%，审批、派发和执行状态请进入 M5 查看`,
        module: 'M5',
        severity: classifyRiskSeverity('low'),
      });
    }
  }

  return [
    {
      key: 'danger',
      label: '高风险',
      count: danger.length,
      href: '/modules/purchase-warnings',
      items: danger,
    },
    {
      key: 'warning',
      label: '中风险',
      count: warning.length,
      href: '/modules/purchase-warnings',
      items: warning,
    },
    {
      key: 'success',
      label: '正常',
      count: success.length + input.healthyModuleCount,
      href: '/modules/m5-flow',
      items: success,
    },
  ];
}
