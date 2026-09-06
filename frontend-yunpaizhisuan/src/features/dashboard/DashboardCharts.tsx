import { Card, Col, Row, Typography } from 'antd';
import type { DashboardKpiCard, RiskBucket, RiskBucketKey } from './dashboardKpis';
import { MiniBarChart, RingChart, StackedBarChart } from './MiniCharts';

const riskColors: Record<RiskBucketKey, string> = {
  danger: '#ef4444',
  warning: '#d97706',
  success: '#16a34a',
};

type DashboardChartsProps = {
  kpis: DashboardKpiCard[];
  buckets: RiskBucket[];
};

function KpiById({ kpis, key }: { kpis: DashboardKpiCard[]; key: string }) {
  return kpis.find((item) => item.key === key);
}

export function DashboardCharts({ kpis, buckets }: DashboardChartsProps) {
  const onTime = KpiById({ kpis, key: 'onTime' });
  const yieldRate = KpiById({ kpis, key: 'yield' });
  const orders = KpiById({ kpis, key: 'orders' });
  const wip = KpiById({ kpis, key: 'wip' });

  const segments = buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    count: bucket.count,
    color: riskColors[bucket.key],
  }));

  return (
    <Row gutter={[12, 12]} className="dashboard-charts-row">
      <Col xs={24} md={8}>
        <Card size="small" title="准交率 / 良率" className="dashboard-chart-card">
          <div className="dashboard-ring-grid">
            <div className="dashboard-ring-cell">
              <RingChart percent={onTime?.ringPercent ?? 0} color={onTime?.tone === 'danger' ? '#ef4444' : '#1677ff'} label="准交率" />
              <Typography.Text type="secondary">准交率</Typography.Text>
            </div>
            <div className="dashboard-ring-cell">
              <RingChart percent={yieldRate?.ringPercent ?? 0} color="#16a34a" label="良率" />
              <Typography.Text type="secondary">良率</Typography.Text>
            </div>
          </div>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card size="small" title="订单 / 在产（按计划版本）" className="dashboard-chart-card">
          <Typography.Text type="secondary">本月订单数</Typography.Text>
          <MiniBarChart
            values={orders?.barValues ?? []}
            labels={orders?.barLabels ?? []}
            label="各版本订单数"
          />
          <Typography.Text type="secondary" style={{ marginTop: 12, display: 'block' }}>
            在产工单数
          </Typography.Text>
          <MiniBarChart
            values={wip?.barValues ?? []}
            labels={wip?.barLabels ?? []}
            color="#d97706"
            label="各版本在产工单"
          />
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card size="small" title="风险分布" className="dashboard-chart-card">
          <StackedBarChart segments={segments} label="风险分布" />
          <div className="dashboard-chart-hint">
            <Typography.Text type="secondary">红色逾期/缺料，黄色临期待跟进，绿色正常。</Typography.Text>
          </div>
        </Card>
      </Col>
    </Row>
  );
}
