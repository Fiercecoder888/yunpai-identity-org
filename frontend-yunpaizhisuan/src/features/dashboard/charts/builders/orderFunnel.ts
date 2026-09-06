import type { EChartsCoreOption } from 'echarts/core';
import type { M5FlowDashboardItem, M5FlowStage } from '../../../../schemas/m5';

const STAGES: Array<{ key: M5FlowStage['key']; label: string }> = [
  { key: 'input', label: '输入' },
  { key: 'scheduling', label: '排程' },
  { key: 'validation', label: '校验' },
  { key: 'approval', label: '审批' },
  { key: 'dispatch', label: '派发' },
  { key: 'execution', label: '执行' },
];

/**
 * 订单漏斗（M5 阶段）。
 * 统计各 flow 版本中处于 succeeded 的 M5 阶段数量，聚合为漏斗；
 * 阶段顺序即业务执行顺序，展示每个环节完整收口的订单规模。
 */
export const buildOrderFunnelOption = (flow: M5FlowDashboardItem[]): EChartsCoreOption => {
  const data = STAGES.map((stage) => {
    const value = flow.reduce(
      (sum, item) => sum + (item.stages.find((entry) => entry.key === stage.key)?.status === 'succeeded' ? 1 : 0),
      0,
    );
    return { name: stage.label, value };
  }).filter((entry) => entry.value > 0);
  return {
    title: { text: '订单漏斗（M5 阶段收口）', left: 'center', textStyle: { fontSize: 12 } },
    tooltip: { trigger: 'item', formatter: '{b}：{c} 个版本' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'funnel',
        left: '12%',
        top: 32,
        bottom: 40,
        width: '76%',
        minSize: '12%',
        maxSize: '100%',
        label: { formatter: '{b}：{c}' },
        data,
      },
    ],
  };
};
