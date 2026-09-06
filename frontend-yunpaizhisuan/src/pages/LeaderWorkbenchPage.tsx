import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMemo, useState } from 'react';
import { PageHeading } from '../components/PageHeading';
import { OrderBindingTab } from './OrderBindingTab';
import { ActionGate } from '../components/ActionGate';
import { PermissionGate } from '../components/PermissionGate';
import { StructuredSection } from '../components/StructuredJson';
import { statusColors } from '../components/statusColors';
import type {
  LeaderTodayTask,
  ProductionTeam,
  TeamMember,
  WorkloadComparison,
  WorkloadLedger,
  WorkloadQuery,
} from '../schemas/leader';
import {
  addLeaderTeamMember,
  createLeaderTeam,
  getLeaderTodayTasks,
  getOrderWorkload,
  getWorkloadComparison,
  listLeaderTeamMembers,
  listLeaderTeams,
  queryWorkload,
  reportLeaderWork,
  type LeaderReportPayload,
} from '../services/leaderApi';
import { getBusinessOrderTrace, type JsonRecord } from '../services/businessTraceApi';
import { useAuthStore } from '../auth/useAuthStore';
import { TestWorkerSelect } from '../features/roles/TestWorkerSelect';
import { loadTestPersonnel, personnelDisplayName } from '../features/roles/testPersonnel';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { hasPermission } from '../services/permissionApi';
import { uuidV4 } from '../utils/uuid';
import { MOCK_STATIONS, stationDisplayLabel } from '../features/roles/stationCatalog';
import { PieceWageReportCard } from '../features/wage/PieceWageReportCard';
import { MockStationRateCard } from '../features/wage/MockStationRateCard';
import { MockAssignWorkloadCard } from '../features/wage/MockAssignWorkloadCard';

const { Text } = Typography;

const leaderIdStorageKey = 'yunpai.leader-user-id';

const todayString = () => new Date().toISOString().slice(0, 10);

const formatMin = (value?: number | null) => (value == null ? '-' : `${Math.round(value)} 分钟`);
/** Statistic 用：分钟精确到整数（消除浮点尾巴，如 1920.0000001666667 → 1920）。 */
const statMin = (value?: number | null) => (value == null ? 0 : Math.round(value));

const useLeaderWriteAccess = () => {
  const roleQuery = useCurrentRole();
  return hasPermission(roleQuery.data, 'leader:write');
};

const progressTag = (state: string) => {
  if (state === 'completed') return <Tag color={statusColors.success}>已完工</Tag>;
  if (state === 'running') return <Tag color={statusColors.info}>生产中</Tag>;
  if (state === 'exception') return <Tag color={statusColors.risk}>异常</Tag>;
  if (state === 'paused') return <Tag color={statusColors.warning}>暂停</Tag>;
  return <Tag>未开工</Tag>;
};

const reportStatusLabel: Record<string, string> = {
  running: '生产中',
  completed: '已完工',
  paused: '已暂停',
  exception: '异常',
  scrapped: '已报废',
  reported: '已报数',
};

/** 报工幂等键：同一次弹窗提交稳定重放，重新打开弹窗会创建新的业务命令。 */
function reportIdempotencyKey(
  task: LeaderTodayTask,
  values: { worker_id: string; event_type: LeaderReportPayload['event_type'] },
  submissionId: string,
): string {
  const raw = [
    'm5:leader-report',
    task.plan_version,
    task.operation_id,
    values.event_type,
    values.worker_id,
  ].join(':');
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `lr-${(hash >>> 0).toString(36)}-${submissionId}`;
}

function TeamSetupCard({
  leaderUserId,
  onCreated,
}: {
  leaderUserId: string;
  onCreated: () => void;
}) {
  const canWrite = useLeaderWriteAccess();
  const [form] = Form.useForm<{
    team_code: string;
    team_name: string;
    resource_ids?: string;
  }>();
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: createLeaderTeam,
    onSuccess: async () => {
      message.success('班组已创建，请添加组内工人');
      await queryClient.invalidateQueries({ queryKey: ['leader', 'teams'] });
      onCreated();
    },
    onError: (error) => message.error(`创建班组失败：${String(error)}`),
  });

  return (
    <Card title="班组初始化（首次使用）" size="small">
      <Form
        form={form}
        layout="vertical"
        style={{ maxWidth: 560 }}
        onFinish={(values) => {
          if (!canWrite) return;
          createMutation.mutate({
            team_code: values.team_code,
            team_name: values.team_name,
            leader_user_id: leaderUserId,
            resource_ids: (values.resource_ids ?? '')
              .split(/[,，\s]+/)
              .map((item) => item.trim())
              .filter(Boolean),
            shift_rule: { shift: 'day', start: '08:00', end: '17:00' },
          });
        }}
      >
        <Form.Item name="team_code" label="班组编码" rules={[{ required: true }]}>
          <Input placeholder="如 TEAM-A1" />
        </Form.Item>
        <Form.Item name="team_name" label="班组名称" rules={[{ required: true }]}>
          <Input placeholder="如一车间 A 班" />
        </Form.Item>
        <Form.Item name="resource_ids" label="资源范围（资源 ID，逗号分隔）">
          <Input placeholder="如 EQ-CUT,EQ-ASM" />
        </Form.Item>
        <ActionGate permission="leader:write" auditModule="LeaderWorkbench" targetId="create-team">
          <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
            创建班组
          </Button>
        </ActionGate>
      </Form>
    </Card>
  );
}

function MemberModal({
  team,
  open,
  onClose,
}: {
  team: ProductionTeam;
  open: boolean;
  onClose: () => void;
}) {
  const canWrite = useLeaderWriteAccess();
  const [form] = Form.useForm<{ worker_id: string | string[]; worker_name: string; station?: string | string[] }>();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (payload: { worker_id: string; worker_name: string; station?: string }) =>
      addLeaderTeamMember(team.team_id, payload),
    onSuccess: async () => {
      message.success('工人已加入班组');
      form.resetFields();
      onClose();
      await queryClient.invalidateQueries({ queryKey: ['leader', 'members', team.team_id] });
    },
    onError: (error) => message.error(`添加工人失败：${String(error)}`),
  });

  return (
    <Modal
      title={`添加组内工人 - ${team.team_name}`}
      open={open && canWrite}
      onCancel={onClose}
      onOk={() => {
        if (canWrite) form.submit();
      }}
      confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: !canWrite }}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(values) => {
          if (!canWrite) return;
          // tags 模式提交值为数组，归一化为字符串后提交
          const pick = (v: unknown): string | undefined =>
            Array.isArray(v) ? (v[0] as string | undefined) : typeof v === 'string' ? v : undefined;
          mutation.mutate({
            worker_id: pick(values.worker_id) ?? '',
            worker_name: values.worker_name,
            station: pick(values.station) ?? undefined,
          });
        }}
      >
        <Form.Item
          name="worker_id"
          label="工人"
          rules={[{ required: true, message: '请选择或输入工人' }]}
          extra="可从测试名单选择，也可自由输入工号（如 worker-custom）"
        >
          <Select
            showSearch
            mode="tags"
            maxCount={1}
            placeholder="选择测试工人 或 输入新工人工号"
            options={loadTestPersonnel()
              .filter((person) => person.role === 'worker')
              .map((person) => ({
                value: person.id,
                label: `${person.name}（${person.id}）${person.station ? ` @ ${person.station}` : ''}`,
              }))}
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase()) ||
              String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
            }
            onChange={(workerIds) => {
              const workerId = Array.isArray(workerIds) ? (workerIds[0] as string | undefined) : undefined;
              if (!workerId) return;
              const person = loadTestPersonnel().find((p) => p.id === workerId);
              // 从测试名单选中时自动带出姓名与工位；自由输入时姓名用输入值兜底
              if (!form.getFieldValue('worker_name')) {
                form.setFieldsValue({
                  worker_name: person?.name ?? workerId,
                  station: person?.station ?? form.getFieldValue('station'),
                });
              }
            }}
          />
        </Form.Item>
        <Form.Item name="worker_name" label="工人姓名" rules={[{ required: true }]}>
          <Input placeholder="如 王师傅（选择测试工人自动带出）" />
        </Form.Item>
        <Form.Item
          name="station"
          label="模拟工位"
          extra="工位来源：SOP/PMC 工序目录（可下拉选择，也可自由输入新工位）"
        >
          <Select
            showSearch
            mode="tags"
            maxCount={1}
            placeholder="选择或输入模拟工位（押出/绞线/注塑/裁线…）"
            options={MOCK_STATIONS.map((station) => ({
              value: station.station,
              label: stationDisplayLabel(station),
            }))}
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase())
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ReportModal({
  task,
  team,
  members,
  onClose,
}: {
  task: LeaderTodayTask | null;
  team: ProductionTeam | null;
  members: TeamMember[];
  onClose: () => void;
}) {
  const canWrite = useLeaderWriteAccess();
  const [form] = Form.useForm<{
    worker_id: string;
    event_type: LeaderReportPayload['event_type'];
    reported_quantity?: number;
    reported_unit?: string;
    scrap_quantity?: number;
    actual_min?: number;
    reason?: string;
  }>();
  const [submissionId] = useState(uuidV4);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ payload, taskId }: { payload: LeaderReportPayload; taskId?: string }) =>
      reportLeaderWork(payload, taskId),
    onSuccess: async (ledger) => {
      message.success(`报工成功（${reportStatusLabel[ledger.status] ?? ledger.status}）`);
      form.resetFields();
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leader', 'today-tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['leader', 'workload'] }),
        queryClient.invalidateQueries({ queryKey: ['m5-pmc-progress'] }),
        queryClient.invalidateQueries({ queryKey: ['m5-execution-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['m5-schedule-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['schedule-board'] }),
      ]);
    },
    onError: (error) => message.error(`报工失败：${String(error)}`),
  });

  // 本地测试名单回退：班组未返回工人时仍可从测试名单选择（如 工人-张三）。
  const localWorkerOptions = useMemo(
    () =>
      loadTestPersonnel()
        .filter((person) => person.role === 'worker' && !members.some((member) => member.worker_id === person.id))
        .map((person) => ({
          value: person.id,
          label: `${personnelDisplayName(person)}（${person.id}）${person.station ? ` @ ${person.station}` : ''} · 测试名单`,
        })),
    [members],
  );

  const eventType = Form.useWatch('event_type', form);

  const submit = (values: {
    worker_id: string;
    event_type: LeaderReportPayload['event_type'];
    reported_quantity?: number;
    reported_unit?: string;
    scrap_quantity?: number;
    actual_min?: number;
    reason?: string;
  }) => {
    if (!canWrite || !task || !team) return;
    const now = new Date();
    const base: LeaderReportPayload = {
      plan_version: task.plan_version,
      order_id: task.order_id,
      operation_id: task.operation_id,
      resource_id: task.resource_id,
      team_id: team.team_id,
      leader_user_id: team.leader_user_id,
      worker_id: values.worker_id,
      event_type: values.event_type,
      occurred_at: now.toISOString(),
      shift_date: todayString(),
      reported_quantity: values.reported_quantity,
      reported_unit: values.event_type === 'quantity_report' ? values.reported_unit?.trim() : undefined,
      scrap_quantity: values.scrap_quantity,
      actual_min: values.actual_min,
      reason: values.reason,
      // 同一次弹窗提交（包括网络重试或双击）复用键；重新打开后允许新的合法报工。
      idempotency_key: reportIdempotencyKey(task, values, submissionId),
      params: { source: 'leader-workbench', operation_name: task.operation_name },
    };
    if (values.event_type === 'actual_start') {
      base.actual_start_time = now.toISOString();
    } else if (values.event_type === 'actual_finish') {
      base.actual_end_time = now.toISOString();
      if (values.actual_min != null) {
        base.actual_start_time = new Date(now.getTime() - values.actual_min * 60_000).toISOString();
      } else {
        base.actual_start_time = task.start_time;
      }
    } else if (values.event_type === 'exception' && !values.reason) {
      message.warning('异常报工需要填写原因');
      return;
    }
    // 传递计划 Tracking TaskID：报工属于该计划业务任务，服务端会校验一致性。
    mutation.mutate({ payload: base, taskId: task.tracking_task_id || undefined });
  };

  return (
    <Modal
      title="报工"
      open={Boolean(task) && canWrite}
      onCancel={onClose}
      onOk={() => {
        if (canWrite) form.submit();
      }}
      confirmLoading={mutation.isPending}
      okButtonProps={{ disabled: !canWrite }}
      width={560}
    >
      {task ? (
        <>
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="订单">{task.order_id}</Descriptions.Item>
            <Descriptions.Item label="工序">
              {task.operation_id} {task.operation_name}
            </Descriptions.Item>
            <Descriptions.Item label="资源">
              {task.resource_id} {task.resource_name ?? ''}
            </Descriptions.Item>
            <Descriptions.Item label="计划工时">{formatMin(task.planned_minutes)}</Descriptions.Item>
            <Descriptions.Item label="计划 TaskID">
              {task.tracking_task_id || '未配置'}
            </Descriptions.Item>
          </Descriptions>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="报工会携带计划 TaskID 与提交级幂等键；同一次提交可安全重试，重新打开报工窗口会创建新的业务命令。"
          />
          <Form
            form={form}
            layout="vertical"
            initialValues={{ event_type: 'actual_start', scrap_quantity: 0 }}
            onFinish={submit}
          >
            <Form.Item name="worker_id" label="报工工人" rules={[{ required: true }]}>
              <Select
                showSearch
                placeholder="选择组内工人（可搜索姓名/工号）"
                optionFilterProp="label"
                options={[
                  ...members.map((member) => ({
                    value: member.worker_id,
                    label: `${member.worker_name}（${member.worker_id}）${member.station ? ` @ ${member.station}` : ''}`,
                  })),
                  ...localWorkerOptions,
                ]}
              />
            </Form.Item>
            <Form.Item name="event_type" label="报工类型" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'actual_start', label: '开工' },
                  { value: 'actual_finish', label: '完工' },
                  { value: 'quantity_report', label: '报数' },
                  { value: 'scrap', label: '报废' },
                  { value: 'exception', label: '异常' },
                ]}
              />
            </Form.Item>
            {eventType === 'quantity_report' || eventType === 'scrap' ? (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Form.Item name="reported_quantity" label="报数数量" rules={[{ required: eventType === 'quantity_report' }]}>
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
                {eventType === 'quantity_report' ? (
                  <>
                    <Form.Item
                      name="reported_unit"
                      label="报数单位"
                      rules={[{ required: true, whitespace: true, message: '请输入报数单位' }]}
                    >
                      <Input placeholder="例如 pcs" maxLength={32} />
                    </Form.Item>
                    <Form.Item name="scrap_quantity" label="其中报废数量">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                ) : null}
              </Space>
            ) : null}
            {eventType === 'actual_finish' || eventType === 'quantity_report' || eventType === 'scrap' ? (
              <Form.Item name="actual_min" label="实际工时（分钟，可选）">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="留空则由系统按开工/完工时间计算" />
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

const memberStatusLabel: Record<string, string> = {
  active: '在职',
  inactive: '停用',
  pending: '待确认',
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return '-';
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
};

function MembersTab({ teams }: { teams: ProductionTeam[] }) {
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(teams[0]?.team_id);
  const team = teams.find((item) => item.team_id === selectedTeamId) ?? teams[0] ?? null;
  const membersQuery = useQuery({
    queryKey: ['leader', 'members', team?.team_id],
    queryFn: () => listLeaderTeamMembers(team!.team_id),
    enabled: Boolean(team),
  });
  const members = membersQuery.data ?? [];

  const columns = [
    { title: '工人编号', dataIndex: 'worker_id' },
    { title: '姓名', dataIndex: 'worker_name' },
    { title: '工位', dataIndex: 'station', render: (value: string | null) => value || '-' },
    {
      title: '角色',
      dataIndex: 'role',
      render: (value: string) => (value ? <Tag>{value}</Tag> : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: string) => (
        <Tag color={value === 'active' ? 'success' : value === 'inactive' ? 'default' : 'warning'}>
          {memberStatusLabel[value] ?? value}
        </Tag>
      ),
    },
    { title: '创建时间', dataIndex: 'created_at', render: (value: string) => formatDateTime(value) },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Text>班组：</Text>
        <Select
          style={{ width: 240 }}
          value={team?.team_id}
          onChange={setSelectedTeamId}
          options={teams.map((item) => ({ value: item.team_id, label: item.team_name }))}
          placeholder="选择班组"
        />
        {team ? (
          <Text type="secondary">
            组长：{team.leader_user_id} · 资源：{(team.resource_ids ?? []).join(', ') || '-'}
          </Text>
        ) : null}
      </Space>
      <Table
        rowKey="id"
        dataSource={members}
        columns={columns}
        loading={membersQuery.isLoading}
        pagination={false}
        size="small"
        locale={{ emptyText: '该班组暂无工人，可通过页面顶部「添加工人」维护' }}
      />
    </Space>
  );
}

function TodayTasksTab({
  leaderUserId,
  day,
  teams,
}: {
  leaderUserId: string;
  day: string;
  teams: ProductionTeam[];
}) {
  const canWrite = useLeaderWriteAccess();
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(teams[0]?.team_id);
  const [reportTask, setReportTask] = useState<LeaderTodayTask | null>(null);
  const team = teams.find((item) => item.team_id === selectedTeamId) ?? teams[0] ?? null;
  const tasksQuery = useQuery({
    queryKey: ['leader', 'today-tasks', leaderUserId, day],
    queryFn: () => getLeaderTodayTasks(leaderUserId, day),
  });
  const membersQuery = useQuery({
    queryKey: ['leader', 'members', team?.team_id],
    queryFn: () => listLeaderTeamMembers(team!.team_id),
    enabled: Boolean(team),
  });

  const columns = [
    { title: '订单', dataIndex: 'order_id' },
    {
      title: '工序',
      render: (_: unknown, row: LeaderTodayTask) => `${row.operation_id} ${row.operation_name}`,
    },
    {
      title: '资源',
      render: (_: unknown, row: LeaderTodayTask) => `${row.resource_id}${row.resource_name ? ` ${row.resource_name}` : ''}`,
    },
    {
      title: '计划时间',
      render: (_: unknown, row: LeaderTodayTask) =>
        `${new Date(row.start_time).toLocaleTimeString('zh-CN', { hour12: false })} - ${new Date(row.end_time).toLocaleTimeString('zh-CN', { hour12: false })}`,
    },
    { title: '计划工时', dataIndex: 'planned_minutes', render: formatMin },
    { title: '进度', dataIndex: 'progress_state', render: progressTag },
    {
      title: '报数/报废',
      render: (_: unknown, row: LeaderTodayTask) => `${row.reported_quantity} / ${row.scrap_quantity}`,
    },
    { title: '台账条目', dataIndex: 'ledger_entry_count' },
    {
      title: '操作',
      render: (_: unknown, row: LeaderTodayTask) => (
        <ActionGate
          permission="leader:write"
          auditModule="LeaderWorkbench"
          targetId={`${row.plan_version}:${row.operation_id}:report`}
        >
          <Button
            size="small"
            type="primary"
            disabled={!team || !canWrite}
            onClick={() => {
              if (canWrite) setReportTask(row);
            }}
          >
            报工
          </Button>
        </ActionGate>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Text>班组：</Text>
        <Select
          style={{ width: 260 }}
          value={selectedTeamId ?? team?.team_id}
          onChange={setSelectedTeamId}
          options={teams.map((item) => ({ value: item.team_id, label: item.team_name }))}
        />
        {team ? <Text type="secondary">资源范围：{(team.resource_ids ?? []).join(', ') || '未设置'}</Text> : null}
      </Space>
      <Table
        rowKey={(row) => `${row.plan_version}:${row.operation_id}`}
        size="small"
        loading={tasksQuery.isLoading}
        columns={columns}
        dataSource={tasksQuery.data ?? []}
        locale={{ emptyText: '今日无已发布排程任务' }}
        pagination={false}
      />
      <ReportModal
        key={reportTask ? `${reportTask.plan_version}:${reportTask.operation_id}` : 'closed'}
        task={reportTask}
        team={team}
        members={membersQuery.data ?? []}
        onClose={() => setReportTask(null)}
      />
    </Space>
  );
}

function WorkloadTab({
  teams,
  leaderUserId,
}: {
  teams: ProductionTeam[];
  leaderUserId: string;
}) {
  const [teamId, setTeamId] = useState<string | undefined>(teams[0]?.team_id);
  const [shiftDate, setShiftDate] = useState<string>(todayString());
  const [workerId, setWorkerId] = useState<string | undefined>();
  const [orderId, setOrderId] = useState<string | undefined>();
  const query = useQuery({
    queryKey: ['leader', 'workload', leaderUserId, teamId, shiftDate, workerId, orderId],
    queryFn: () =>
      queryWorkload({
        team_id: teamId,
        shift_date: shiftDate || undefined,
        worker_id: workerId || undefined,
        order_id: orderId || undefined,
        leader_user_id: leaderUserId,
      }),
    enabled: Boolean(teamId),
  });
  const data: WorkloadQuery | undefined = query.data;

  const columns = [
    { title: '日期', dataIndex: 'shift_date' },
    { title: '订单', dataIndex: 'order_id' },
    {
      title: '工序',
      render: (_: unknown, row: WorkloadLedger) => `${row.operation_id} ${row.operation_name ?? ''}`,
    },
    {
      title: '工人',
      render: (_: unknown, row: WorkloadLedger) => `${row.worker_name ?? row.worker_id}${row.station ? `（${row.station}）` : ''}`,
    },
    { title: '计划工时', dataIndex: 'planned_min', render: formatMin },
    { title: '实际工时', dataIndex: 'actual_min', render: formatMin },
    { title: '报数', dataIndex: 'qty_reported' },
    { title: '报废', dataIndex: 'qty_scrap' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: string) => reportStatusLabel[value] ?? value,
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 240 }}
          placeholder="选择班组"
          value={teamId}
          onChange={setTeamId}
          options={teams.map((item) => ({ value: item.team_id, label: item.team_name }))}
        />
        <DatePicker
          format="YYYY-MM-DD"
          onChange={(_, dateString) => setShiftDate(String(dateString || ''))}
        />
        <TestWorkerSelect
          role="worker"
          persist={false}
          aria-label="工作量台账-工人筛选"
          placeholder="筛选工人（可搜索姓名/工号）"
          style={{ width: 200 }}
          value={workerId || undefined}
          onChange={(next) => setWorkerId(next || undefined)}
          allowClear
        />
        <Input
          style={{ width: 200 }}
          placeholder="订单号"
          allowClear
          onChange={(event) => setOrderId(event.target.value || undefined)}
        />
        <Button onClick={() => query.refetch()}>刷新</Button>
      </Space>
      <Space size={16} wrap>
        <Statistic title="计划工时" value={statMin(data?.total_planned_min)} suffix="分钟" />
        <Statistic title="实际工时" value={statMin(data?.total_actual_min)} suffix="分钟" />
        <Statistic title="报数" value={data?.total_qty_reported ?? 0} />
        <Statistic title="报废" value={data?.total_qty_scrap ?? 0} />
        <Statistic title="工人数" value={data?.worker_count ?? 0} />
      </Space>
      <Table
        rowKey="id"
        size="small"
        loading={query.isLoading}
        columns={columns}
        dataSource={data?.items ?? []}
        pagination={false}
        locale={{ emptyText: '暂无台账记录' }}
      />
    </Space>
  );
}

function ComparisonTab({ teams, leaderUserId }: { teams: ProductionTeam[]; leaderUserId: string }) {
  const [teamId, setTeamId] = useState<string | undefined>(teams[0]?.team_id);
  const [dateRange, setDateRange] = useState<[string, string]>([todayString(), todayString()]);
  const query = useQuery({
    queryKey: ['leader', 'comparison', teamId, dateRange],
    queryFn: () =>
      getWorkloadComparison({
        team_id: teamId!,
        date_from: dateRange[0],
        date_to: dateRange[1],
        leader_user_id: leaderUserId,
      }),
    enabled: Boolean(teamId),
  });
  const data: WorkloadComparison | undefined = query.data;

  const columns = [
    { title: '工人', render: (_: unknown, row: WorkloadComparison['items'][number]) => `${row.worker_name ?? row.worker_id}（${row.worker_id}）` },
    { title: '订单数', dataIndex: 'order_count' },
    { title: '报工条数', dataIndex: 'operation_count' },
    { title: '计划工时', dataIndex: 'planned_min', render: formatMin },
    { title: '实际工时', dataIndex: 'actual_min', render: formatMin },
    {
      title: '偏差',
      dataIndex: 'variance_min',
      render: (value: number) => (
        <Text type={value > 0 ? 'danger' : value < 0 ? 'success' : undefined}>
          {value > 0 ? '+' : ''}
          {Math.round(value)} 分钟
        </Text>
      ),
    },
    { title: '报数', dataIndex: 'qty_reported' },
    { title: '报废', dataIndex: 'qty_scrap' },
    {
      title: '完成率',
      dataIndex: 'completion_rate_percent',
      render: (value: number | null | undefined) => (value == null ? '-' : `${Math.round(value)}%`),
    },
  ];

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 240 }}
          placeholder="选择班组"
          value={teamId}
          onChange={setTeamId}
          options={teams.map((item) => ({ value: item.team_id, label: item.team_name }))}
        />
        <DatePicker.RangePicker
          format="YYYY-MM-DD"
          onChange={(_, dateStrings) => {
            if (dateStrings[0] && dateStrings[1]) {
              setDateRange([dateStrings[0], dateStrings[1]]);
            }
          }}
        />
        <Button onClick={() => query.refetch()}>刷新</Button>
      </Space>
      <Space size={16} wrap>
        <Statistic title="计划工时" value={statMin(data?.total_planned_min)} suffix="分钟" />
        <Statistic title="实际工时" value={statMin(data?.total_actual_min)} suffix="分钟" />
        <Statistic
          title="偏差"
          value={data?.total_variance_min ?? 0}
          suffix="分钟"
          valueStyle={{ color: (data?.total_variance_min ?? 0) > 0 ? '#cf1322' : undefined }}
        />
      </Space>
      <Table
        rowKey="worker_id"
        size="small"
        loading={query.isLoading}
        columns={columns}
        dataSource={data?.items ?? []}
        pagination={false}
        locale={{ emptyText: '该时段暂无报工数据' }}
      />
    </Space>
  );
}

function OrderTraceTab() {
  const [orderId, setOrderId] = useState('SO-LEADER-001');
  const [ledger, setLedger] = useState<WorkloadQuery | null>(null);
  const [trace, setTrace] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (deep: boolean) => {
    const value = orderId.trim();
    if (!value) return;
    setLoading(true);
    setError(null);
    try {
      const [ledgerData, traceData] = await Promise.all([
        getOrderWorkload(value),
        deep ? getBusinessOrderTrace(value) : Promise.resolve(null),
      ]);
      setLedger(ledgerData);
      setTrace(traceData);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space.Compact style={{ width: 520 }}>
        <Input
          value={orderId}
          placeholder="订单号（如 SO-LEADER-001）"
          onChange={(event) => setOrderId(event.target.value)}
          onPressEnter={() => void run(false)}
        />
        <Button loading={loading} onClick={() => void run(false)}>
          查台账
        </Button>
        <Button type="primary" loading={loading} onClick={() => void run(true)}>
          订单全链路追溯（工时/物料/良率）
        </Button>
      </Space.Compact>
      {error ? <Alert type="error" message={error} showIcon /> : null}
      {ledger ? (
        <div data-testid="order-trace-result">
          <Space size={16} wrap>
            <Statistic title="计划工时" value={statMin(ledger.total_planned_min)} suffix="分钟" />
            <Statistic title="实际工时" value={statMin(ledger.total_actual_min)} suffix="分钟" />
            <Statistic title="报数" value={ledger.total_qty_reported} />
            <Statistic title="报废" value={ledger.total_qty_scrap} />
          </Space>
          <Table
            rowKey="id"
            size="small"
            columns={[
              { title: '工序', render: (_: unknown, row: WorkloadLedger) => `${row.operation_id} ${row.operation_name ?? ''}` },
              { title: '工人', render: (_: unknown, row: WorkloadLedger) => row.worker_name ?? row.worker_id },
              { title: '计划工时', dataIndex: 'planned_min', render: formatMin },
              { title: '实际工时', dataIndex: 'actual_min', render: formatMin },
              { title: '报数', dataIndex: 'qty_reported' },
              { title: '报废', dataIndex: 'qty_scrap' },
              { title: '状态', dataIndex: 'status', render: (value: string) => reportStatusLabel[value] ?? value },
            ]}
            dataSource={ledger.items}
            pagination={false}
            locale={{ emptyText: '该订单暂无台账记录' }}
          />
        </div>
      ) : null}
      {trace ? (
        <StructuredSection
          title="订单全链路追溯（订单/物料/库存/排程/良率）"
          data={trace}
          maxDepth={1}
          maxRows={100}
          maxFields={16}
        />
      ) : null}
    </Space>
  );
}

export function LeaderWorkbenchPage() {
  const [leaderUserId, setLeaderUserId] = useState(
    () => window.localStorage.getItem(leaderIdStorageKey) ?? 'leader-zhang',
  );
  const [day, setDay] = useState<string>(todayString());
  const [memberTeam, setMemberTeam] = useState<ProductionTeam | null>(null);
  const canWrite = useLeaderWriteAccess();
  const authMe = useAuthStore((state) => state.me);
  // B0.5 当前只确认登录主体。下方 leaderUserId 仍是旧业务筛选字段，尚未由
  // M5 绑定到登录主体；必须明确区分，避免把可编辑值误称为审计身份。
  const confirmedIdentity = authMe
    ? `${authMe.user?.name || authMe.user?.email || '共享开发用户'} · ${authMe.principal_id}`
    : undefined;
  const teamsQuery = useQuery({
    queryKey: ['leader', 'teams', leaderUserId],
    queryFn: () => listLeaderTeams(leaderUserId),
  });
  const teams = teamsQuery.data ?? [];

  const saveLeaderId = (value: string) => {
    setLeaderUserId(value);
    window.localStorage.setItem(leaderIdStorageKey, value);
  };

  const tabs = [
      {
        key: 'today',
        label: '今日任务',
        children: (
          <TodayTasksTab
            leaderUserId={leaderUserId}
            day={day}
            teams={teams}
          />
        ),
      },
      {
        key: 'members',
        label: '工人',
        children: <MembersTab teams={teams} />,
      },
      {
        key: 'workload',
        label: '工作量台账',
        children: <WorkloadTab teams={teams} leaderUserId={leaderUserId} />,
      },
      {
        key: 'comparison',
        label: '工时对比',
        children: <ComparisonTab teams={teams} leaderUserId={leaderUserId} />,
      },
      {
        key: 'trace',
        label: '订单追溯',
        children: <OrderTraceTab />,
      },
      {
        key: 'binding',
        label: '订单绑定',
        children: <OrderBindingTab teams={teams} />,
      },
  ];

  return (
    <PermissionGate permission="leader:read" auditModule="LeaderWorkbench" targetId="leader">
      <PageHeading
        path="/leader"
        description="组长代工人报工：今日任务、报工、班组工作量台账、工时对比与订单追溯"
        extra={
          <Space>
            {confirmedIdentity ? (
              <Tag color="green">登录主体：{confirmedIdentity}</Tag>
            ) : null}
            <Text style={{ whiteSpace: 'nowrap' }}>组长身份（测试工号，开发期未绑定登录主体）：</Text>
            <TestWorkerSelect
              role="leader"
              persist={false}
              aria-label="组长工号"
              placeholder="选择组长（组长-张组长 / 组长-老周…）"
              style={{ width: 200 }}
              value={leaderUserId || undefined}
              onChange={saveLeaderId}
            />
            <DatePicker
              format="YYYY-MM-DD"
              onChange={(_, dateString) => setDay(String(dateString || todayString()))}
            />
          </Space>
        }
      />
      {teamsQuery.isLoading ? <Alert type="info" message="加载班组中…" showIcon /> : null}
      {!teamsQuery.isLoading && teams.length === 0 ? (
        <TeamSetupCard leaderUserId={leaderUserId} onCreated={() => undefined} />
      ) : null}
      {teams.length > 0 ? (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="组长工作台说明"
            description="组长 ID 为业务筛选字段（开发期未绑定登录主体，生产环境将校验登录主体与组长一致）；「今日任务」按 UTC 日界统计；报工携带计划 TaskID 与稳定幂等键。"
          />
          <Space style={{ marginBottom: 12 }} wrap>
            {teams.map((team) => (
              <Tag key={team.team_id} color="blue">
                {team.team_name}（组长：{team.leader_user_id}）
              </Tag>
            ))}
            <ActionGate permission="leader:write" auditModule="LeaderWorkbench" targetId="add-team-member">
              <Button
                size="small"
                disabled={!canWrite}
                onClick={() => {
                  if (canWrite) setMemberTeam(teams[0] ?? null);
                }}
              >
                添加工人
              </Button>
            </ActionGate>
          </Space>
          <Tabs items={tabs} />
          <PieceWageReportCard teamId={teams[0]?.team_id} />
          <MockStationRateCard />
          <MockAssignWorkloadCard leaderUserId={leaderUserId} />
        </>
      ) : null}
      {memberTeam && canWrite ? (
        <MemberModal team={memberTeam} open onClose={() => setMemberTeam(null)} />
      ) : null}
    </PermissionGate>
  );
}
