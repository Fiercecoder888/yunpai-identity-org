import {
  ApartmentOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  message,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeading } from '../components/PageHeading';
import { ActionGate } from '../components/ActionGate';
import { PermissionGate } from '../components/PermissionGate';
import { TaskId } from '../components/TaskId';
import { CollapsibleSearchArea } from '../components/table/CollapsibleSearchArea';
import { statusColors } from '../components/statusColors';
import type { M5FlowDashboardItem, M5FlowStage } from '../schemas/m5';
import { getM5FlowDashboard, submitScheduleFeedback } from '../services/m5Api';
import { HttpClientError } from '../services/httpClient';
import { StageProgressBar } from '../features/m5/StageProgressBar';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { hasPermission } from '../services/permissionApi';
import styles from './M5FlowDashboardPage.module.css';

type Filters = {
  trackingTaskId: string;
  planVersion: string;
};

const stageStatusLabel: Record<M5FlowStage['status'], string> = {
  not_started: '未开始',
  queued: '排队中',
  running: '进行中',
  succeeded: '已完成',
  failed: '失败',
  blocked: '阻塞',
};

const stageClass = (status: M5FlowStage['status']) => {
  if (status === 'succeeded') return styles.stageSucceeded;
  if (status === 'failed' || status === 'blocked') return styles.stageFailed;
  if (status === 'running' || status === 'queued') return styles.stageActive;
  return '';
};

const statusTag = (status: M5FlowDashboardItem['overall_status']) => {
  if (status === 'complete') return <Tag color={statusColors.success}>完整</Tag>;
  if (status === 'attention') return <Tag color={statusColors.risk}>需处理</Tag>;
  return <Tag color={statusColors.info}>进行中</Tag>;
};

const formatTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

const errorDescription = (error: unknown) => {
  if (error instanceof HttpClientError && error.error.status === 401) {
    return '身份会话未建立或已过期。请重新登录后再查询；只有 HTTP 可达但未获得业务数据不算接入成功。';
  }
  if (error instanceof Error) return error.message;
  return '无法读取 M5 业务数据。';
};

export function M5FlowDashboardPage() {
  return (
    <PermissionGate permission="schedule:read" auditModule="M5" targetId="flow-dashboard">
      <M5FlowDashboardContent />
    </PermissionGate>
  );
}

function M5FlowDashboardContent() {
  const initialFilters = useMemo<Filters>(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      trackingTaskId: params.get('tracking_task_id') ?? '',
      planVersion: params.get('plan_version') ?? '',
    };
  }, []);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedPlanVersion, setSelectedPlanVersion] = useState<string | null>(null);
  const [pendingPlanVersions, setPendingPlanVersions] = useState<Set<string>>(() => new Set());
  const pendingFeedbackRef = useRef(new Set<string>());
  const roleQuery = useCurrentRole();
  const canWriteSchedule = hasPermission(roleQuery.data, 'schedule:write');
  const query = useQuery({
    queryKey: ['m5-flow-dashboard', filters],
    queryFn: () => getM5FlowDashboard(filters),
    refetchInterval: autoRefresh ? 5000 : false,
  });
  const items = useMemo(() => query.data ?? [], [query.data]);
  const selected = items.find((item) => item.plan_version === selectedPlanVersion) ?? items[0];

  useEffect(() => {
    const firstItem = items[0];
    if (firstItem && !items.some((item) => item.plan_version === selectedPlanVersion)) {
      setSelectedPlanVersion(firstItem.plan_version);
    }
  }, [items, selectedPlanVersion]);

  const summary = useMemo(() => ({
    plans: items.length,
    complete: items.filter((item) => item.overall_status === 'complete').length,
    attention: items.filter((item) => item.overall_status === 'attention').length,
    trackingBacklog: items.reduce(
      (total, item) =>
        total + item.tracking.pending_count + item.tracking.retry_count + item.tracking.processing_count,
      0,
    ),
  }), [items]);

  const handleSearch = (values: Record<string, string | undefined>) => {
    setSelectedPlanVersion(null);
    setFilters({
      trackingTaskId: values.trackingTaskId?.trim() ?? '',
      planVersion: values.planVersion?.trim() ?? '',
    });
  };

  const handleReset = () => {
    setFilters({ trackingTaskId: '', planVersion: '' });
    setSelectedPlanVersion(null);
  };

  const handleFeedback = async (
    planVersion: string,
    action: 'approve' | 'reject' | 'release',
    trackingTaskId?: string,
  ) => {
    if (!canWriteSchedule || pendingFeedbackRef.current.has(planVersion)) return;
    pendingFeedbackRef.current.add(planVersion);
    setPendingPlanVersions((current) => new Set(current).add(planVersion));
    try {
      await submitScheduleFeedback(
        planVersion,
        action,
        action === 'release' ? '生产发布' : action === 'approve' ? '审批通过' : '拒绝',
        trackingTaskId,
      );
      const label = action === 'release' ? '发布' : action === 'approve' ? '审批通过' : '已拒绝';
      void message.success(`排程${label}：${planVersion}`);
      await query.refetch();
    } catch (err) {
      void message.error(`排程操作失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      pendingFeedbackRef.current.delete(planVersion);
      setPendingPlanVersions((current) => {
        const next = new Set(current);
        next.delete(planVersion);
        return next;
      });
    }
  };

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <PageHeading
        path="/modules/m5-flow"
        extra={
          <Space>
            <Typography.Text type="secondary">自动刷新</Typography.Text>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} aria-label="自动刷新" />
            <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>
              刷新
            </Button>
          </Space>
        }
      />

      <CollapsibleSearchArea
        fields={[
          { key: 'trackingTaskId', label: 'Tracking TaskID', placeholder: '例如 task_...', width: 220 },
          { key: 'planVersion', label: '排程版本', placeholder: '精确 plan_version', width: 200 },
        ]}
        values={initialFilters}
        searchText="查询业务数据"
        resetText="最近 20 条"
        onSearch={handleSearch}
        onReset={handleReset}
      />

      {query.error ? (
        <Alert
          type="error"
          showIcon
          message={query.error instanceof HttpClientError && query.error.error.status === 401 ? '身份认证失败' : 'M5 业务数据查询失败'}
          description={errorDescription(query.error)}
          action={<Button onClick={() => void query.refetch()}>重试</Button>}
        />
      ) : null}

      {!query.error ? (
        <>
          <div className={styles.summaryGrid}>
            <SummaryCell label="返回计划版本" value={summary.plans} icon={<ApartmentOutlined />} />
            <SummaryCell label="流程完整" value={summary.complete} icon={<CheckCircleOutlined />} />
            <SummaryCell label="需要处理" value={summary.attention} icon={<WarningOutlined />} />
            <SummaryCell label="Outbox 待处理" value={summary.trackingBacklog} icon={<DatabaseOutlined />} />
          </div>

          {query.isLoading ? <Card loading /> : null}
          {!query.isLoading && items.length === 0 ? (
            <Card>
              <Empty
                description={
                  filters.trackingTaskId || filters.planVersion
                    ? '接口已返回，但没有匹配的持久化 M5 业务数据'
                    : 'M5 暂无已持久化的排程版本'
                }
              />
            </Card>
          ) : null}
          {selected ? (
            <div className={styles.planLayout}>
              <div className={styles.planList} aria-label="排程版本列表">
                {items.map((item) => (
                  <button
                    type="button"
                    key={item.plan_version}
                    className={`${styles.planButton} ${item.plan_version === selected.plan_version ? styles.planButtonActive : ''}`}
                    onClick={() => setSelectedPlanVersion(item.plan_version)}
                  >
                    <div className={styles.planButtonHead}>
                      <strong>{item.plan_version}</strong>
                      {statusTag(item.overall_status)}
                    </div>
                    <StageProgressBar stages={item.stages} />
                    <div className={styles.planButtonMeta}>
                      <span>{item.tracking_task_id ? <TaskId value={item.tracking_task_id} /> : '未绑定 Tracking TaskID'}</span>
                      <span>{item.input.order_count} 个订单 · {formatTime(item.updated_at)} · {item.progress_percent}%</span>
                    </div>
                  </button>
                ))}
              </div>
              <FlowDetail
                item={selected}
                feedbackPending={pendingPlanVersions.has(selected.plan_version)}
                onFeedback={handleFeedback}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </Space>
  );
}

function SummaryCell({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className={styles.summaryCell} aria-label={`${label} ${value}`}>
      <Space>
        {icon}
        <span>{label}</span>
      </Space>
      <strong>{value}</strong>
    </div>
  );
}

function FlowDetail({
  item,
  feedbackPending,
  onFeedback,
}: {
  item: M5FlowDashboardItem;
  feedbackPending: boolean;
  onFeedback: (planVersion: string, action: 'approve' | 'reject' | 'release', trackingTaskId?: string) => Promise<void>;
}) {
  return (
    <section className={styles.detailSurface} aria-label={`M5 计划 ${item.plan_version}`}>
      <div className={styles.detailHeading}>
        <div>
          <h3>{item.plan_version}</h3>
          <div className={styles.versionLine}>
            {item.parent_plan_version ? (
              <>
                <Tag>{item.parent_plan_version}</Tag>
                <span>version_of</span>
                <Tag color={statusColors.info}>{item.plan_version}</Tag>
              </>
            ) : (
              <span>根排程版本</span>
            )}
          </div>
        </div>
        <Space direction="vertical" align="end" size={2}>
          {statusTag(item.overall_status)}
          <Typography.Text type="secondary">{item.progress_percent}%</Typography.Text>
        </Space>
      </div>

      <div className={styles.stageGrid}>
        {item.stages.map((stage) => (
          <div key={stage.key} className={`${styles.stage} ${stageClass(stage.status)}`}>
            <strong>{stage.label}</strong>
            <Tag color={stage.status === 'succeeded' ? statusColors.success : stage.status === 'failed' || stage.status === 'blocked' ? statusColors.risk : 'default'}>
              {stageStatusLabel[stage.status]}
            </Tag>
            <span>{stage.completed}/{stage.total}</span>
            <span>{stage.message}</span>
          </div>
        ))}
      </div>

      <Alert
        type={item.tracking.dead_letter_count > 0 ? 'error' : item.tracking.retry_count > 0 ? 'warning' : 'info'}
        showIcon
        message={
          <>
            Tracking {item.tracking.mode} · {item.tracking.tracking_task_id ? <TaskId value={item.tracking.tracking_task_id} /> : '未绑定 TaskID'}
          </>
        }
        description={
          item.tracking.latest_error
            ? `最近错误：${item.tracking.latest_error}`
            : '计数来自 M5 本地事务 Outbox；只有事件成功投递或可恢复排队，才视为 Tracking 已接入。'
        }
      />

      <div className={styles.trackingStats}>
        <TrackingStat label="事件总数" value={item.tracking.event_count} />
        <TrackingStat label="已发送" value={item.tracking.sent_count} />
        <TrackingStat label="等待/处理中" value={item.tracking.pending_count + item.tracking.processing_count} />
        <TrackingStat label="重试" value={item.tracking.retry_count} />
        <TrackingStat label="死信" value={item.tracking.dead_letter_count} />
      </div>

      <div className={styles.section}>
        <h4>输入内容</h4>
        {item.input.scenario_purpose === 'pressure_only' ? (
          <Alert
            type="warning"
            showIcon
            message="当前为测试排程，未进入生产发布"
            description="订单和设备来自真实输入；BOM、工艺、班次或库存中的测试补充数据仍需上游确认。"
          />
        ) : null}
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
          <Descriptions.Item label="场景">{item.input.scenario_id}</Descriptions.Item>
          <Descriptions.Item label="场景用途">
            {item.input.scenario_purpose === 'pressure_only' ? '压力测试' : '生产'}
          </Descriptions.Item>
          <Descriptions.Item label="接收时间">{formatTime(item.input.received_at)}</Descriptions.Item>
          <Descriptions.Item label="工艺步骤">{item.input.routing_step_count}</Descriptions.Item>
          <Descriptions.Item label="资源">{item.input.resource_count}</Descriptions.Item>
          <Descriptions.Item label="物料可用性">{item.input.material_availability_count}</Descriptions.Item>
          <Descriptions.Item label="BOM 物料">{item.input.bom_item_count}</Descriptions.Item>
        </Descriptions>
        <Table
          rowKey="order_id"
          size="small"
          pagination={false}
          scroll={{ x: 720 }}
          dataSource={item.input.orders}
          locale={{ emptyText: '输入中没有订单明细' }}
          columns={[
            { title: '订单号', dataIndex: 'order_id' },
            { title: '产品', dataIndex: 'product_id' },
            { title: '数量', render: (_, order) => `${order.quantity} ${order.unit}` },
            { title: '交期', dataIndex: 'due_time', render: formatTime },
            { title: '优先级', dataIndex: 'priority', render: (value) => value ?? '-' },
            { title: '加急', dataIndex: 'is_expedited', render: (value) => value ? <Tag color={statusColors.warning}>是</Tag> : '否' },
          ]}
        />
      </div>

      <div className={styles.section}>
        <h4>输出与业务确认</h4>
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
          <Descriptions.Item label="求解状态">{item.output.solver_status}</Descriptions.Item>
          <Descriptions.Item label="硬约束校验">
            <Tag color={item.output.validation_passed ? statusColors.success : statusColors.risk}>
              {item.output.validation_passed ? '通过' : '失败'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="生命周期">{item.output.lifecycle_status}</Descriptions.Item>
          <Descriptions.Item label="排程工序">{item.output.scheduled_operation_count}</Descriptions.Item>
          <Descriptions.Item label="排程订单">{item.output.scheduled_order_count}</Descriptions.Item>
          <Descriptions.Item label="排程资源">{item.output.scheduled_resource_count}</Descriptions.Item>
          <Descriptions.Item label="派发批次">{item.output.dispatch_count}</Descriptions.Item>
          <Descriptions.Item label="派发确认">
            {item.output.dispatch_acknowledged_count}/{item.output.dispatch_item_count}
          </Descriptions.Item>
          <Descriptions.Item label="派发失败">{item.output.dispatch_failed_count}</Descriptions.Item>
          <Descriptions.Item label="执行回传">{item.output.execution_event_count}</Descriptions.Item>
          <Descriptions.Item label="批准时间">{formatTime(item.output.approved_at)}</Descriptions.Item>
          <Descriptions.Item label="发布时间">{formatTime(item.output.released_at)}</Descriptions.Item>
        </Descriptions>
        {item.output.dispatch_count > 0 ? (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="B2R-S1 派发阶段说明"
            description={
              item.output.dispatch_acknowledged_count > 0 && item.output.execution_event_count === 0
                ? '派发已确认表示 MES 已接收/应用（本地回执），不等于执行完成；执行完成以执行回传事件（actual_finish）为准，当前仍处于中间态。'
                : '派发/执行按可验证阶段展示：本地记录 → 已发送 → 远端接收/应用 → 执行中 → 完成；本地回执不代表执行完成。'
            }
          />
        ) : null}
        <Space wrap size={8} style={{ marginTop: 12 }}>
          {item.output.lifecycle_status === 'draft' && item.output.validation_passed ? (
            <>
              <ActionGate
                permission="schedule:write"
                auditModule="M5"
                targetId={`${item.plan_version}:approve`}
              >
                <Button
                  type="primary"
                  loading={feedbackPending}
                  disabled={feedbackPending}
                  onClick={() => void onFeedback(item.plan_version, 'approve', item.tracking_task_id ?? undefined)}
                >
                  审批通过
                </Button>
              </ActionGate>
              <ActionGate
                permission="schedule:write"
                auditModule="M5"
                targetId={`${item.plan_version}:reject`}
              >
                <Button
                  danger
                  disabled={feedbackPending}
                  onClick={() => void onFeedback(item.plan_version, 'reject', item.tracking_task_id ?? undefined)}
                >
                  拒绝
                </Button>
              </ActionGate>
            </>
          ) : null}
          {item.output.lifecycle_status === 'draft' && !item.output.validation_passed ? (
            <Alert
              type="warning"
              showIcon
              message="校验未通过，不能审批/发布"
              description="计划存在硬约束违规（如资源不可用窗口），需重新排程后处理。"
            />
          ) : null}
          {item.output.lifecycle_status === 'approved' ? (
            <ActionGate
              permission="schedule:write"
              auditModule="M5"
              targetId={`${item.plan_version}:release`}
            >
              <Button
                type="primary"
                loading={feedbackPending}
                disabled={feedbackPending}
                onClick={() => void onFeedback(item.plan_version, 'release', item.tracking_task_id ?? undefined)}
              >
                生产发布
              </Button>
            </ActionGate>
          ) : null}
        </Space>
        <h4>设备负载</h4>
        <div className={styles.trackingStats}>
          {Object.entries(item.output.resource_load_minutes ?? {}).map(([resourceId, minutes]) => (
            <TrackingStat key={resourceId} label={resourceId} value={minutes} suffix="分钟" />
          ))}
        </div>
        {item.output.operations_truncated ? (
          <Alert
            type="warning"
            showIcon
            message="排程操作较多，当前只展示前 200 条"
          />
        ) : null}
        <Table
          rowKey={(operation) => `${operation.order_id}:${operation.operation_id}`}
          size="small"
          pagination={{ pageSize: 10, showSizeChanger: false }}
          scroll={{ x: 1080 }}
          dataSource={item.output.operations ?? []}
          locale={{ emptyText: '该计划没有可展示的排程操作' }}
          columns={[
            { title: '订单', dataIndex: 'order_id', width: 180 },
            { title: '产品', dataIndex: 'product_id', width: 110 },
            { title: '工序', dataIndex: 'operation_name', width: 140 },
            { title: '设备', dataIndex: 'resource_id', width: 180 },
            { title: '开始', dataIndex: 'start_time', width: 180, render: formatTime },
            { title: '结束', dataIndex: 'end_time', width: 180, render: formatTime },
            { title: '时长', dataIndex: 'duration_minutes', width: 90, render: (value) => `${value} 分钟` },
            { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag color={statusColors.success}>{value}</Tag> },
          ]}
        />
      </div>

      <div className={styles.section}>
        <h4>异步 Job</h4>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 860 }}
          dataSource={item.jobs}
          locale={{ emptyText: '该 TaskID 没有异步 Job 记录' }}
          columns={[
            { title: 'Job ID', dataIndex: 'id' },
            { title: '类型', dataIndex: 'job_type' },
            { title: '状态', dataIndex: 'status', render: (value) => <Tag>{value}</Tag> },
            { title: '结果版本', dataIndex: 'result_plan_version', render: (value) => value ?? '-' },
            {
              title: '匹配当前版本',
              dataIndex: 'matches_plan_version',
              render: (value) => value ? <Tag color={statusColors.success}>匹配</Tag> : <Tag color={statusColors.warning}>不匹配</Tag>,
            },
            { title: '尝试', render: (_, job) => `${job.attempts}/${job.max_attempts}` },
            { title: '错误', dataIndex: 'error', render: (value) => value ?? '-' },
          ]}
        />
      </div>

      <div className={styles.section}>
        <Collapse
          ghost
          items={[{
            key: 'raw',
            label: '查看该计划完整 JSON',
            children: <pre className={styles.rawJson}>{JSON.stringify(item, null, 2)}</pre>,
          }]}
        />
      </div>
    </section>
  );
}

function TrackingStat({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className={styles.trackingStat}>
      <span>{label}</span>
      <strong>{value}{suffix ? ` ${suffix}` : ''}</strong>
    </div>
  );
}
