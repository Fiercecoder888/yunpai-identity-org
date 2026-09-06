import type { EChartsCoreOption } from 'echarts/core';
import type { M5FlowDashboardItem } from '../../../../schemas/m5';

export type CapacityStackedSource = {
  flow: M5FlowDashboardItem[];
};

export type CapacityStackedPoint = {
  planVersion: string;
  resource: string;
  minutes: number;
};

/**
 * 产能负载堆叠（M5 排程聚合）。
 * 从 M5 flow dashboard 的 output.resource_load_minutes（每版本每资源已排程分钟）
 * 聚合成 资源 × 版本 的堆叠柱状图；缺该字段时退化为操作明细统计。
 */
export const buildCapacityStackedOption = ({ flow }: CapacityStackedSource): EChartsCoreOption => {
  const resources = Array.from(
    new Set(
      flow.flatMap((item) => Object.keys(item.output.resource_load_minutes ?? {})),
    ),
  ).slice(0, 20);
  const series = resources.map((resource) => ({
    name: resource,
    type: 'bar' as const,
    stack: 'total',
    emphasis: { focus: 'series' as const },
    data: flow.map((item) => item.output.resource_load_minutes?.[resource] ?? 0),
  }));
  return {
    title: { text: '产能负载堆叠（资源 × 排程版本）', left: 'center', textStyle: { fontSize: 12 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { type: 'scroll', bottom: 0 },
    grid: { left: 64, right: 24, top: 44, bottom: 88 },
    xAxis: { type: 'category', data: flow.map((item) => item.plan_version), name: '排程版本' },
    yAxis: { type: 'value', name: '分钟' },
    series,
  };
};
