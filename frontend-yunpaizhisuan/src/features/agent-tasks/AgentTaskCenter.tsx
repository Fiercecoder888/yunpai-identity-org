import {
  BellOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Empty,
  List,
  Segmented,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
  notification,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '../../auth/useAuthStore';
import {
  businessFlowRunProgress,
  getBusinessFlow,
  getBusinessFlowTrace,
} from '../../services/businessFlowRunApi';
import {
  getAgentTasks,
  updateAgentTaskReminder,
  type AgentCode,
  type AgentTask,
  type AgentTaskReminderAction,
} from '../../services/taskApi';
import { useBusinessRunStore } from '../business-flow/useBusinessRunStore';
import { useChatStore } from '../../store/useChatStore';
import styles from './AgentTaskCenter.module.css';

const AGENT_CODES: AgentCode[] = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'];
const EMPTY_TASKS: AgentTask[] = [];
const NOTIFIED_STORAGE_KEY = 'yunpai.agent-tasks.notified';

const businessStatusMeta: Record<
  AgentTask['business_status'],
  { label: string; color: string }
> = {
  human_input_required: { label: '待人工', color: 'orange' },
  blocked: { label: '已阻断', color: 'red' },
  data_incomplete: { label: '缺数据', color: 'gold' },
  failed: { label: '失败', color: 'error' },
  completed: { label: '已完成', color: 'success' },
  resolved: { label: '已处理', color: 'blue' },
  skipped: { label: '已跳过', color: 'default' },
};

const readNotifiedIds = (): Set<string> => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(NOTIFIED_STORAGE_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
};

const formatTime = (value?: string | null) => {
  if (!value) return '时间未提供';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
    : value;
};

function LocalGateNotificationCard({
  gate,
  onGoToChat,
}: {
  gate: Record<string, unknown>;
  onGoToChat: () => void;
}) {
  return <div className="local-gate-notification-card">
    <Tag color="error">需要人工处理</Tag>
    <strong>{String(gate.title || 'Agent 等待你的判断')}</strong>
    <p>{String(gate.reason || gate.message || 'Agent 发现一个需要人工处理的事项。')}</p>
    {gate.recommendation || gate.suggestion || gate.advice ? <div className="local-gate-notification-advice"><b>AI 建议：</b>{String(gate.recommendation || gate.suggestion || gate.advice)}</div> : null}
    <Space wrap className="local-gate-notification-actions">
      <Button size="small" type="primary" onClick={onGoToChat}>到会话里处理</Button>
    </Space>
    <span className="local-gate-notification-hint">通知只提醒，决策在对话流里完成。</span>
  </div>;
}

export function AgentTaskCenter({ supervision = false }: { supervision?: boolean }) {
  const tenantId = useAuthStore((state) => state.me?.tenant?.id ?? state.me?.tenant_id);
  const queryClient = useQueryClient();
  const [notificationApi, notificationContext] = notification.useNotification();
  const [open, setOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentCode>('m0');
  const [showDismissed, setShowDismissed] = useState(false);
  const [taskView, setTaskView] = useState<'active' | 'history'>('active');
  const [openingTaskId, setOpeningTaskId] = useState<string>();
  const notifiedIds = useRef(readNotifiedIds());
  const selectFirstTaskAgent = useRef(false);

  const tasksQuery = useQuery({
    queryKey: ['agent-tasks', tenantId],
    queryFn: () => getAgentTasks({ includeDismissed: true }),
    enabled: Boolean(tenantId),
    refetchInterval: 15_000,
  });
  const tasks = tasksQuery.data ?? EMPTY_TASKS;
  const localGateMessage = useChatStore((state) => state.messages.find((item) => item.gate && (!item.gate.status || item.gate.status === 'pending' || item.gate.status === 'error')));
  const localGateEnvelope = localGateMessage?.gate;
  const localGate = localGateEnvelope?.gate;
  const localGateNotificationKey = localGateEnvelope
    ? `local-gate-${localGateMessage.id}-${localGateEnvelope.runId}-${String(localGateEnvelope.gate.step_index ?? '')}`
    : undefined;
  const notifiedLocalGateKey = useRef<string | undefined>(undefined);
  const activeTasks = useMemo(
    () => tasks.filter((task) => !task.is_history),
    [tasks],
  );
  const pendingTaskCount = activeTasks.length + (localGate ? 1 : 0);
  const historyQuery = useQuery({
    queryKey: ['agent-task-history', tenantId, selectedAgent],
    queryFn: () => getAgentTasks({
      agent: selectedAgent,
      includeDismissed: true,
      includeHistory: true,
      historyLimit: 100,
    }),
    enabled: Boolean(tenantId && open),
  });
  const counts = useMemo(() => {
    const next: Record<AgentCode, number> = { m0: 0, m1: 0, m2: 0, m3: 0, m4: 0, m5: 0 };
    activeTasks.forEach((task) => { next[task.agent] += 1; });
    return next;
  }, [activeTasks]);

  const reminderMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: AgentTaskReminderAction }) =>
      updateAgentTaskReminder(id, action),
    onSuccess: (updated) => {
      queryClient.setQueryData<AgentTask[]>(['agent-tasks', tenantId], (current = []) =>
        current.map((task) => (task.id === updated.id ? updated : task)),
      );
    },
  });

  const openAgent = (agent: AgentCode) => {
    selectFirstTaskAgent.current = false;
    setSelectedAgent(agent);
    setTaskView('active');
    setOpen(true);
  };

  const openTaskCenter = () => {
    const firstWithTasks = AGENT_CODES.find((agent) => counts[agent] > 0);
    selectFirstTaskAgent.current = !firstWithTasks;
    setSelectedAgent(firstWithTasks ?? selectedAgent);
    setTaskView('active');
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !selectFirstTaskAgent.current) return;
    const firstWithTasks = AGENT_CODES.find((agent) => counts[agent] > 0);
    if (!firstWithTasks) return;
    selectFirstTaskAgent.current = false;
    setSelectedAgent(firstWithTasks);
  }, [counts, open]);

  useEffect(() => {
    const openAgentTasks = (event: Event) => {
      const agent = (event as CustomEvent<AgentCode>).detail;
      if (AGENT_CODES.includes(agent)) openAgent(agent);
    };
    window.addEventListener('yunpai:open-agent-tasks', openAgentTasks);
    return () => window.removeEventListener('yunpai:open-agent-tasks', openAgentTasks);
  }, []);

  useEffect(() => {
    const incoming = tasks.filter(
      (task) => task.reminder_status === 'unread' && !notifiedIds.current.has(task.id),
    );
    if (!incoming.length) return;

    const byAgent = new Map<AgentCode, AgentTask[]>();
    incoming.forEach((task) => {
      byAgent.set(task.agent, [...(byAgent.get(task.agent) ?? []), task]);
      notifiedIds.current.add(task.id);
    });
    try {
      sessionStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify([...notifiedIds.current]));
    } catch {
      // The current page still suppresses duplicate popups when storage is unavailable.
    }
    byAgent.forEach((agentTasks, agent) => {
      notificationApi.info({
        key: `agent-task-${agent}`,
        message: supervision ? `${agent.toUpperCase()} 有新流程任务` : `${agent.toUpperCase()} Agent 有新任务`,
        description: `${agentTasks.length} 个流程节点等待处理`,
        placement: 'topRight',
        duration: 8,
        btn: <Button size="small" type="primary" onClick={() => openAgent(agent)}>查看任务</Button>,
      });
    });
  }, [notificationApi, supervision, tasks]);

  useEffect(() => {
    if (!localGateEnvelope || !localGateNotificationKey) {
      if (notifiedLocalGateKey.current) {
        notificationApi.destroy(notifiedLocalGateKey.current);
        notifiedLocalGateKey.current = undefined;
      }
      return;
    }
    if (notifiedLocalGateKey.current === localGateNotificationKey) return;
    if (notifiedLocalGateKey.current) notificationApi.destroy(notifiedLocalGateKey.current);
    notifiedLocalGateKey.current = localGateNotificationKey;
    notificationApi.warning({
      key: localGateNotificationKey,
      message: 'Agent 等待人工指示',
      description: (
        <LocalGateNotificationCard
          gate={localGateEnvelope.gate}
          onGoToChat={() => {
            notificationApi.destroy(localGateNotificationKey);
            window.dispatchEvent(new CustomEvent('yunpai:focus-chat-gate'));
          }}
        />
      ),
      placement: 'bottomRight',
      duration: 0,
      className: 'local-gate-notification',
    });
  }, [localGateEnvelope, localGateMessage, localGateNotificationKey, notificationApi]);

  const openTask = async (task: AgentTask) => {
    if (openingTaskId) return;
    setOpeningTaskId(task.id);
    try {
      if (task.reminder_status === 'unread') {
        await reminderMutation.mutateAsync({ id: task.id, action: 'read' });
      }
      const run = await getBusinessFlow(task.run_id);
      let trace;
      try {
        trace = await getBusinessFlowTrace(task.run_id);
      } catch {
        trace = undefined;
      }
      useBusinessRunStore.getState().update(businessFlowRunProgress(run, trace));
      window.dispatchEvent(new CustomEvent('yunpai:focus-business-flow-task'));
      setOpen(false);
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[aria-label="订单业务流程"]')?.scrollIntoView({ block: 'start' });
      }, 0);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '任务上下文恢复失败');
    } finally {
      setOpeningTaskId(undefined);
    }
  };

  const visibleTasks = taskView === 'history'
    ? (historyQuery.data ?? EMPTY_TASKS).filter((task) => task.is_history)
    : tasks.filter(
        (task) =>
          !task.is_history &&
          task.agent === selectedAgent &&
          (showDismissed || task.reminder_status !== 'dismissed'),
      );
  const visibleLoading = taskView === 'history' ? historyQuery.isLoading : tasksQuery.isLoading;
  const visibleError = taskView === 'history' ? historyQuery.isError : tasksQuery.isError;

  const toggleDismiss = async (task: AgentTask) => {
    const action: AgentTaskReminderAction = task.reminder_status === 'dismissed' ? 'restore' : 'dismiss';
    try {
      await reminderMutation.mutateAsync({ id: task.id, action });
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '提醒状态更新失败');
    }
  };

  return (
    <>
      {notificationContext}
      <Tooltip title={supervision ? '流程任务' : 'Agent 任务'}>
        <Badge count={pendingTaskCount} size="small" overflowCount={99}>
          <Button
            type="text"
            icon={<BellOutlined />}
            aria-label={supervision ? '打开流程任务' : '打开 Agent 任务'}
            onClick={openTaskCenter}
          />
        </Badge>
      </Tooltip>
      <Drawer
        title={`${selectedAgent.toUpperCase()} ${supervision ? '流程任务' : 'Agent 任务'}`}
        open={open}
        onClose={() => setOpen(false)}
        width="min(94vw, 520px)"
        extra={taskView === 'active' ? (
          <Switch
            size="small"
            checked={showDismissed}
            onChange={setShowDismissed}
            checkedChildren="含已忽略"
            unCheckedChildren="仅有效"
          />
        ) : null}
      >
        <div className={styles.drawerBody} data-testid="agent-task-center">
          {localGate ? (
            <Alert
              type="warning"
              showIcon
              message="当前对话有一项需要你判断的 Agent 事项"
              description={String(localGate.recommendation || localGate.message || localGate.reason || 'Agent 已暂停，等待人工指示。')}
              action={<Button size="small" type="primary" onClick={() => setOpen(false)}>回到对话处理</Button>}
              style={{ marginBottom: 12 }}
            />
          ) : null}
          {visibleError ? (
            <Alert type="warning" showIcon message="任务列表暂时不可用" />
          ) : null}
          <Tabs
            activeKey={selectedAgent}
            onChange={(key) => setSelectedAgent(key as AgentCode)}
            items={AGENT_CODES.map((agent) => ({
              key: agent,
              label: (
                <Badge count={counts[agent]} size="small" offset={[7, -3]}>
                  <span className={styles.agentTab}>{agent.toUpperCase()}</span>
                </Badge>
              ),
            }))}
          />
          <Segmented
            block
            className={styles.viewSwitch}
            value={taskView}
            onChange={(value) => setTaskView(value as 'active' | 'history')}
            options={[
              { label: '当前任务', value: 'active' },
              { label: '历史记录', value: 'history' },
            ]}
          />
          {!visibleLoading && visibleTasks.length === 0 ? (
            <Empty description={taskView === 'history'
              ? `${selectedAgent.toUpperCase()} ${supervision ? '暂无历史流程任务' : 'Agent 暂无历史任务'}`
              : `${selectedAgent.toUpperCase()} ${supervision ? '暂无待处理流程任务' : 'Agent 暂无待处理任务'}`} />
          ) : (
            <List
              loading={visibleLoading}
              dataSource={visibleTasks}
              renderItem={(task) => {
                const status = businessStatusMeta[task.business_status];
                const dismissed = task.reminder_status === 'dismissed';
                return (
                  <List.Item
                    className={dismissed ? styles.dismissedTask : styles.taskRow}
                    actions={[
                      ...(!task.is_history ? [<Tooltip key="dismiss" title={dismissed ? '恢复此提醒' : '只忽略弹窗提醒，不改变未完成红点'}>
                        <Button
                          type="text"
                          size="small"
                          icon={dismissed ? <CheckOutlined /> : <CloseCircleOutlined />}
                          aria-label={dismissed ? '恢复提醒' : '忽略提醒'}
                          onClick={() => void toggleDismiss(task)}
                        />
                      </Tooltip>] : []),
                      <Button
                        key="open"
                        type="link"
                        size="small"
                        icon={<EyeOutlined />}
                        loading={openingTaskId === task.id}
                        onClick={() => void openTask(task)}
                      >
                        {task.is_history ? '查看记录' : supervision ? '查看进度' : '定位处理'}
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={
                        <Space size={8} wrap>
                          <Badge status={dismissed ? 'default' : 'error'} />
                          <Typography.Text strong={!dismissed} delete={dismissed}>
                            {task.title}
                          </Typography.Text>
                          <Tag color={status.color}>{status.label}</Tag>
                          {task.reminder_status === 'unread' ? <Tag color="red">新</Tag> : null}
                          {task.is_history ? <Tag>历史</Tag> : null}
                          {dismissed ? <Tag>已忽略提醒</Tag> : null}
                        </Space>
                      }
                      description={
                        <Space direction="vertical" size={3} className={styles.taskDetail}>
                          <span>{task.detail}</span>
                          <Typography.Text type="secondary">
                            订单：{task.order_id || '待解析'} · {formatTime(task.updated_at)}
                          </Typography.Text>
                          <Typography.Text type="secondary" copyable={{ text: task.tracking_task_id }}>
                            TaskID：{task.tracking_task_id}
                          </Typography.Text>
                        </Space>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          )}
        </div>
      </Drawer>
    </>
  );
}
