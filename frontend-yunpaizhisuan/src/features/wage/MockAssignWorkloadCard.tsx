import { Alert, Button, Card, DatePicker, Form, Input, InputNumber, Select, Space, Table, Tag, message } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addLeaderTeamMember, listLeaderTeamMembers, listLeaderTeams, queryWorkload, reportLeaderWork } from '../../services/leaderApi';
import { loadTestPersonnel } from '../roles/testPersonnel';
import { MOCK_STATIONS, stationDisplayLabel } from '../roles/stationCatalog';

const todayString = () => new Date().toISOString().slice(0, 10);

/**
 * 模拟工位安排与工作量（组长页卡片）：
 * - 选择模拟工位（SOP/PMC 工序目录，可自由输入）→ 选择/输入工人 → 填工作量（数量/报废）
 * - 保存即生成 workload_ledger（模拟 plan_version，绕过真实排程），计件工资即时可按工位单价计算
 * - 工人不在当前班组时自动加入（保证报工成员校验通过）
 */
export function MockAssignWorkloadCard({ leaderUserId }: { leaderUserId: string }) {
  const [form] = Form.useForm<{
    station: string | string[];
    worker: string | string[];
    order_id?: string;
    qty: number;
    scrap: number;
    shift_date?: unknown;
  }>();
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const teamsQuery = useQuery({
    queryKey: ['leader', 'teams', leaderUserId],
    queryFn: () => listLeaderTeams(leaderUserId),
  });
  const teams = teamsQuery.data ?? [];
  const team = teams[0] ?? null;
  const teamId = team?.team_id ?? '';

  const workerOptions = useMemo(
    () =>
      loadTestPersonnel()
        .filter((person) => person.role === 'worker')
        .map((person) => ({
          value: person.id,
          label: `${person.name}（${person.id}）${person.station ? ` @ ${person.station}` : ''}`,
        })),
    [],
  );

  // 最近安排记录（工作量台账由组长端直接产生；此处展示本组最近报工，来源 workload 查询）
  const workloadQuery = useQuery({
    queryKey: ['leader', 'workload', leaderUserId, teamId, todayString()],
    queryFn: () =>
      queryWorkload({
        team_id: teamId || undefined,
        shift_date: todayString(),
        leader_user_id: leaderUserId,
      }),
    enabled: Boolean(teamId),
  });
  const workloadRows = workloadQuery.data?.items ?? [];

  const save = async (values: {
    station: string | string[];
    worker: string | string[];
    order_id?: string;
    qty: number;
    scrap: number;
    shift_date?: unknown;
  }) => {
    const pick = (v: unknown): string =>
      Array.isArray(v) ? (v[0] as string | undefined) ?? '' : typeof v === 'string' ? v : '';
    const stationName = pick(values.station).trim();
    const workerId = pick(values.worker).trim();
    if (!stationName) { message.warning('请选择或输入工位'); return; }
    if (!workerId) { message.warning('请选择或输入工人'); return; }
    if (values.qty == null || values.qty < 0) { message.warning('请输入工作量（数量）'); return; }
    if (!teamId) { message.warning('请先创建班组'); return; }

    // 日期归一化：DatePicker 可能给 dayjs 对象，取 YYYY-MM-DD
    const rawDate = values.shift_date as unknown;
    const shiftDate = typeof rawDate === 'string' && rawDate ? rawDate : todayString();

    const station = MOCK_STATIONS.find((s) => s.station === stationName);
    const person = loadTestPersonnel().find((p) => p.id === workerId);
    const workerName = person?.name ?? workerId;

    setSaving(true);
    try {
      // 1) 确保工人在班组内（report_work 校验 member）
      const members = await listLeaderTeamMembers(teamId);
      if (!members.some((member) => member.worker_id === workerId)) {
        await addLeaderTeamMember(teamId, {
          worker_id: workerId,
          worker_name: workerName,
          station: stationName,
        });
      }
      // 2) 模拟派工报工（mock-assign：内部自动建 MOCK 计划 + 按事件链写台账）
      const mockPlan = `MOCK-PLAN-${Date.now()}`;
      const orderId = (values.order_id || '').trim() || `MOCK-ORDER-${Date.now().toString().slice(-6)}`;
      await reportLeaderWork(
        {
          plan_version: mockPlan,
          order_id: orderId,
          operation_id: station?.operationId ?? '',
          resource_id: station?.operationId ? `WC-${station.operationId.replace('OP-', '')}` : 'WC-MOCK',
          team_id: teamId,
          leader_user_id: leaderUserId,
          worker_id: workerId,
          station: stationName,
          event_type: 'quantity_report',
          occurred_at: new Date().toISOString(),
          reported_quantity: values.qty,
          scrap_quantity: values.scrap || 0,
          shift_date: shiftDate,
          params: { source: 'leader-mock-assign', mock: true },
        },
        undefined,
        '/m5/leader/mock-assign',
      );
      message.success(`已安排「${workerName}」到「${stationName}」，工作量 ${values.qty}${values.scrap ? `（报废 ${values.scrap}）` : ''}`);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['leader', 'workload'] });
      await queryClient.invalidateQueries({ queryKey: ['piece-wage'] });
    } catch (cause) {
      message.error(`安排失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="模拟工位安排与工作量" size="small" extra={<Tag color="blue">组长代安排 · 模拟排程</Tag>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="安排工人到工位并填写工作量"
          description="选择模拟工位（来源 SOP/PMC 工序目录）→ 选择/输入工人 → 填工作量（数量/报废）→ 保存。系统自动生成该工人的报工台账（模拟计划，不依赖真实排程），计件工资按工位单价即时计算。"
        />
        <Form form={form} layout="inline" onFinish={(values) => void save(values)} style={{ rowGap: 12 }}>
          <Form.Item name="station" label="模拟工位" rules={[{ required: true, message: '选工位' }]} style={{ minWidth: 260 }}>
            <Select
              showSearch
              mode="tags"
              maxCount={1}
              placeholder="选择或输入工位（押出/绞线/注塑…）"
              options={MOCK_STATIONS.map((station) => ({ value: station.station, label: stationDisplayLabel(station) }))}
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="worker" label="工人" rules={[{ required: true, message: '选工人' }]} style={{ minWidth: 220 }}>
            <Select
              showSearch
              mode="tags"
              maxCount={1}
              placeholder="选择测试工人 或 输入工号"
              options={workerOptions}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase()) ||
                String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="order_id" label="订单号（可空）">
            <Input style={{ width: 180 }} placeholder="留空自动生成模拟订单" />
          </Form.Item>
          <Form.Item name="qty" label="工作量(数量)" rules={[{ required: true, message: '填数量' }]}>
            <InputNumber min={0} style={{ width: 110 }} placeholder="如 500" />
          </Form.Item>
          <Form.Item name="scrap" label="报废" initialValue={0}>
            <InputNumber min={0} style={{ width: 90 }} placeholder="0" />
          </Form.Item>
          <Form.Item name="shift_date" label="日期">
            <DatePicker format="YYYY-MM-DD" placeholder="默认今天" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              安排并报工
            </Button>
          </Form.Item>
        </Form>

        <Table
          size="small"
          rowKey="id"
          loading={workloadQuery.isLoading}
          dataSource={workloadRows}
          pagination={false}
          locale={{ emptyText: '今日暂无本组报工记录' }}
          columns={[
            { title: '订单', dataIndex: 'order_id' },
            { title: '工位', dataIndex: 'station', render: (v?: string) => v || '-' },
            { title: '工人', dataIndex: 'worker_name', render: (v: string | undefined, row) => v ?? row.worker_id },
            { title: '数量', dataIndex: 'qty_reported' },
            { title: '报废', dataIndex: 'qty_scrap' },
          ]}
        />
      </Space>
    </Card>
  );
}
