import { Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd';
import { EnvironmentOutlined, PushpinOutlined, RightOutlined } from '@ant-design/icons';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PermissionCode } from '../../services/permissionApi';
import { useRecentVisitPaths, useRecentVisitsStore, type RecentVisit } from '../../store/useRecentVisitsStore';
import { useDashboardKpis } from '../dashboard/useDashboardKpis';
import { useTodoCenter } from '../todos/useTodoCenter';
import { TodoProgress } from '../todos/TodoProgress';
import { useTodoDismissStore } from '../todos/useTodoDismissStore';
import { buildMetrics, type WorkbenchMetric } from './metrics';

export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) {
    return '早上好';
  }
  if (hour >= 12 && hour < 14) {
    return '中午好';
  }
  if (hour >= 14 && hour < 18) {
    return '下午好';
  }
  return '晚上好';
}

export function WorkbenchWelcome({
  roleName,
  permissions,
}: {
  roleId?: string;
  roleName?: string;
  permissions?: PermissionCode[];
}) {
  const navigate = useNavigate();
  const { kpis, buckets } = useDashboardKpis();
  const todo = useTodoCenter(permissions);
  const dismissed = useTodoDismissStore((state) => state.dismissed);
  const { recent, pinned } = useRecentVisitPaths();
  const togglePin = useRecentVisitsStore((state) => state.togglePin);

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const doneCount = todo.detailItems.filter((item) => dismissedSet.has(item.id)).length;
  const dangerCount = buckets.find((bucket) => bucket.key === 'danger')?.count ?? 0;
  const loading = kpis.some((kpi) => kpi.status === 'loading') || todo.loading;
  const metrics = useMemo(
    () => buildMetrics({ kpis, dangerCount, todoTotal: todo.total, loading }),
    [kpis, dangerCount, todo.total, loading],
  );
  const greeting = greetingForHour(new Date().getHours());

  return (
    <Card className="workbench-welcome" data-testid="workbench-welcome">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <div className="workbench-greeting">
            <Typography.Title level={3}>
              {greeting}，{roleName ?? '厂长'}
            </Typography.Title>
            <Typography.Text type="secondary">欢迎回到云湃智造运营中心，今天也有条不紊地推进生产。</Typography.Text>
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" className="weather-placeholder">
            <Space>
              <EnvironmentOutlined />
              <Typography.Text type="secondary">天气模块占位（真实天气待接入）</Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <div className="workbench-todo-progress">
        <TodoProgress done={doneCount} total={todo.detailItems.length} />
      </div>

      <MetricQuickRow metrics={metrics} onNavigate={navigate} />

      <RecentVisitsRow recent={recent} pinned={pinned} onTogglePin={togglePin} onNavigate={navigate} />
    </Card>
  );
}

function MetricQuickRow({ metrics, onNavigate }: { metrics: WorkbenchMetric[]; onNavigate: (path: string) => void }) {
  return (
    <Row gutter={[12, 12]} className="workbench-metric-row">
      {metrics.map((metric) => (
        <Col xs={12} lg={6} key={metric.key}>
          <Card
            size="small"
            className="metric-card metric-card-clickable"
            role="link"
            tabIndex={0}
            aria-label={`进入 ${metric.label}`}
            onClick={() => onNavigate(metric.href)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onNavigate(metric.href);
              }
            }}
          >
            <Statistic
              title={metric.label}
              value={metric.display}
              valueStyle={{ color: metric.tone === 'danger' ? '#ef4444' : metric.tone === 'warning' ? '#d97706' : undefined }}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function RecentVisitsRow({
  recent,
  pinned,
  onTogglePin,
  onNavigate,
}: {
  recent: RecentVisit[];
  pinned: string[];
  onTogglePin: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  if (recent.length === 0 && pinned.length === 0) {
    return (
      <div className="workbench-recent-visits">
        <Typography.Text type="secondary">最近访问将在您浏览页面后出现在这里。</Typography.Text>
      </div>
    );
  }

  const pinnedVisits = recent.filter((visit) => pinned.includes(visit.path));
  const otherVisits = recent.filter((visit) => !pinned.includes(visit.path));

  const renderVisit = (visit: RecentVisit) => (
    <ButtonLink
      key={visit.path}
      title={visit.title}
      pinned={pinned.includes(visit.path)}
      onClick={() => onNavigate(visit.path)}
      onPinClick={() => onTogglePin(visit.path)}
    />
  );

  return (
    <div className="workbench-recent-visits">
      <Space size={8} wrap>
        {pinnedVisits.map(renderVisit)}
        {otherVisits.map(renderVisit)}
      </Space>
    </div>
  );
}

function ButtonLink({
  title,
  pinned,
  onClick,
  onPinClick,
}: {
  title: string;
  pinned: boolean;
  onClick: () => void;
  onPinClick: () => void;
}) {
  return (
    <Card size="small" className="recent-visit-chip" data-testid="recent-visit-chip">
      <Space size={6}>
        {pinned ? <Tag color="blue">固定</Tag> : null}
        <button type="button" className="recent-visit-link" onClick={onClick}>
          {title}
          <RightOutlined />
        </button>
        <button
          type="button"
          className="recent-visit-pin"
          aria-label={pinned ? `取消固定 ${title}` : `固定 ${title}`}
          aria-pressed={pinned}
          onClick={onPinClick}
        >
          <PushpinOutlined />
        </button>
      </Space>
    </Card>
  );
}
