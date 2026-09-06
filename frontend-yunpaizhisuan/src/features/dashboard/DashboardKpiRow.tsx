import {
  AlertOutlined,
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  MinusOutlined,
  MoneyCollectOutlined,
  ReloadOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Skeleton, Space, Tag, Tooltip, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { RingChart, MiniBarChart } from './MiniCharts';
import {
  computeGoalAchievement,
  kpiIconMap,
  type DashboardKpiCard,
  type KpiCardStatus,
  type KpiIconKey,
  type KpiTone,
  type KpiTrend,
} from './dashboardKpis';

const toneColor: Record<KpiTone, string> = {
  good: '#16a34a',
  warning: '#d97706',
  danger: '#ef4444',
};

const statusLabel: Record<KpiCardStatus, string> = {
  loading: '加载中',
  ok: '正常',
  empty: '暂无数据',
  error: '加载失败',
};

const iconNode: Record<KpiIconKey, ReactNode> = {
  orders: <ShoppingCartOutlined />,
  onTime: <ClockCircleOutlined />,
  shortage: <AlertOutlined />,
  overdueAmount: <MoneyCollectOutlined />,
  wip: <AppstoreOutlined />,
  yield: <CheckCircleOutlined />,
};

const trendNode: Record<KpiTrend, ReactNode> = {
  up: <ArrowUpOutlined className="dashboard-kpi-trend-up" role="img" aria-label="趋势上升" />,
  down: <ArrowDownOutlined className="dashboard-kpi-trend-down" role="img" aria-label="趋势下降" />,
  flat: <MinusOutlined className="dashboard-kpi-trend-flat" role="img" aria-label="趋势持平" />,
};

type DashboardKpiRowProps = {
  kpis: DashboardKpiCard[];
};

export function DashboardKpiRow({ kpis }: DashboardKpiRowProps) {
  const navigate = useNavigate();

  return (
    <Row gutter={[12, 12]} className="dashboard-kpi-row">
      {kpis.map((kpi) => {
        const open = () => navigate(kpi.href);
        const color = toneColor[kpi.tone];
        const iconKey = kpi.icon ? kpiIconMap[kpi.icon] : undefined;
        const achievement =
          kpi.goal !== null && kpi.goal !== undefined && kpi.goalValue !== null && kpi.goalValue !== undefined
            ? computeGoalAchievement(kpi.goalValue, kpi.goal)
            : null;
        const chart =
          kpi.status === 'ok' && kpi.chart === 'ring' && kpi.ringPercent !== undefined ? (
            <RingChart percent={kpi.ringPercent} color={color} label={`${kpi.label} ${kpi.display}`} />
          ) : kpi.status === 'ok' && kpi.chart === 'bars' && kpi.barValues && kpi.barValues.length > 0 ? (
            <MiniBarChart values={kpi.barValues} labels={kpi.barLabels} color={color} label={`${kpi.label} 趋势`} />
          ) : null;

        return (
          <Col key={kpi.key} xs={24} sm={12} lg={8} xl={4}>
            <Card
              size="small"
              className="dashboard-kpi-card"
              role={kpi.status === 'error' ? undefined : 'link'}
              tabIndex={kpi.status === 'error' ? undefined : 0}
              aria-label={kpi.status === 'error' ? `${kpi.label} 数据加载失败` : `进入 ${kpi.label}`}
              onClick={kpi.status === 'error' ? undefined : open}
              onKeyDown={(event) => {
                if (kpi.status === 'error') return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  open();
                }
              }}
            >
              <div className="dashboard-kpi-head">
                <Space size={6} align="center">
                  {iconKey ? <span className="dashboard-kpi-icon" style={{ color }}>{iconNode[iconKey]}</span> : null}
                  <Typography.Text type="secondary">{kpi.label}</Typography.Text>
                </Space>
                <Tag color={kpi.status === 'ok' ? 'green' : kpi.status === 'error' ? 'red' : 'default'}>{statusLabel[kpi.status]}</Tag>
              </div>
              <div className="dashboard-kpi-value" style={{ color }}>
                {kpi.status === 'loading' ? <Skeleton.Input active size="small" /> : kpi.display}
              </div>
              {kpi.secondary !== null && kpi.secondary !== undefined && kpi.status === 'ok' ? (
                <div className="dashboard-kpi-secondary">
                  <Typography.Text type="secondary">
                    {kpi.secondaryLabel ? `${kpi.secondaryLabel} ` : ''}
                    {kpi.secondary}
                  </Typography.Text>
                </div>
              ) : null}
              <div className="dashboard-kpi-meta">
                {kpi.trend ? <span className="dashboard-kpi-trend">{trendNode[kpi.trend]}</span> : null}
                {kpi.delta ? (
                  <Typography.Text type="secondary" className="dashboard-kpi-delta">
                    {kpi.delta}
                  </Typography.Text>
                ) : null}
                {kpi.hint ? (
                  <Tooltip title={kpi.hint}>
                    <Typography.Text type="secondary" className="dashboard-kpi-hint">
                      说明
                    </Typography.Text>
                  </Tooltip>
                ) : null}
                {kpi.status === 'error' && kpi.onRetry ? (
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    className="dashboard-kpi-retry"
                    onClick={(event) => {
                      event.stopPropagation();
                      kpi.onRetry?.();
                    }}
                  >
                    重试
                  </Button>
                ) : null}
              </div>
              {achievement !== null ? (
                <div className="dashboard-kpi-goal">
                  <Tooltip title={`目标 ${kpi.goal}%`}>
                    <Progress percent={achievement} size="small" strokeColor={achievement >= 100 ? '#16a34a' : '#d97706'} />
                  </Tooltip>
                </div>
              ) : null}
              {chart ? <div className="dashboard-kpi-chart">{chart}</div> : null}
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
