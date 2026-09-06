import { FundProjectionScreenOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Row, Space, Statistic, Timeline, Typography } from 'antd';
import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PermissionGate } from '../components/PermissionGate';
import { PageState } from '../components/PageState';
import { StatusTag } from '../components/StatusTag';
import { ChatPanel } from '../features/chat/ChatPanel';
import { AgentFlowPanel } from '../features/agent-flow/AgentFlowPanel';
import { DashboardKpiRow } from '../features/dashboard/DashboardKpiRow';
import { RiskSummaryCards } from '../features/dashboard/RiskSummaryCards';
import { RiskModuleMatrix } from '../features/dashboard/RiskModuleMatrix';
import { RiskDetailDrawer } from '../features/dashboard/RiskDetailDrawer';
import { DashboardCharts } from '../features/dashboard/DashboardCharts';
import { useDashboardKpis } from '../features/dashboard/useDashboardKpis';
import type { RiskBucketItem } from '../features/dashboard/dashboardKpis';

const DashboardECharts = lazy(() =>
  import('../features/dashboard/charts/DashboardECharts').then((module) => ({
    default: module.DashboardECharts,
  })),
);

const moduleRoutes: Record<string, string> = {
  m1: '/modules/m0-review',
  m2: '/modules/bom-review',
  m3: '/modules/m3-procurement',
  m4: '/modules/purchase-warnings',
  m5: '/modules/m5-flow',
  m7: '/modules/legal-final-review',
};

export function DashboardPage() {
  return (
    <PermissionGate permission="dashboard:read" auditModule="Dashboard" targetId="dashboard">
      <DashboardContent />
    </PermissionGate>
  );
}

function DashboardContent() {
  const navigate = useNavigate();
  const { kpis, buckets, loading: kpiLoading, summary, summaryLoading, summaryError, refresh } = useDashboardKpis();
  const [selectedRisk, setSelectedRisk] = useState<RiskBucketItem | null>(null);
  const highRiskCount = summary?.risks.filter((item) => item.level === 'high').length ?? 0;

  const openRisk = (item: RiskBucketItem) => setSelectedRisk(item);
  const closeRisk = () => setSelectedRisk(null);

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={2}>Dashboard</Typography.Title>
          <Typography.Text type="secondary">业务 KPI 与运营风险驾驶舱</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/modules/m5-flow')}>
            M5 流程看板
          </Button>
          <Button type="primary" icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/cockpit')} aria-label="进入驾驶舱">
            进入驾驶舱
          </Button>
          <Button
            type="primary"
            icon={<FundProjectionScreenOutlined />}
            href="/business.html"
            target="_blank"
            aria-label="业务追踪"
          >
            订单到排程 业务追踪
          </Button>
        </Space>
      </div>

      <PageState loading={summaryLoading} error={summaryError} empty={summary?.modules.length === 0}>
        <Alert
          type={highRiskCount > 0 ? 'warning' : 'success'}
          showIcon
          message={highRiskCount > 0 ? `当前有 ${highRiskCount} 个高风险模块需要处理` : '订单到排程 服务连接正常'}
          description={highRiskCount > 0 ? '请在下方模块状态和风险卡中查看不可达服务。' : '模块卡片和流程图状态来自实时健康接口。'}
        />

        <Card
          size="small"
          title="经营 KPI"
          extra={
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh} aria-label="刷新">
              刷新
            </Button>
          }
        >
          {kpiLoading && kpis.every((kpi) => kpi.status === 'loading') ? (
            <Alert type="info" showIcon message="正在加载经营 KPI 数据..." />
          ) : (
            <DashboardKpiRow kpis={kpis} />
          )}
        </Card>

        <Card size="small" title="风险三色卡">
          <RiskSummaryCards buckets={buckets} onItemClick={openRisk} />
          <RiskModuleMatrix buckets={buckets} />
        </Card>

        <Card size="small" title="趋势与分布">
          <DashboardCharts kpis={kpis} buckets={buckets} />
        </Card>

        <Card size="small" title="深度图表（ECharts）">
          <Suspense fallback={<Alert type="info" showIcon message="正在加载图表..." />}>
            <DashboardECharts />
          </Suspense>
        </Card>

        <Row gutter={[16, 16]}>
          {summary?.modules.map((item) => {
            const route = moduleRoutes[item.id];
            const openRoute = () => {
              if (route) {
                navigate(route);
              }
            };

            return (
              <Col span={6} key={item.id}>
                <Card
                  className={`metric-card${route ? ' metric-card-clickable' : ''}`}
                  role={route ? 'link' : undefined}
                  tabIndex={route ? 0 : undefined}
                  aria-label={route ? `进入 ${item.name}` : undefined}
                  onClick={openRoute}
                  onKeyDown={(event) => {
                    if (!route || (event.key !== 'Enter' && event.key !== ' ')) {
                      return;
                    }

                    event.preventDefault();
                    openRoute();
                  }}
                >
                  <Statistic title={item.name} value={item.metric} suffix="项" />
                  <div className="status-tag">
                    <StatusTag value={item.status} />
                    <StatusTag value={item.riskLevel} />
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>

        <Row gutter={[16, 16]}>
          <Col span={12}>
            <ChatPanel />
          </Col>
          <Col span={12}>
            <Card title="最近 Agent 活动">
              <Timeline
                items={summary?.activities.map((item) => ({
                  color: item.status === 'error' ? 'red' : item.status === 'warning' ? 'gold' : 'blue',
                  children: `${item.time} ${item.module} ${item.message}`,
                }))}
              />
            </Card>
          </Col>
        </Row>

        <AgentFlowPanel />
        <RiskDetailDrawer item={selectedRisk} open={selectedRisk !== null} onClose={closeRisk} />
      </PageState>
    </Space>
  );
}
