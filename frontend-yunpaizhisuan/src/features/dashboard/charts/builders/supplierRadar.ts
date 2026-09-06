import type { EChartsCoreOption } from 'echarts/core';
import type { M4Alert } from '../../../../schemas/m4';

export type SupplierRiskProfile = {
  name: string;
  values: number[];
};

const INDICATORS = [
  { key: 'overdueCount', name: '逾期单数', max: 8 },
  { key: 'totalDelayDays', name: '累计逾期天数', max: 60 },
  { key: 'openAlerts', name: '在办预警', max: 8 },
  { key: 'exceptions', name: '供应异常', max: 8 },
] as const;

export type SupplierRiskIndicatorKey = (typeof INDICATORS)[number]['key'];

/**
 * 供应商风险雷达（M4 alert 派生）。
 * 后端供应商多维评分未交付，用 M4 采购预警聚合出
 * 逾期单数/累计逾期天数/在办预警/供应异常四维指标。
 */
export const buildSupplierRadarOption = (alerts: M4Alert[]): EChartsCoreOption => {
  const bySupplier = new Map<string, SupplierRiskProfile>();
  for (const alert of alerts) {
    const name = alert.supplier_name;
    const profile = bySupplier.get(name) ?? {
      name,
      values: [0, 0, 0, 0],
    };
    const values = profile.values;
    if (alert.status === 'open' || alert.status === 'processing') {
      values[2] = (values[2] ?? 0) + 1;
    }
    if (alert.alert_type === 'overdue' && alert.days_overdue > 0) {
      values[0] = (values[0] ?? 0) + 1;
      values[1] = (values[1] ?? 0) + alert.days_overdue;
    }
    if (alert.alert_type === 'supplier_exception') {
      values[3] = (values[3] ?? 0) + 1;
    }
    bySupplier.set(name, profile);
  }
  const profiles = [...bySupplier.values()];
  return {
    title: { text: '供应商风险雷达（预警派生）', left: 'center', textStyle: { fontSize: 12 } },
    tooltip: { trigger: 'item' },
    legend: { type: 'scroll', bottom: 0 },
    radar: {
      indicator: INDICATORS.map((item) => ({ name: item.name, max: item.max })),
      radius: '62%',
    },
    series: [
      {
        type: 'radar',
        data: profiles.map((profile) => ({ name: profile.name, value: profile.values })),
        areaStyle: { opacity: 0.15 },
      },
    ],
  };
};
