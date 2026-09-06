import type { EChartsCoreOption } from 'echarts/core';
import type { JsonRecord } from '../../../../services/businessTraceApi';

export type YieldTrendPoint = {
  operationId: string;
  produced: number;
  defect: number;
  rate: number;
};

export const extractOperationYield = (finished?: JsonRecord): YieldTrendPoint[] => {
  const items = Array.isArray(finished?.items) ? (finished.items as JsonRecord[]) : [];
  const byOperation = new Map<string, { produced: number; defect: number }>();
  for (const item of items) {
    const summary = Array.isArray(item.yield_summary) ? (item.yield_summary as JsonRecord[]) : [];
    for (const line of summary) {
      const operationId = String(line.operation_id ?? '');
      if (!operationId) {
        continue;
      }
      const current = byOperation.get(operationId) ?? { produced: 0, defect: 0 };
      current.produced += Number(line.produced ?? 0);
      current.defect += Number(line.defect ?? 0);
      byOperation.set(operationId, current);
    }
  }
  return [...byOperation.entries()].map(([operationId, value]) => {
    const total = value.produced + value.defect;
    const rate = total > 0 ? Math.round((value.produced / total) * 1000) / 10 : 0;
    return { operationId, produced: value.produced, defect: value.defect, rate };
  });
};

/**
 * 工序良率趋势折线。
 * 从成品台账的 yield_summary 按工序聚合良率；后端跨时间良率序列
 * 未交付时以工序维度降级展示。
 */
export const buildYieldTrendOption = (finished?: JsonRecord): EChartsCoreOption => {
  const points = extractOperationYield(finished);
  return {
    title: { text: '工序良率趋势', left: 'center', textStyle: { fontSize: 12 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const items = Array.isArray(params) ? (params as Array<{ dataIndex: number; value: number }>) : [];
        return items
          .map((item) => {
            const point = points[item.dataIndex];
            return point
              ? `${point.operationId}<br/>良率：${item.value}%<br/>产出 ${point.produced} · 不良 ${point.defect}`
              : '';
          })
          .join('<br/>');
      },
    },
    grid: { left: 52, right: 20, top: 44, bottom: 44 },
    xAxis: { type: 'category', data: points.map((point) => point.operationId), name: '工序' },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' }, name: '良率' },
    series: [
      {
        type: 'line',
        smooth: true,
        data: points.map((point) => point.rate),
        label: { show: true, formatter: '{c}%', fontSize: 10 },
        markLine: { data: [{ type: 'average', name: '平均' }] },
      },
    ],
  };
};
