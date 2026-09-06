import { Card, Col, Empty, Row, Spin } from 'antd';
import { EChartPanel } from './EChartPanel';
import { useDashboardKpis } from '../useDashboardKpis';
import {
  buildCapacityStackedOption,
  buildOnTimeTrendOption,
  buildOrderFunnelOption,
  buildShortageHeatmapOption,
  buildSupplierRadarOption,
  buildYieldTrendOption,
} from './builders';

export function DashboardECharts() {
  const { sources, loading } = useDashboardKpis();
  const { flow, alertItems, readinessLines, finished } = sources;

  const hasData =
    flow.length > 0 || readinessLines.length > 0 || alertItems.length > 0 || Boolean(finished);

  if (loading && !hasData) {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spin tip="加载图表数据" />
      </div>
    );
  }

  if (!hasData) {
    return <Empty description="暂无图表数据（后端未交付跨时间/多维聚合）" />;
  }

  const panels = [
    {
      title: '准交率趋势',
      aria: '准交率趋势折线（各版本派发确认率）',
      option: buildOnTimeTrendOption(flow),
      visible: flow.length > 0,
    },
    {
      title: '缺料热力',
      aria: '缺料热力图（物料 × 状态）',
      option: buildShortageHeatmapOption(readinessLines),
      visible: readinessLines.length > 0,
    },
    {
      title: '产能负载',
      aria: '产能负载堆叠（资源 × 排程版本）',
      option: buildCapacityStackedOption({ flow }),
      visible: flow.length > 0,
    },
    {
      title: '订单漏斗',
      aria: '订单漏斗（M5 阶段收口）',
      option: buildOrderFunnelOption(flow),
      visible: flow.length > 0,
    },
    {
      title: '供应商风险',
      aria: '供应商风险雷达（预警派生）',
      option: buildSupplierRadarOption(alertItems),
      visible: alertItems.length > 0,
    },
    {
      title: '工序良率',
      aria: '工序良率趋势折线',
      option: buildYieldTrendOption(finished),
      visible: Boolean(finished),
    },
  ];

  return (
    <Row gutter={[12, 12]} className="dashboard-echarts-row">
      {panels
        .filter((panel) => panel.visible)
        .map((panel) => (
          <Col xs={24} md={12} xl={8} key={panel.title}>
            <Card size="small" title={panel.title}>
              <EChartPanel option={panel.option} ariaLabel={panel.aria} height={240} />
            </Card>
          </Col>
        ))}
    </Row>
  );
}
