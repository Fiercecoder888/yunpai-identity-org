import { useQuery } from '@tanstack/react-query';
import { Empty, Space, Tag, Timeline, Typography } from 'antd';
import type { ReactNode } from 'react';
import { PageState } from '../../../components/PageState';
import { statusColors } from '../../../components/statusColors';
import type { ScheduleEvent } from '../../../schemas/schedule';
import { getScheduleEvents } from '../../../services/scheduleApi';

const eventTypeLabel: Record<string, string> = {
  plan_created: '计划创建',
  replan: '重排',
  operation_adjusted: '工序调整',
  operation_locked: '工序锁定',
  operation_unlocked: '工序解锁',
  validation_passed: '校验通过',
  validation_failed: '校验失败',
  approval: '审批',
  release: '发布',
  dispatch: '派工',
};

const severityColor: Record<string, string> = {
  info: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

const formatTime = (value?: string) => {
  if (!value) {
    return '-';
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
};

function EventItem({ event }: { event: ScheduleEvent }) {
  const label = eventTypeLabel[event.event_type] ?? event.event_type;
  const extra: ReactNode[] = [];
  if (event.new_plan_version && event.new_plan_version !== event.base_plan_version) {
    extra.push(
      <Typography.Text key="new" type="secondary">
        新版本 {event.new_plan_version}
      </Typography.Text>,
    );
  }
  return (
    <Space direction="vertical" size={2}>
      <Space size={8} wrap>
        <Typography.Text strong>{label}</Typography.Text>
        <Tag color={severityColor[event.severity] ?? 'default'}>{event.severity}</Tag>
        <Tag>{event.source}</Tag>
      </Space>
      <Typography.Text type="secondary">{formatTime(event.occurred_at)}</Typography.Text>
      {event.reason ? <Typography.Text>{event.reason}</Typography.Text> : null}
      {extra}
    </Space>
  );
}

/** B2R-F2 事件时间线：只读展示计划生产事件（B2R-E1 查询接口），不承载写语义。 */
export function ScheduleEventTimeline({
  planVersion,
}: {
  planVersion?: string;
}) {
  const eventsQuery = useQuery({
    queryKey: ['schedule-events', planVersion],
    queryFn: () => getScheduleEvents(planVersion ?? 'latest'),
    enabled: Boolean(planVersion),
  });

  if (!planVersion) {
    return <Empty description="暂无计划版本，无法展示事件时间线" />;
  }

  const events = eventsQuery.data ?? [];
  return (
    <PageState
      loading={eventsQuery.isLoading}
      error={eventsQuery.error}
      empty={events.length === 0}
      emptyDescription="该计划暂无事件记录"
    >
      <Timeline
        items={events.map((event) => ({
          color: event.severity === 'error' ? 'red' : event.severity === 'warning' ? 'orange' : 'blue',
          children: <EventItem key={event.id} event={event} />,
        }))}
      />
    </PageState>
  );
}

/** 事件类型配色（供外部复用）。 */
export const eventStatusColor = (severity: string) =>
  severityColor[severity] ?? statusColors.neutral;
