import { Alert, Button, Card, Checkbox, Empty, Input, Select, Space, Table, Tag, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ActionGate } from '../components/ActionGate';
import type { ProductionTeam, TeamMember, WorkerOrderBinding } from '../schemas/leader';
import {
  addLeaderTeamMember,
  bindWorkersToOrder,
  listLeaderTeamMembers,
  listOrderBindings,
  unbindWorkerFromOrder,
} from '../services/leaderApi';
import { TestWorkerSelect } from '../features/roles/TestWorkerSelect';
import { loadTestPersonnel, personnelDisplayName } from '../features/roles/testPersonnel';
import { useCurrentRole } from '../features/roles/useCurrentRole';
import { hasPermission } from '../services/permissionApi';

export function OrderBindingTab({ teams }: { teams: ProductionTeam[] }) {
  const queryClient = useQueryClient();
  const roleQuery = useCurrentRole();
  const canWrite = hasPermission(roleQuery.data, 'leader:write');
  const [teamId, setTeamId] = useState<string>(teams[0]?.team_id ?? '');
  const [orderId, setOrderId] = useState('');
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const team = teams.find((item) => item.team_id === teamId) ?? teams[0];

  const membersQuery = useQuery({
    queryKey: ['leader', 'members', team?.team_id],
    queryFn: () => (team ? listLeaderTeamMembers(team.team_id) : Promise.resolve([])),
    enabled: Boolean(team),
  });
  const members: TeamMember[] = useMemo(
    () => membersQuery.data ?? [],
    [membersQuery.data],
  );

  const bindingsQuery = useQuery({
    queryKey: ['leader', 'bindings', orderId],
    queryFn: () => (orderId.trim() ? listOrderBindings({ order_id: orderId.trim() }) : Promise.resolve([])),
    enabled: Boolean(orderId.trim()),
  });
  const bindings: WorkerOrderBinding[] = useMemo(
    () => bindingsQuery.data ?? [],
    [bindingsQuery.data],
  );

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.worker_id, member])),
    [members],
  );

  // 本地测试名单中的工人（不在班组时作为回退工人池，绑定前自动加入班组）。
  const localWorkers = useMemo(
    () => loadTestPersonnel().filter((person) => person.role === 'worker' && !memberById.has(person.id)),
    [memberById],
  );

  const ensureTeamMembers = async (workerIds: string[]) => {
    if (!canWrite || !team) return;
    for (const workerId of workerIds) {
      const local = localWorkers.find((person) => person.id === workerId);
      if (local) {
        // 幂等：已存在会报错，忽略即可
        await addLeaderTeamMember(team.team_id, {
          worker_id: local.id,
          worker_name: local.name,
          station: local.station,
        }).catch(() => undefined);
      }
    }
  };

  const doBind = async () => {
    if (!canWrite) return;
    if (!team || !orderId.trim() || selectedWorkerIds.length === 0) {
      void message.warning('请选择班组、填写订单号并勾选工人');
      return;
    }
    setBusy(true);
    try {
      await ensureTeamMembers(selectedWorkerIds);
      await bindWorkersToOrder({
        order_id: orderId.trim(),
        worker_ids: selectedWorkerIds,
        team_id: team.team_id,
      });
      void message.success(`绑定成功：${orderId.trim()} → ${selectedWorkerIds.length} 名工人`);
      setSelectedWorkerIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['leader', 'bindings', orderId] }),
        queryClient.invalidateQueries({ queryKey: ['leader', 'members', team.team_id] }),
      ]);
    } catch (cause) {
      void message.error(`绑定失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const doUnbind = async (bindingId: string) => {
    if (!canWrite) return;
    setBusy(true);
    try {
      await unbindWorkerFromOrder(bindingId);
      void message.success('已解绑');
      await queryClient.invalidateQueries({ queryKey: ['leader', 'bindings', orderId] });
    } catch (cause) {
      void message.error(`解绑失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const quickPickWorker = (workerId: string) => {
    if (!canWrite || !workerId) return;
    setSelectedWorkerIds((prev) => (prev.includes(workerId) ? prev : [...prev, workerId]));
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small" title="绑定工人到订单（派工）">
        <Space wrap>
          <Select
            aria-label="选择班组"
            style={{ width: 220 }}
            value={teamId}
            onChange={setTeamId}
            options={teams.map((item) => ({ value: item.team_id, label: item.team_name }))}
          />
          <Input
            aria-label="订单号"
            style={{ width: 240 }}
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="订单号，如 SO-HIST-20260724-001"
          />
          <ActionGate
            permission="leader:write"
            auditModule="LeaderWorkbench"
            targetId={`order:${orderId.trim() || 'unselected'}:bind`}
          >
            <Button type="primary" disabled={!canWrite} loading={busy} onClick={() => void doBind()}>
              绑定所选工人
            </Button>
          </ActionGate>
        </Space>
        {team ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 8 }}>
              测试工人快速选择（可搜索，选中后自动勾选）：
            </div>
            <TestWorkerSelect
              role="worker"
              persist={false}
              aria-label="测试工人快速选择"
              placeholder="搜索选择工人-张三 / 工人-李四…"
              style={{ width: 320 }}
              disabled={!canWrite}
              onChange={quickPickWorker}
            />
            <div style={{ marginTop: 12, marginBottom: 8 }}>
              工人池（勾选要绑定的；「测试名单」工人绑定时自动加入班组）：
            </div>
            {membersQuery.isLoading ? (
              <Alert type="info" message="加载工人中…" showIcon />
            ) : members.length === 0 && localWorkers.length === 0 ? (
              <Empty description="班组没有工人且本地测试名单为空，请先添加工人" />
            ) : (
              <Checkbox.Group
                value={selectedWorkerIds}
                disabled={!canWrite}
                onChange={(values) => {
                  if (canWrite) setSelectedWorkerIds(values as string[]);
                }}
                options={[
                  ...members.map((member) => ({
                    value: member.worker_id,
                    label: `${member.worker_name}（${member.worker_id}）${member.station ? ` · ${member.station}` : ''}`,
                  })),
                  ...localWorkers.map((person) => ({
                    value: person.id,
                    label: `${personnelDisplayName(person)}（${person.id}）${person.station ? ` · ${person.station}` : ''} · 测试名单`,
                  })),
                ]}
              />
            )}
            {localWorkers.length > 0 ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message="本地测试名单回退"
                description="后端未返回这些工人的班组记录时，勾选后会自动先加入当前班组再绑定，保证派工流程可走通。"
              />
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card size="small" title={`订单 ${orderId || '（未填写）'} 已绑定工人`}>
        {!orderId.trim() ? (
          <Empty description="填写订单号后查看已绑定工人" />
        ) : bindingsQuery.isLoading ? (
          <Alert type="info" message="加载中…" showIcon />
        ) : bindings.length === 0 ? (
          <Empty description="该订单还没有绑定工人" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={bindings}
            columns={[
              { title: '工人', render: (_: unknown, row: WorkerOrderBinding) => memberById.get(row.worker_id)?.worker_name ?? row.worker_id },
              { title: '工号', dataIndex: 'worker_id' },
              { title: '工位', dataIndex: 'station', render: (value: string | undefined) => value ?? '-' },
              { title: '状态', dataIndex: 'status', render: (value: string) => (value === 'active' ? <Tag color="green">进行中</Tag> : <Tag>已结束</Tag>) },
              {
                title: '操作',
                render: (_: unknown, row: WorkerOrderBinding) =>
                  row.status === 'active' ? (
                    <ActionGate
                      permission="leader:write"
                      auditModule="LeaderWorkbench"
                      targetId={`binding:${row.id}:unbind`}
                    >
                      <Button
                        size="small"
                        danger
                        disabled={!canWrite}
                        loading={busy}
                        onClick={() => void doUnbind(row.id)}
                      >
                        解绑
                      </Button>
                    </ActionGate>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}
