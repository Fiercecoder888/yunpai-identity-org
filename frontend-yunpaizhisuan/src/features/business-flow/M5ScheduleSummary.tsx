import { DownOutlined, ReloadOutlined, UpOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Progress, Segmented, Space, Spin, Tag, Tooltip } from 'antd';
import { useMemo, useState } from 'react';
import type { M5PmcProgressOperation } from '../../schemas/m5';
import { getM5ExecutionSummary, getM5PmcProgress } from '../../services/m5Api';
import styles from './M5ScheduleSummary.module.css';

type ScheduleOperation = {
  operation_id?: string;
  operation_name?: string;
  resource_id?: string;
  order_id?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  actual_start_time?: string;
  actual_end_time?: string;
  actual_qty?: number;
  actual_status?: string;
  unit?: string;
};

type ScheduleMetrics = {
  order_count?: number;
  scheduled_operation_count?: number;
  on_time_order_count?: number;
  on_time_rate?: number;
  total_tardiness_minutes?: number;
  makespan_minutes?: number;
  resource_load_minutes?: Record<string, number>;
};

type ScheduleDetail = {
  plan_version?: string;
  solver_status?: string;
  validation_passed?: boolean;
  lifecycle_status?: string;
  operations?: ScheduleOperation[];
  metrics?: ScheduleMetrics;
  risks?: Array<Record<string, unknown>>;
  messages?: string[];
  order_kitting?: Array<{ order_id?: string; status?: string; missing_materials?: unknown[] }>;
};

const parseMs = (value?: string) => {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
};

const formatTime = (value?: string) => {
  const ms = parseMs(value);
  if (ms === undefined) return '—';
  return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (value?: string) => {
  const ms = parseMs(value);
  if (ms === undefined) return '—';
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatQuantity = (value?: number, unit?: string) => value === undefined ? '未提供' : `${value}${unit ? ` ${unit}` : ''}`;
const clampPercent = (value?: number) => value === undefined ? 0 : Math.min(100, Math.max(0, value));
const GANTT_COLORS = ['#1677ff', '#0d9188', '#7c3aed', '#f79009', '#12b76a', '#e8590c'];

const LIFECYCLE_META: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  approved: { label: '已批准', color: 'blue' },
  released: { label: '已发布', color: 'green' },
  dispatched: { label: '已派工', color: 'purple' },
  executing: { label: '执行中', color: 'processing' },
  unknown: { label: '未知', color: 'default' },
  not_started: { label: '未开始', color: 'default' },
  wip: { label: '在制', color: 'processing' },
  running: { label: '执行中', color: 'processing' },
  paused: { label: '已暂停', color: 'warning' },
  exception: { label: '异常', color: 'error' },
  scrapped: { label: '已报废', color: 'error' },
  completed: { label: '已完成', color: 'success' },
  late: { label: '拖期', color: 'error' },
  overdue: { label: '拖期', color: 'error' },
  locked: { label: '已锁定', color: 'orange' },
  adjusted: { label: '已调整', color: 'orange' },
};

const lifecycleMeta = (status?: string) => LIFECYCLE_META[status ?? ''] ?? { label: status ?? '—', color: 'default' };
const operationKey = (
  orderId: string | undefined,
  operationId: string | undefined,
  resourceId: string | undefined,
) => `${orderId ?? ''}::${operationId ?? ''}::${resourceId ?? ''}`;

export function M5ScheduleSummary({
  schedule,
  loading,
  catalogId,
  planVersion,
  simulatedProcurement = false,
  simulatedEngineeringRoute = false,
}: {
  schedule: unknown;
  loading?: boolean;
  catalogId?: string;
  planVersion?: string;
  simulatedProcurement?: boolean;
  simulatedEngineeringRoute?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [variant, setVariant] = useState<'rows' | 'axis'>('rows');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(() => new Set());
  const detail = (schedule ?? {}) as ScheduleDetail;
  const resolvedPlanVersion = planVersion ?? detail.plan_version;
  const progressQuery = useQuery({
    queryKey: ['m5-pmc-progress', resolvedPlanVersion],
    queryFn: () => getM5PmcProgress(String(resolvedPlanVersion)),
    enabled: Boolean(resolvedPlanVersion),
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
  const progress = progressQuery.data;

  const progressOperations = useMemo(
    () => progress?.orders.flatMap((order) => order.operations.map((operation) => ({ orderId: order.order_id, operation }))) ?? [],
    [progress],
  );
  const progressOperationMap = useMemo(() => {
    const byKey = new Map<string, M5PmcProgressOperation>();
    const fallbackKeyCounts = new Map<string, number>();
    for (const { orderId, operation } of progressOperations) {
      byKey.set(operationKey(orderId, operation.operation_id, operation.resource_id), operation);
      const fallbackKey = operationKey(undefined, operation.operation_id, operation.resource_id);
      fallbackKeyCounts.set(fallbackKey, (fallbackKeyCounts.get(fallbackKey) ?? 0) + 1);
    }
    for (const { operation } of progressOperations) {
      const fallbackKey = operationKey(undefined, operation.operation_id, operation.resource_id);
      if (fallbackKeyCounts.get(fallbackKey) === 1) {
        byKey.set(fallbackKey, operation);
      }
    }
    return byKey;
  }, [progressOperations]);

  const operations = useMemo(() => {
    const scheduled = detail.operations ?? [];
    const merged = scheduled.length > 0
      ? scheduled.map((operation) => {
          const actual = progressOperationMap.get(operationKey(operation.order_id, operation.operation_id, operation.resource_id))
            ?? progressOperationMap.get(operationKey(undefined, operation.operation_id, operation.resource_id));
          return {
            ...operation,
            actual_start_time: actual?.actual_start_time ?? operation.actual_start_time,
            actual_end_time: actual?.actual_end_time ?? operation.actual_end_time,
            actual_qty: actual?.actual_qty ?? operation.actual_qty,
            actual_status: actual?.actual_status ?? operation.actual_status,
            unit: actual?.unit ?? operation.unit,
          };
        })
      : progressOperations.map(({ orderId, operation }) => ({
          order_id: orderId,
          operation_id: operation.operation_id,
          operation_name: operation.operation_name,
          resource_id: operation.resource_id,
          start_time: operation.planned_start_time,
          end_time: operation.planned_end_time,
          status: operation.actual_status,
          actual_start_time: operation.actual_start_time,
          actual_end_time: operation.actual_end_time,
          actual_qty: operation.actual_qty,
          actual_status: operation.actual_status,
          unit: operation.unit,
        }));
    return [...merged].sort((a, b) => (parseMs(a.start_time) ?? 0) - (parseMs(b.start_time) ?? 0));
  }, [detail.operations, progressOperationMap, progressOperations]);
  const metrics = detail.metrics ?? {};

  const timeline = useMemo(() => {
    const plannedStarts = operations.map((op) => parseMs(op.start_time));
    const plannedEnds = operations.map((op) => parseMs(op.end_time));
    const actualStarts = operations.map((op) => parseMs(op.actual_start_time));
    const actualEnds = operations.map((op) => {
      const actualStart = parseMs(op.actual_start_time);
      return parseMs(op.actual_end_time) ?? (actualStart === undefined ? undefined : Date.now());
    });
    const starts = [...plannedStarts, ...actualStarts].filter((value): value is number => value !== undefined);
    const ends = [...plannedEnds, ...actualEnds].filter((value): value is number => value !== undefined);
    if (!starts.length || !ends.length) return undefined;
    const start = Math.min(...starts);
    const end = Math.max(...ends);
    return { start, end, span: Math.max(1, end - start) };
  }, [operations]);

  const resourceCount = Object.keys(metrics.resource_load_minutes ?? {}).length
    || new Set(operations.map((op) => op.resource_id).filter(Boolean)).size;
  const execQuery = useQuery({
    queryKey: ['m5-execution-summary', resolvedPlanVersion],
    queryFn: () => getM5ExecutionSummary(String(resolvedPlanVersion ?? '')),
    enabled: Boolean(resolvedPlanVersion),
    staleTime: 15_000,
    refetchInterval: 10_000,
  });
  const exec = execQuery.data;
  const execStarted = exec?.started_operation_count ?? 0;
  const execCompleted = exec?.completed_operation_count ?? 0;
  const execPaused = exec?.paused_operation_count ?? 0;
  const execException = exec?.exception_operation_count ?? 0;
  const execPlanned = exec?.planned_operation_count ?? operations.length;
  const hasExecution = (exec?.event_count ?? 0) > 0 || (exec?.started_operation_count ?? 0) > 0;
  const lifecycle = lifecycleMeta(detail.lifecycle_status);

  const warnings: string[] = [];
  for (const risk of detail.risks ?? []) {
    const text = String(risk.message ?? risk.title ?? '');
    if (text) warnings.push(text);
  }
  for (const kitting of detail.order_kitting ?? []) {
    const missing = Array.isArray(kitting.missing_materials) ? kitting.missing_materials.length : 0;
    if (missing > 0) warnings.push(`${kitting.order_id ?? '订单'} 缺料 ${missing} 项`);
  }
  for (const message of detail.messages ?? []) {
    if (/warning|advisory/i.test(message)) warnings.push(message);
  }

  const toggleOrder = (orderId: string) => {
    setExpandedOrders((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  return (
    <div className={styles.card} data-testid="m5-pmc-summary">
      <div className={styles.head}>
        <Space size={8} wrap>
          <b>排程摘要 · PMC</b>
          <Tag color="green">{resolvedPlanVersion ?? '—'}</Tag>
          {detail.solver_status ? <Tag>{detail.solver_status}</Tag> : null}
          {simulatedProcurement ? <Tag color="orange">模拟到货 · 不可发布/派工</Tag> : null}
          {simulatedEngineeringRoute ? <Tag color="orange">模拟工艺 · 不可发布/派工</Tag> : null}
          {schedule ? <Tag color={detail.validation_passed === false ? 'error' : 'success'}>{detail.validation_passed === false ? '校验未通过' : '硬约束通过'}</Tag> : null}
          {detail.lifecycle_status ? <Tag color={lifecycle.color}>{lifecycle.label}</Tag> : null}
        </Space>
        <Space size={2}>
          <Tooltip title="刷新 PMC 进度">
            <Button
              type="text"
              shape="circle"
              size="small"
              icon={<ReloadOutlined />}
              aria-label="刷新 PMC 进度"
              disabled={!resolvedPlanVersion}
              loading={progressQuery.isFetching || execQuery.isFetching}
              onClick={() => void Promise.all([progressQuery.refetch(), execQuery.refetch()])}
            />
          </Tooltip>
          <Button type="text" size="small" icon={collapsed ? <DownOutlined /> : <UpOutlined />}
            aria-label={collapsed ? '展开排程摘要' : '收起排程摘要'} onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? '展开' : '收起'}
          </Button>
        </Space>
      </div>

      {!resolvedPlanVersion && !collapsed ? <Alert className={styles.emptyState} type="info" showIcon message="PMC 数据未完善" description="当前订单尚无可查看的排程版本；完成订单到排程流程后可查看实际进度。" /> : null}
      {(loading && !schedule) || (progressQuery.isFetching && !progress) ? <div className={styles.loading}><Spin size="small" /> 加载 PMC 进度…</div> : null}
      {progressQuery.isError && !collapsed ? <Alert className={styles.emptyState} type="warning" showIcon message="PMC 实际进度暂不可用" description="计划排程仍可查看，实际量与工位进度稍后重试。" /> : null}

      {!collapsed && resolvedPlanVersion && (schedule || progress) ? (
        <>
          <div className={styles.metricsRow}>
            <div className={styles.metric}><span>订单</span><b>{progress?.summary.order_count ?? metrics.order_count ?? '—'}</b></div>
            <div className={styles.metric}><span>已完成</span><b>{progress?.summary.completed_order_count ?? '—'}</b></div>
            <div className={styles.metric}><span>在制</span><b>{progress?.summary.wip_order_count ?? '—'}</b></div>
            <div className={styles.metric}><span>拖期</span><b>{progress?.summary.late_order_count ?? '—'}</b></div>
            <div className={styles.metric}><span>准交率</span><b>{progress ? (progress.summary.on_time_rate_percent !== undefined ? `${Math.round(progress.summary.on_time_rate_percent)}%` : '—') : metrics.on_time_rate !== undefined ? `${Math.round(metrics.on_time_rate * 100)}%` : '—'}</b></div>
            <div className={styles.metric}><span>工位</span><b>{resourceCount}</b></div>
          </div>

          <div className={styles.execRow}>
            <div className={styles.execHead}>
              <span className={styles.execTitle}>执行进展</span>
              {execQuery.isFetching && !exec ? <Spin size="small" /> : null}
              <span className={styles.execCounts}>{hasExecution ? `已开工 ${execStarted} · 完成 ${execCompleted} · 暂停 ${execPaused} · 异常 ${execException}` : `未派工 · 计划 ${execPlanned} 道工序`}</span>
            </div>
            <Progress size="small" percent={hasExecution && exec?.completion_rate_percent != null ? Math.round(exec.completion_rate_percent) : 0}
              status={execException > 0 ? 'exception' : execPaused > 0 ? 'active' : undefined} format={(percent) => hasExecution ? `${percent ?? 0}%` : '0%'} />
          </div>

          {progress ? (
            <div className={styles.orderProgress} data-testid="m5-pmc-orders">
              <div className={styles.sectionTitle}>订单与工位进度</div>
              <div className={styles.orderTableScroll}>
                <table className={styles.orderTable}>
                  <thead><tr><th>订单 / 产品</th><th>计划量</th><th>实际量</th><th>完成率</th><th>状态</th><th className={styles.secondaryColumn}>交期</th></tr></thead>
                  <tbody>
                    {progress.orders.map((order) => {
                      const expanded = expandedOrders.has(order.order_id);
                      const orderStatus = lifecycleMeta(order.status);
                      return (
                        <tr className={styles.orderGroup} key={order.order_id}><td colSpan={6}>
                          <button className={styles.orderToggle} type="button" onClick={() => toggleOrder(order.order_id)} aria-expanded={expanded}>
                            {expanded ? <UpOutlined /> : <DownOutlined />}
                            <span className={styles.orderIdentity}><b>{order.order_id}</b><small>{order.product_id ?? '产品未提供'}</small></span>
                            <span>{formatQuantity(order.planned_quantity, order.unit)}</span>
                            <span>{order.actual_quantity_supported ? formatQuantity(order.actual_qty, order.unit) : '未提供'}</span>
                            <span className={styles.orderRate}>{order.actual_quantity_supported && order.completion_rate_percent !== undefined
                              ? <Progress percent={Math.round(clampPercent(order.completion_rate_percent))} size="small" format={() => `${Math.round(order.completion_rate_percent ?? 0)}%`} />
                              : '未提供'}</span>
                            <span><Tag color={orderStatus.color}>{orderStatus.label}</Tag></span>
                            <span className={styles.secondaryColumn}>{formatDateTime(order.due_time)}</span>
                          </button>
                          {expanded ? <div className={styles.operationDetails} aria-label={`${order.order_id} 工位进度`}>
                            {order.operations.length ? order.operations.map((operation) => {
                              const operationStatus = lifecycleMeta(operation.actual_status);
                              return <div className={styles.operationDetailRow} key={operationKey(order.order_id, operation.operation_id, operation.resource_id)}>
                                <span title={operation.operation_id}><b>{operation.operation_name}</b><small>{operation.operation_id}</small></span>
                                <span title={operation.resource_id}>{operation.resource_id ?? '未分配工位'}</span>
                                <span>{formatQuantity(operation.actual_qty, operation.unit ?? order.unit)}</span>
                                {operation.completion_rate_percent !== undefined
                                  ? <Progress percent={Math.round(clampPercent(operation.completion_rate_percent))} size="small" format={() => `${Math.round(operation.completion_rate_percent ?? 0)}%`} />
                                  : <span>未提供</span>}
                                <Tag color={operationStatus.color}>{operationStatus.label}</Tag>
                                <span className={styles.operationTime}>{formatDateTime(operation.actual_start_time)}–{formatDateTime(operation.actual_end_time)}</span>
                              </div>;
                            }) : <div className={styles.operationEmpty}>暂无工位进度</div>}
                          </div> : null}
                        </td></tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <Segmented className={styles.segmented} size="small" value={variant} onChange={(value) => setVariant(value as 'rows' | 'axis')}
            options={[{ label: '工序分行', value: 'rows' }, { label: '时间轴汇总', value: 'axis' }]} />

          {variant === 'rows' ? (
            <div className={styles.ganttRows}>
              <div className={styles.ganttHeader}><span className={styles.opName}>工序</span><span className={styles.opResource}>资源</span><span className={styles.opTrack} /><span className={styles.opTime}>计划时间</span></div>
              {operations.map((op) => {
                const start = parseMs(op.start_time);
                const end = parseMs(op.end_time);
                const actualStart = parseMs(op.actual_start_time);
                const actualEnd = parseMs(op.actual_end_time) ?? (actualStart === undefined ? undefined : Date.now());
                const left = timeline && start !== undefined ? ((start - timeline.start) / timeline.span) * 100 : 0;
                const width = timeline && start !== undefined && end !== undefined ? ((end - start) / timeline.span) * 100 : 100;
                const actualLeft = timeline && actualStart !== undefined ? ((actualStart - timeline.start) / timeline.span) * 100 : 0;
                const actualWidth = timeline && actualStart !== undefined && actualEnd !== undefined ? ((actualEnd - actualStart) / timeline.span) * 100 : 0;
                const late = /late|overdue/i.test(op.actual_status ?? op.status ?? '');
                return <div className={styles.opRow} key={`${op.order_id}-${op.operation_id}-${op.resource_id}-${op.start_time}`}>
                  <span className={styles.opName} title={op.operation_id}>{op.operation_name ?? op.operation_id}</span>
                  <span className={styles.opResource} title={op.resource_id}>{op.resource_id ?? '—'}</span>
                  <div className={styles.opTrack}>
                    <Tooltip title={`计划：${formatTime(op.start_time)}–${formatTime(op.end_time)}`}><div className={`${styles.opBar} ${late ? styles.isLate : ''}`} style={{ left: `${left}%`, width: `${Math.max(2, width)}%` }} /></Tooltip>
                    {actualStart !== undefined ? <Tooltip title={`实际：${formatTime(op.actual_start_time)}–${op.actual_end_time ? formatTime(op.actual_end_time) : '进行中'} · ${formatQuantity(op.actual_qty, op.unit)}`}><div className={styles.actualBar} data-testid="m5-pmc-actual-bar" style={{ left: `${actualLeft}%`, width: `${Math.max(2, actualWidth)}%` }} /></Tooltip> : null}
                  </div>
                  <span className={styles.opTime}>{formatTime(op.start_time)}–{formatTime(op.end_time)}</span>
                </div>;
              })}
              <div className={styles.ganttLegend}><i className={styles.planLegend} />计划 <i className={styles.actualLegend} />实际</div>
            </div>
          ) : (
            <div className={styles.ganttAxis}><div className={styles.axisTrack}>
              {operations.map((op, index) => {
                const start = parseMs(op.start_time);
                const end = parseMs(op.end_time);
                const left = timeline && start !== undefined ? ((start - timeline.start) / timeline.span) * 100 : 0;
                const width = timeline && start !== undefined && end !== undefined ? ((end - start) / timeline.span) * 100 : 100 / Math.max(1, operations.length);
                return <Tooltip key={`${op.order_id}-${op.operation_id}-${op.resource_id}-${op.start_time}`} title={`${op.operation_name ?? op.operation_id} · ${op.resource_id ?? '—'} · ${formatTime(op.start_time)}–${formatTime(op.end_time)}`}>
                  <div className={styles.axisSeg} style={{ left: `${left}%`, width: `${Math.max(2, width)}%`, background: GANTT_COLORS[index % GANTT_COLORS.length] }}>{width >= 12 ? op.operation_name : ''}</div>
                </Tooltip>;
              })}
            </div><div className={styles.axisLabels}><span>{timeline ? formatTime(new Date(timeline.start).toISOString()) : '—'}</span><span>{timeline ? formatTime(new Date(timeline.end).toISOString()) : '—'}</span></div></div>
          )}

          {warnings.length ? <div className={styles.warnings}>{warnings.slice(0, 3).map((text) => <div key={text}><WarningOutlined /> {text}</div>)}</div> : null}
          <div className={styles.foot}><span className={styles.footNote}>准交率按实际完工与订单交期计算；进行中工序的 actual 条延伸至当前时间。</span>{catalogId ? <Button type="link" size="small" href={`/business.html?catalog_id=${encodeURIComponent(catalogId)}&action=view&module=m5`}>业务明细</Button> : null}</div>
        </>
      ) : null}
    </div>
  );
}
