import { Alert, Button, Card, Modal, Space, Tag, Typography, message } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PermissionGate } from '../components/PermissionGate';
import { PageState } from '../components/PageState';
import { StatusTag } from '../components/StatusTag';
import { GanttView, type ScheduleAdjustmentRequest } from '../features/schedule/gantt/GanttView';
import { ScheduleEventTimeline } from '../features/schedule/gantt/ScheduleEventTimeline';
import type { ScheduleBoard, ScheduleTask } from '../types/api';
import { CapacityLoadView } from '../features/schedule/gantt/CapacityLoadView';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { adjustScheduleTask, getScheduleBoard, getScheduleDependencies, replanFromVersion, type ReplanFromVersionPayload } from '../services/scheduleApi';
import { lockM5Operation, unlockM5Operation } from '../services/m5Api';
import { AUDIT_LOG_SYNC_FAILURE_MESSAGE, createAuditLog, writeAuditLogSafely } from '../services/auditLogger';
import { hasPermission } from '../services/permissionApi';

const fallbackScheduleBaseDateUtc = Date.UTC(2026, 5, 26);
const dayMs = 24 * 60 * 60 * 1000;

const toScheduleDateTime = (timelineStart: string | undefined, dayOffset: number, hour: '08' | '18') => {
  const start = timelineStart ? Date.parse(timelineStart.slice(0, 10)) : fallbackScheduleBaseDateUtc;
  const date = new Date((Number.isFinite(start) ? start : fallbackScheduleBaseDateUtc) + dayOffset * dayMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:00:00+08:00`;
};

const formatLocalDateTime = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
};

const lifecycleMeta = (status?: string) => {
  if (status === 'released') {
    return { label: '已发布', color: 'success' as const };
  }
  if (status === 'approved') {
    return { label: '已审批', color: 'processing' as const };
  }
  return { label: '草稿', color: 'default' as const };
};

export function ScheduleGanttPage() {
  return (
    <PermissionGate permission="schedule:read" auditModule="M5" targetId="schedule">
      <ScheduleGanttContent />
    </PermissionGate>
  );
}

function ScheduleGanttContent() {
  const [lastAdjustedTask, setLastAdjustedTask] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [auditWarning, setAuditWarning] = useState(false);
  const [revalidationNotice, setRevalidationNotice] = useState(false);
  const [replanOpen, setReplanOpen] = useState(false);
  const queryClient = useQueryClient();
  const roleQuery = useCurrentRole();
  const canAdjust = hasPermission(roleQuery.data, 'schedule:write');
  const boardQuery = useQuery({
    queryKey: ['schedule-board'],
    queryFn: getScheduleBoard,
    refetchInterval: 10_000,
  });
  const dependenciesQuery = useQuery({ queryKey: ['schedule-dependencies'], queryFn: getScheduleDependencies });
  const mutation = useMutation({
    mutationFn: async (request: ScheduleAdjustmentRequest) => {
      const response = await adjustScheduleTask({
        taskId: request.task.id,
        planVersion: request.task.planVersion,
        orderId: request.task.orderId,
        operationId: request.task.operationId,
        // 工序有原始精确时间时采用平移后的值；否则退回按天重建。
        startAt: request.startAt ?? toScheduleDateTime(boardQuery.data?.timelineStart, request.startDay, '08'),
        endAt: request.endAt ?? toScheduleDateTime(boardQuery.data?.timelineStart, request.startDay + request.durationDays, '18'),
        reason: request.reason,
      });

      const auditResult = await writeAuditLogSafely(
        createAuditLog({
          actor: 'pmc-user',
          action: 'M5_SCHEDULE_ADJUSTED',
          module: 'M5',
          targetId: request.task.id,
          result: 'success',
          detail: request.reason,
        }),
      );

      return { response, auditLogged: auditResult.ok };
    },
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: ['schedule-board'] });
      setRevalidationNotice(false);
      const previous = queryClient.getQueryData<ScheduleBoard>(['schedule-board']);
      queryClient.setQueryData<ScheduleBoard>(['schedule-board'], (board) => {
        if (!board) {
          return board;
        }
        return {
          ...board,
          tasks: board.tasks.map((task) => {
            if (task.id !== request.task.id) {
              return task;
            }
            return {
              ...task,
              startDay: request.startDay,
              durationDays: request.durationDays,
              status: 'adjusted' as const,
            };
          }),
        };
      });
      return { previous };
    },
    onSuccess: async ({ response, auditLogged }) => {
      await queryClient.invalidateQueries({ queryKey: ['schedule-board'] });
      setOperationError(null);
      setAuditWarning(!auditLogged);
      // 后端调整响应可能带校验状态；校验未通过时提示等待后端重新校验。
      setRevalidationNotice(response.validationPassed === false);
      setLastAdjustedTask('排程调整已提交');
      void message.success('排程调整已提交');
      if (!auditLogged) {
        void message.warning(AUDIT_LOG_SYNC_FAILURE_MESSAGE);
      }
    },
    onError: (_error, _request, context) => {
      if (context?.previous) {
        queryClient.setQueryData<ScheduleBoard>(['schedule-board'], context.previous);
      }
      setOperationError('排程调整失败');
      setAuditWarning(false);
      setRevalidationNotice(false);
      void message.error('排程调整失败');
    },
  });

  const pageError = boardQuery.error ?? dependenciesQuery.error;
  const pageLoading = boardQuery.isLoading || dependenciesQuery.isLoading;
  const board = boardQuery.data;
  const lifecycle = lifecycleMeta(board?.lifecycleStatus);
  const releasedAt = board?.releasedAt;
  const approvedAt = board?.approvedAt;

  const lockMutation = useMutation({
    mutationFn: async ({ task, lock }: { task: ScheduleTask; lock: boolean }) => {
      const planVersion = task.planVersion ?? boardQuery.data?.planVersion;
      if (!planVersion) {
        throw new Error('排程锁定缺少计划版本');
      }
      const orderId = task.orderId ?? task.id;
      const operationId = task.operationId ?? task.id;
      return lock
        ? lockM5Operation(planVersion, orderId, operationId)
        : unlockM5Operation(planVersion, orderId, operationId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedule-board'] });
      void message.success('工序锁定状态已更新');
    },
    onError: () => {
      void message.error('工序锁定/解锁失败');
    },
  });

  const replanMutation = useMutation({
    mutationFn: async (basePlanVersion: string) => {
      const payload: ReplanFromVersionPayload = {
        idempotency_key: `replan-${basePlanVersion}-${Date.now()}`,
        expected_head_plan_version: basePlanVersion,
        event: {
          event_id: `replan-${basePlanVersion}-${Date.now()}`,
          sequence: 1,
          occurred_at: new Date().toISOString(),
          event_type: 'capacity_change',
          source: 'schedule-gantt',
          severity: 'medium',
          reason: '排程调整后重排生成新子版本',
          // capacity_change 事件需要 resource_id + status；取 head 首个资源、
          // 状态保持 available（无实际变化，仅作为重排触发事件）。
          payload: {
            resource_id: boardQuery.data?.resources[0]?.id ?? '',
            status: 'available',
          },
        },
      };
      // 子版本属于同一业务任务，继承 head 计划的 Tracking TaskID。
      return replanFromVersion(basePlanVersion, payload, boardQuery.data?.trackingTaskId);
    },
    onSuccess: async (result) => {
      setReplanOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['schedule-board'] });
      await queryClient.invalidateQueries({ queryKey: ['schedule-events'] });
      const newPlanVersion =
        typeof result === 'object' && result !== null
          ? ((result as { result?: { schedule?: { plan_version?: string } } }).result?.schedule?.plan_version)
          : undefined;
      setLastAdjustedTask(newPlanVersion ? `已生成新子版本 ${newPlanVersion}` : '已生成新子版本');
      void message.success('已生成新子版本，请刷新后查看');
    },
    onError: () => {
      setReplanOpen(false);
      setOperationError('创建子版本失败');
      void message.error('创建子版本失败');
    },
  });

  return (
    <Space direction="vertical" size={16} className="page-stack">
      <Card title="排程甘特图">
        <Alert
          type="info"
          showIcon
          message="M5 排程视图"
          description="当前展示后端已生成的最新计划版本。没有计划时显示空态；请先通过 M5 排程接口创建计划。"
        />
        {board?.planVersion ? (
          <Space wrap size={8} className="schedule-lifecycle-strip" data-testid="schedule-lifecycle-strip">
            <Tag color={lifecycle.color} data-testid="schedule-lifecycle-tag">
              排程状态：{lifecycle.label}
            </Tag>
            {typeof board.validationPassed === 'boolean' ? (
              <Tag color={board.validationPassed ? 'success' : 'error'}>
                校验{board.validationPassed ? '通过' : '未通过'}
              </Tag>
            ) : null}
            {board.scenarioPurpose ? (
              <Tag color={board.scenarioPurpose === 'production' ? 'blue' : 'orange'}>
                {board.scenarioPurpose === 'production' ? '生产排程' : '压力测试'}
              </Tag>
            ) : null}
            <Typography.Text type="secondary">计划版本 {board.planVersion}</Typography.Text>
            {releasedAt || approvedAt ? (
              <Typography.Text type="secondary" data-testid="schedule-lifecycle-time">
                {releasedAt ? '发布于' : '审批于'} {formatLocalDateTime(releasedAt ?? approvedAt)}
              </Typography.Text>
            ) : null}
          </Space>
        ) : null}
        {canAdjust && board?.planVersion ? (
          <Space style={{ marginTop: 8 }} wrap>
            <Button
              size="small"
              type="primary"
              ghost
              loading={replanMutation.isPending}
              onClick={() => setReplanOpen(true)}
              data-testid="schedule-replan-button"
            >
              创建新子版本（重排）
            </Button>
            <Typography.Text type="secondary">
              从当前 head 版本重排生成新子版本；原版本保留，新版本校验通过后可审批/发布。
            </Typography.Text>
          </Space>
        ) : null}
        {lastAdjustedTask ? <Alert className="inline-alert" type="success" showIcon message={lastAdjustedTask} /> : null}
        {operationError ? <Alert className="inline-alert" type="error" showIcon message={operationError} /> : null}
        {revalidationNotice ? (
          <Alert
            className="inline-alert"
            type="warning"
            showIcon
            message="已提交，待后端重校验"
            description="工序调整已保存，排程需由后端重新校验后再审批/发布。"
            data-testid="schedule-revalidation-notice"
          />
        ) : null}
        {auditWarning ? <Alert className="inline-alert" type="warning" showIcon message={AUDIT_LOG_SYNC_FAILURE_MESSAGE} description="主排程调整已完成，操作日志稍后补偿同步。" /> : null}
        <PageState loading={pageLoading} error={pageError} empty={boardQuery.data?.tasks.length === 0}>
          {boardQuery.data ? (
            <GanttView
              board={boardQuery.data}
              dependencies={dependenciesQuery.data ?? []}
              adjusting={mutation.isPending}
              adjustable={canAdjust}
              onAdjust={(request) => mutation.mutate(request)}
              onToggleLock={(request) => lockMutation.mutate(request)}
              locking={lockMutation.isPending}
            />
          ) : null}
        </PageState>
      </Card>
      <Card title="产能负载">
        <PageState loading={pageLoading} error={pageError} empty={boardQuery.data?.tasks.length === 0} emptyDescription="暂无任务，无法计算产能负载">
          {boardQuery.data ? <CapacityLoadView board={boardQuery.data} /> : null}
        </PageState>
      </Card>
      <Card title="约束冲突">
        <PageState loading={boardQuery.isLoading} error={boardQuery.error} empty={boardQuery.data?.conflicts.length === 0} emptyDescription="暂无冲突">
          <Space direction="vertical">
            {boardQuery.data?.conflicts.map((item) => (
              <Alert
                key={item.id}
                type={item.level === 'high' ? 'error' : 'warning'}
                showIcon
                message={
                  <Space>
                    <StatusTag value={item.level} />
                    {item.message}
                  </Space>
                }
              />
            ))}
          </Space>
        </PageState>
      </Card>
      <Card
        title="事件时间线"
        extra={
          board?.planVersion ? <Typography.Text type="secondary">计划 {board.planVersion}</Typography.Text> : null
        }
      >
        <ScheduleEventTimeline planVersion={board?.planVersion} />
      </Card>
      <Modal
        title="创建新子版本（重排）"
        open={replanOpen}
        onCancel={() => setReplanOpen(false)}
        onOk={() => {
          if (board?.planVersion) {
            replanMutation.mutate(board.planVersion);
          }
        }}
        confirmLoading={replanMutation.isPending}
        okText="生成子版本"
      >
        <Space direction="vertical" size={8}>
          <Alert
            type="info"
            showIcon
            message={`从 head 版本 ${board?.planVersion ?? '-'} 重排生成新子版本`}
            description="原版本保持不变；新子版本会继承排程输入并重新求解，生成后需重新校验；校验通过后即可走审批/发布流程。"
          />
          <Typography.Text type="secondary">此操作会生成新的计划版本并作为新的 head 展示。</Typography.Text>
        </Space>
      </Modal>
    </Space>
  );
}
