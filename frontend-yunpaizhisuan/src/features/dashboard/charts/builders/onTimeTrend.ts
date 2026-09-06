import type { EChartsCoreOption } from 'echarts/core';
import type { M5FlowDashboardItem } from '../../../../schemas/m5';

export type OnTimeTrendPoint = {
  version: string;
  acknowledged: number;
  total: number;
};

export const extractDispatchAckRates = (flow: M5FlowDashboardItem[]): OnTimeTrendPoint[] =>
  flow.map((item) => ({
    version: item.plan_version,
    acknowledged: item.output.dispatch_acknowledged_count,
    total: item.output.dispatch_item_count,
  }));

/**
 * 准交率趋势折线（降级：各版本派发确认率）。
 * 后端尚无跨时间准交率序列，用 M5 flow dashboard 每版本的
 * 派发确认数/派发总数作为可观测代理。
 */
export const buildOnTimeTrendOption = (flow: M5FlowDashboardItem[]): EChartsCoreOption => {
  const points = extractDispatchAckRates(flow);
  const versions = points.map((point) => point.version);
  const rates = points.map((point) => (point.total > 0 ? Math.round((point.acknowledged / point.total) * 1000) / 10 : 0));
  return {
    title: { text: '各版本派发确认率（准交率降级代理）', left: 'center', textStyle: { fontSize: 12 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 52, right: 20, top: 44, bottom: 44 },
    xAxis: { type: 'category', data: versions, name: '计划版本' },
    yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' }, name: '确认率' },
    series: [
      {
        type: 'line',
        smooth: true,
        data: rates,
        areaStyle: { opacity: 0.12 },
        label: { show: true, formatter: '{c}%', fontSize: 10 },
        emphasis: { focus: 'series' },
      },
    ],
  };
};
