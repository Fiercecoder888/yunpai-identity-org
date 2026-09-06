import { Alert, Button, Card, Descriptions, Empty, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, message } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listWorkerTasks, reportWorkerWork, type WorkerReportPayload } from '../../services/leaderApi';
import type { WorkerTask } from '../../schemas/leader';
import { uuidV4 } from '../../utils/uuid';
import { TestWorkerSelect } from './TestWorkerSelect';
import { loadTestPersonnel, personnelDisplayName } from './testPersonnel';
import { PieceWageReportCard } from '../wage/PieceWageReportCard';

const WORKER_ID_KEY = 'yunpai-worker-id';

const workerReportStatusLabel: Record<string, string> = {
  running: '生产中',
  completed: '已完工',
  paused: '已暂停',
  exception: '异常',
  scrapped: '已报废',
  reported: '已报数',
};

const workerTaskStatusLabel: Record<WorkerTask['actual_status'], string> = {
  not_started: '未开工',
  running: '生产中',
  paused: '已暂停',
  exception: '异常',
  scrapped: '已报废',
  completed: '已完工',
};

const workerTaskStatusColor: Record<WorkerTask['actual_status'], string> = {
  not_started: 'default',
  running: 'blue',
  paused: 'orange',
  exception: 'red',
  scrapped: 'red',
  completed: 'green',
};

type ReportFormValues = {
  event_type: 'actual_start' | 'actual_finish' | 'quantity_report' | 'exception';
  reported_quantity?: number;
  reported_unit?: string;
  actual_min?: number;
  reason?: string;
};

type WorkerReportCommand = Omit<WorkerReportPayload, 'idempotency_key'>;
type WorkerReportOption = { value: ReportFormValues['event_type']; label: string };

function workerReportIdempotencyKey(
  command: WorkerReportCommand,
  submissionId: string,
): string {
  const raw = JSON.stringify([
    'm5:worker-report',
    command.worker_id,
    command.plan_version,
    command.order_id,
    command.operation_id,
    command.resource_id,
    command.event_type,
    command.reported_quantity ?? null,
    command.reported_unit ?? null,
    command.scrap_quantity ?? null,
    command.actual_min ?? null,
    command.shift_date ?? null,
    command.reason ?? null,
  ]);
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) | 0;
  }
  return `wr-${(hash >>> 0).toString(36)}-${submissionId}`;
}

const reportEventOptions = (task: WorkerTask): WorkerReportOption[] => {
  if (task.actual_status === 'not_started') {
    return [
      { value: 'actual_start', label: '开工' },
      { value: 'exception', label: '异常' },
    ];
  }
  if (task.actual_status === 'running') {
    return [
      ...(task.unit ? [{ value: 'quantity_report' as const, label: '报数（进度反馈）' }] : []),
      { value: 'actual_finish', label: '完工' },
      { value: 'exception', label: '异常' },
    ];
  }
  return [];
};

const defaultReportEvent = (task: WorkerTask): ReportFormValues['event_type'] => {
  if (task.actual_status === 'not_started') return 'actual_start';
  if (task.actual_status === 'running' && task.unit) return 'quantity_report';
  return 'actual_finish';
};

export function WorkerSection() {
  const navigate = useNavigate();
  const [workerId, setWorkerId] = useState(() => localStorage.getItem(WORKER_ID_KEY) ?? '');
  const [tasks, setTasks] = useState<WorkerTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [reportTarget, setReportTarget] = useState<WorkerTask | null>(null);
  const personnel = loadTestPersonnel();
  const selectedPerson = personnel.find((person) => person.id === workerId.trim());
  const workerLabel = selectedPerson ? personnelDisplayName(selectedPerson) : workerId.trim();

  useEffect(() => {
    localStorage.setItem(WORKER_ID_KEY, workerId);
    if (!workerId.trim()) {
      setTasks([]);
      setError(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    listWorkerTasks(workerId.trim())
      .then((items) => {
        if (!cancelled) setTasks(items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workerId]);

  return (
    <Card
      title="我的订单与报工"
      extra={
        <Space wrap>
          <TestWorkerSelect
            role="worker"
            persist={false}
            aria-label="工人工号"
            placeholder="搜索选择测试工人（工人-张三…）"
            style={{ width: 260 }}
            value={workerId || undefined}
            onChange={(next) => setWorkerId(next)}
          />
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="对话报工"
          description={
            workerId.trim()
              ? '去对话页说明订单、工序、数量与工时，或直接在下方明确工序上点「报工」。'
              : '请先选择你的测试工号，才能查看已派发工序并报工。'
          }
          action={
            <Button size="small" type="link" onClick={() => navigate('/')}>
              去对话报工
            </Button>
          }
        />
        {error ? <Alert type="error" showIcon message="加载我的订单失败" description={error} /> : null}
        {!workerId.trim() ? (
          <Empty description="选择测试工号后显示你绑定的订单" />
        ) : loading ? (
          <Typography.Text type="secondary">加载中…</Typography.Text>
        ) : tasks.length === 0 ? (
          <Empty description="暂无可报工工序，请联系组长确认订单绑定和排程发布状态" />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {tasks.map((task) => (
              <div
                key={`${task.plan_version}:${task.order_id}:${task.operation_id}:${task.resource_id}`}
                className="worker-order-row"
              >
                <Tag color="blue">{task.order_id}</Tag>
                <Typography.Text strong>{task.operation_id} {task.operation_name}</Typography.Text>
                <Typography.Text type="secondary">
                  工位：{task.resource_name || task.station || task.resource_id}（{task.resource_id}）
                </Typography.Text>
                <Tag>{task.unit || '数据未完善'}</Tag>
                <Tag color={workerTaskStatusColor[task.actual_status]}>{workerTaskStatusLabel[task.actual_status]}</Tag>
                {task.actual_status === 'not_started' || task.actual_status === 'running' ? (
                  <Button size="small" type="primary" onClick={() => setReportTarget(task)}>
                    {task.actual_status === 'not_started' ? '开工' : '报工'}
                  </Button>
                ) : task.actual_status === 'paused' ? (
                  <Typography.Text type="secondary">请联系组长恢复后报工</Typography.Text>
                ) : task.actual_status === 'exception' ? (
                  <Typography.Text type="danger">请联系组长处理异常</Typography.Text>
                ) : null}
              </div>
            ))}
          </Space>
        )}
        <Button
          type="link"
          size="small"
          onClick={() => {
            if (workerId.trim()) {
              void listWorkerTasks(workerId.trim()).then(setTasks).catch(() => undefined);
            }
          }}
        >
          刷新我的工序
        </Button>
      </Space>
      <WorkerReportModal
        key={reportTarget ? `${reportTarget.plan_version}:${reportTarget.operation_id}:${reportTarget.resource_id}` : 'closed'}
        task={reportTarget}
        workerId={workerId}
        workerLabel={workerLabel}
        onClose={() => setReportTarget(null)}
        onReported={() => {
          if (workerId.trim()) {
            void listWorkerTasks(workerId.trim()).then(setTasks).catch(() => undefined);
          }
        }}
      />
      {workerId.trim() ? (
        <PieceWageReportCard workerId={workerId.trim()} />
      ) : null}
    </Card>
  );
}

function WorkerReportModal({
  task,
  workerId,
  workerLabel,
  onClose,
  onReported,
}: {
  task: WorkerTask | null;
  workerId: string;
  workerLabel: string;
  onClose: () => void;
  onReported: () => void;
}) {
  const [form] = Form.useForm<ReportFormValues>();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [submissionId] = useState(uuidV4);
  const eventType = Form.useWatch('event_type', form);
  const eventOptions = task ? reportEventOptions(task) : [];

  const submit = async (values: ReportFormValues) => {
    if (!task || !workerId.trim()) return;
    if (!eventOptions.some((option) => option.value === values.event_type)) {
      message.error('当前工序状态不允许此报工操作');
      return;
    }
    const isQuantityReport = values.event_type === 'quantity_report';
    const command: WorkerReportCommand = {
      worker_id: workerId.trim(),
      plan_version: task.plan_version,
      order_id: task.order_id,
      operation_id: task.operation_id,
      resource_id: task.resource_id,
      event_type: values.event_type,
      reported_quantity: isQuantityReport ? values.reported_quantity : undefined,
      reported_unit: isQuantityReport ? values.reported_unit?.trim() : undefined,
      actual_min: isQuantityReport || values.event_type === 'actual_finish' ? values.actual_min : undefined,
      reason: values.event_type === 'exception' ? values.reason?.trim() : undefined,
      shift_date: new Date().toISOString().slice(0, 10),
    };
    setSubmitting(true);
    try {
      const ledger = await reportWorkerWork({
        ...command,
        idempotency_key: workerReportIdempotencyKey(command, submissionId),
      }, task.tracking_task_id);
      message.success(`报工成功（${workerReportStatusLabel[ledger.status] ?? ledger.status}）`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['m5-pmc-progress'] }),
        queryClient.invalidateQueries({ queryKey: ['m5-execution-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['m5-schedule-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['schedule-board'] }),
      ]);
      form.resetFields();
      onClose();
      onReported();
    } catch (cause) {
      message.error(`报工失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="报工（完工/进度反馈）"
      open={Boolean(task)}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={submitting}
      width={520}
    >
      {task ? (
        <>
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="计划版本">{task.plan_version}</Descriptions.Item>
            <Descriptions.Item label="订单">{task.order_id}</Descriptions.Item>
            <Descriptions.Item label="工位/工序">{task.operation_id} {task.operation_name}</Descriptions.Item>
            <Descriptions.Item label="工位">
              {task.resource_name || task.station || task.resource_id}（{task.resource_id}）
            </Descriptions.Item>
            <Descriptions.Item label="计划单位">{task.unit || '数据未完善'}</Descriptions.Item>
            <Descriptions.Item label="当前状态">{workerTaskStatusLabel[task.actual_status]}</Descriptions.Item>
            <Descriptions.Item label="工人">{workerLabel}</Descriptions.Item>
          </Descriptions>
          <Form
            form={form}
            layout="vertical"
            initialValues={{ event_type: defaultReportEvent(task) }}
            onFinish={(values) => void submit(values)}
          >
            <Form.Item name="event_type" label="报工类型" rules={[{ required: true }]}>
              <Select
                options={eventOptions}
              />
            </Form.Item>
            {eventType === 'quantity_report' ? (
              <>
                <Form.Item name="reported_quantity" label="报数数量" rules={[{ required: true }]}>
                  <InputNumber min={0} style={{ width: '100%' }} placeholder="如 300" />
                </Form.Item>
                <Form.Item
                  name="reported_unit"
                  label="报数单位"
                  rules={[{ required: true, whitespace: true, message: '请输入报数单位' }]}
                >
                  <Input placeholder="请按计划单位输入，如 pcs" maxLength={32} />
                </Form.Item>
              </>
            ) : null}
            {eventType === 'actual_finish' || eventType === 'quantity_report' ? (
              <Form.Item name="actual_min" label="实际工时（分钟，可选）">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="如 360" />
              </Form.Item>
            ) : null}
            {eventType === 'exception' ? (
              <Form.Item name="reason" label="异常原因" rules={[{ required: true }]}>
                <Input.TextArea rows={2} />
              </Form.Item>
            ) : null}
          </Form>
        </>
      ) : null}
    </Modal>
  );
}
