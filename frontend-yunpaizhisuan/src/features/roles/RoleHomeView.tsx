import {
  ArrowRightOutlined,
  AuditOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  ScheduleOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  List,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getDashboardSummary } from '../../services/dashboardApi';
import { getLeaderTodayTasks, listLeaderTeams } from '../../services/leaderApi';
import { PageState } from '../../components/PageState';
import { StatusTag } from '../../components/StatusTag';
import { TodoSourceSummary } from '../todos/TodoSourceSummary';
import { todoSourceProgress } from '../todos/todoAggregation';
import { useTodoDismissStore } from '../todos/useTodoDismissStore';
import { useTodoCenter } from '../todos/useTodoCenter';
import { EngineeringDocumentsCard } from '../m0/EngineeringDocumentsCard';
import { WorkbenchWelcome } from '../workbench/WorkbenchWelcome';
import { QuickNavGrid } from '../workbench/QuickNavGrid';
import { ActivityTimeline } from '../workbench/ActivityTimeline';
import { landingKindForRoleId, type RoleLandingKind } from './roleConfig';
import { WorkerSection } from './WorkerSection';
import { useCurrentRole } from './useCurrentRole';

const todayString = () => new Date().toISOString().slice(0, 10);

export function RoleHomeView() {
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  const landing = landingKindForRoleId(role?.id);
  const todo = useTodoCenter(role?.permissions);
  const dismissed = useTodoDismissStore((state) => state.dismissed);

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const sourceProgress = useMemo(
    () => todoSourceProgress(todo.detailItems, (id) => dismissedSet.has(id)),
    [todo.detailItems, dismissedSet],
  );

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <WorkbenchWelcome roleId={role?.id} roleName={role?.name} permissions={role?.permissions} />

      <div className="page-heading role-home-hero">
        <div>
          <Typography.Title level={2}>{landing.title}</Typography.Title>
          <Typography.Text type="secondary">
            {landing.description} · 当前角色：{role?.name ?? '加载中…'}
          </Typography.Text>
        </div>
      </div>

      <Card title="待办概览">
        <TodoSourceSummary sourceCounts={todo.sourceCounts} sourceProgress={sourceProgress} />
      </Card>

      <Card title="快捷导航">
        <QuickNavGrid roleId={role?.id} permissions={role?.permissions} />
      </Card>

      <ActivityTimeline />

      <RoleLandingSections kind={landing.kind} />

      <EngineeringDocumentsCard title="工程文档库（组长端）" />
    </Space>
  );
}

function RoleLandingSections({ kind }: { kind: RoleLandingKind }) {
  switch (kind) {
    case 'factory-director':
      return <FactoryDirectorSection />;
    case 'team-leader':
      return <TeamLeaderSection />;
    case 'worker':
      return <WorkerSection />;
    default:
      return <DefaultSection />;
  }
}

function FactoryDirectorSection() {
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['role-home', 'dashboard-summary'], queryFn: getDashboardSummary });
  const modules = query.data?.modules ?? [];
  const highRiskCount = modules.filter((item) => item.riskLevel === 'high').length;

  return (
    <PageState loading={query.isLoading} error={query.error} empty={modules.length === 0}>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}>
          <Card className="metric-card">
            <Statistic title="模块总数" value={modules.length} suffix="个" />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card className="metric-card">
            <Statistic title="高风险模块" value={highRiskCount} suffix="个" valueStyle={highRiskCount > 0 ? { color: '#ef4444' } : undefined} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card className="metric-card">
            <Statistic title="风险摘要" value={query.data?.risks.length ?? 0} suffix="项" />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card className="metric-card">
            <Statistic title="近期活动" value={query.data?.activities.length ?? 0} suffix="条" />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="模块状态">
            <Space direction="vertical" size={8} className="page-stack">
              {modules.map((item) => (
                <div key={item.id} className="role-home-row">
                  <span>{item.name}</span>
                  <StatusTag value={item.status} />
                  <StatusTag value={item.riskLevel} />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="风险摘要">
            <Space direction="vertical" size={8} className="page-stack">
              {query.data?.risks.map((item) => (
                <Alert key={item.id} type={item.level === 'high' ? 'error' : 'warning'} showIcon message={item.title} description={item.description} />
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
      <Space wrap>
        <Button type="primary" icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/dashboard')}>
          进入完整 Dashboard
        </Button>
        <Button icon={<ScheduleOutlined />} onClick={() => navigate('/modules/schedule')}>
          排程甘特图
        </Button>
        <Button icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/modules/m5-flow')}>
          M5 流程看板
        </Button>
        <Button icon={<TeamOutlined />} onClick={() => navigate('/leader')}>
          小组长工作台
        </Button>
        <Button icon={<UserOutlined />} onClick={() => navigate('/worker')}>
          工人工作台
        </Button>
        <Button icon={<WarningOutlined />} onClick={() => navigate('/modules/purchase-warnings')}>
          M4 采购追踪
        </Button>
        <Button icon={<AuditOutlined />} onClick={() => navigate('/audit')}>
          操作留痕
        </Button>
      </Space>
    </PageState>
  );
}

function TeamLeaderSection() {
  const navigate = useNavigate();
  // 组长视角：今日任务 + 班组概览（数据源与 /leader 工作台一致，失败时页面仍可用）。
  const teamsQuery = useQuery({
    queryKey: ['role-home', 'leader-teams'],
    queryFn: () => listLeaderTeams('leader-zhang'),
  });
  const tasksQuery = useQuery({
    queryKey: ['role-home', 'leader-today-tasks'],
    queryFn: () => getLeaderTodayTasks('leader-zhang', todayString()),
  });
  const teams = teamsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const runningCount = tasks.filter((task) => task.progress_state === 'running').length;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card title="今日任务概览" extra={<Button type="link" icon={<ArrowRightOutlined />} onClick={() => navigate('/leader')}>进入小组长工作台</Button>}>
          <PageState loading={tasksQuery.isLoading} error={tasksQuery.error} empty={tasks.length === 0} emptyDescription="今日无已发布排程任务">
            <Row gutter={[12, 12]}>
              <Col span={8}><Statistic title="今日任务" value={tasks.length} suffix="项" /></Col>
              <Col span={8}><Statistic title="生产中" value={runningCount} suffix="项" /></Col>
              <Col span={8}><Statistic title="班组数" value={teams.length} suffix="个" /></Col>
            </Row>
            <List
              size="small"
              dataSource={tasks.slice(0, 5)}
              locale={{ emptyText: '今日无已发布排程任务' }}
              renderItem={(task) => (
                <List.Item>
                  <Space size={8} wrap>
                    <Tag color="blue">{task.order_id}</Tag>
                    <span>{task.operation_id} {task.operation_name}</span>
                    <Tag>{task.progress_state === 'running' ? '生产中' : task.progress_state === 'completed' ? '已完工' : '未开工'}</Tag>
                  </Space>
                </List.Item>
              )}
            />
          </PageState>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title="排程与派工入口">
          <Space direction="vertical" size={12} className="page-stack">
            <Alert
              type="info"
              showIcon
              message="组长职责范围"
              description="查看排程、把工单派给组内测试工人（订单绑定）、替工人报工并汇总班组工时台账。"
            />
            <Space wrap>
              <Button type="primary" icon={<ScheduleOutlined />} onClick={() => navigate('/modules/schedule')}>
                排程甘特图
              </Button>
              <Button icon={<FundProjectionScreenOutlined />} onClick={() => navigate('/modules/m5-flow')}>
                M5 流程看板
              </Button>
              <Button icon={<TeamOutlined />} onClick={() => navigate('/leader')}>
                派工与报工
              </Button>
            </Space>
          </Space>
        </Card>
      </Col>
    </Row>
  );
}

function DefaultSection() {
  const navigate = useNavigate();
  const links: Array<{ title: string; description: string; path: string; icon: ReactNode }> = [
    { title: 'Dashboard', description: '模块健康与风险摘要', path: '/dashboard', icon: <FundProjectionScreenOutlined /> },
    { title: '排程甘特图', description: '计划与产能视图', path: '/modules/schedule', icon: <ScheduleOutlined /> },
    { title: 'M0 文档解析审核', description: '识别字段人工确认', path: '/modules/m0-review', icon: <FileSearchOutlined /> },
    { title: 'M4 采购追踪', description: '采购建议、预警与追踪', path: '/modules/purchase-warnings', icon: <ShoppingCartOutlined /> },
    { title: 'M5 流程看板', description: '排程流程与派发', path: '/modules/m5-flow', icon: <FundProjectionScreenOutlined /> },
    { title: '操作留痕', description: '权限与操作审计', path: '/audit', icon: <AuditOutlined /> },
  ];

  return (
    <Row gutter={[16, 16]}>
      {links.map((link) => (
        <Col xs={24} md={12} lg={8} key={link.path}>
          <Card className="metric-card role-home-link-card" role="link" tabIndex={0} onClick={() => navigate(link.path)} onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              navigate(link.path);
            }
          }}>
            <Space direction="vertical" size={8}>
              <Space size={8}>{link.icon}<Typography.Text strong>{link.title}</Typography.Text></Space>
              <Typography.Text type="secondary">{link.description}</Typography.Text>
            </Space>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
