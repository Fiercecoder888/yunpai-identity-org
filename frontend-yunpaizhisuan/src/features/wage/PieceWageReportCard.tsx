import { Alert, Button, Card, DatePicker, Descriptions, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchPieceRates, fetchPieceWageDaily, type PieceWageDaily } from '../../services/pieceWageApi';
import type { PermissionCode } from '../../services/permissionApi';
import { useCurrentRole } from '../roles/useCurrentRole';
import { M0MasterDataModal } from '../m0/M0MasterDataModal';

const { Text } = Typography;

const todayString = () => new Date().toISOString().slice(0, 10);

const uomLabel = (uom?: string) => uom || '件';

function Money({ value }: { value: number }) {
  return <Text style={{ color: '#cf1322', fontWeight: 600 }}>¥{value.toFixed(2)}</Text>;
}

/**
 * 计件工资报表卡片（agent 对话页风格）：
 * 三视图主导切换 —— 按订单（主）/ 按工位 / 按工人；无单价物料明确提示缺价。
 */
export function PieceWageReportCard({
  roleId,
  permissions,
  workerId,
  teamId,
}: {
  roleId?: string;
  permissions?: PermissionCode[];
  workerId?: string;
  teamId?: string;
}) {
  const currentRole = useCurrentRole();
  const effectiveRoleId = roleId ?? currentRole.data?.id;
  const effectivePermissions = permissions ?? currentRole.data?.permissions;
  const [shiftDate, setShiftDate] = useState<string>(todayString());
  const [view, setView] = useState<'order' | 'station' | 'worker'>('order');
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const isWorker = effectiveRoleId === 'worker';
  const isLeader = effectiveRoleId === 'team-leader';

  const query = useQuery({
    queryKey: ['piece-wage', shiftDate, workerId, teamId],
    queryFn: () =>
      fetchPieceWageDaily({
        shift_date: shiftDate,
        worker_id: isWorker ? workerId : undefined,
        team_id: isLeader ? teamId : undefined,
      }),
    enabled: Boolean(shiftDate),
  });

  const data: PieceWageDaily | undefined = query.data;
  const canManageRates = (effectivePermissions ?? []).includes('m4:operate' as PermissionCode) || isLeader;

  const orderRows = useMemo(
    () =>
      (data?.summary_by_order ?? []).map((row) => ({
        key: row.order_id,
        ...row,
      })),
    [data],
  );

  return (
    <Card title="计件工资" size="small" extra={<Space><Tag color="blue">按{view === 'order' ? '订单' : view === 'station' ? '工位' : '工人'}</Tag></Space>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <DatePicker
            format="YYYY-MM-DD"
            onChange={(_, dateString) => setShiftDate(String(dateString || todayString()))}
          />
          <Select
            style={{ width: 160 }}
            value={view}
            onChange={setView}
            options={[
              { value: 'order', label: '按订单（主）' },
              { value: 'station', label: '按工位' },
              { value: 'worker', label: '按工人' },
            ]}
          />
          <Statistic title="当日工资合计" value={data?.total ?? 0} precision={2} prefix="¥" />
          <Statistic title="明细行数" value={data?.line_count ?? 0} />
        </Space>

        {canManageRates ? (
          <Alert
            type="info"
            showIcon
            message="单价设置"
            description="单价在「基础数据管理 → 计件单价」中按订单×工位维护（单位可填 件/米/其他）；未配置单价的行会提示缺价，不静默计 0。"
            action={
              <Button size="small" type="primary" onClick={() => setRateModalOpen(true)}>
                去设置单价
              </Button>
            }
          />
        ) : null}

        <M0MasterDataModal
          open={rateModalOpen}
          onClose={() => setRateModalOpen(false)}
          initialTable="m0_master_piece_rate"
        />

        {query.isLoading ? <Alert type="info" showIcon message="加载中…" /> : null}
        {query.error ? <Alert type="error" showIcon message={`加载失败：${String(query.error)}`} /> : null}

        {!query.isLoading && data && data.missing_rate.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            message={`有 ${data.missing_rate.length} 行报工缺少计件单价（未计工资）`}
            description={data.missing_rate
              .slice(0, 5)
              .map((m) => `${m.order_id} · ${m.operation_id}${m.station ? `（${m.station}）` : ''} · 工人 ${m.worker_id} · ${m.qty_reported}${uomLabel()}`)
              .join('；')}
          />
        ) : null}

        {view === 'order' ? (
          <Table
            size="small"
            rowKey="key"
            loading={query.isLoading}
            dataSource={orderRows}
            pagination={false}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: '订单', dataIndex: 'order_id', ellipsis: true },
              { title: '工位/工序数', dataIndex: 'lines', width: 100 },
              {
                title: '工人',
                dataIndex: 'workers',
                ellipsis: true,
                render: (workers: string[]) => workers.join('、'),
              },
              { title: '工资', dataIndex: 'amount', width: 100, render: (v: number) => <Money value={v} /> },
            ]}
            expandable={{
              expandedRowRender: (row) => (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {(data?.lines ?? [])
                    .filter((line) => line.order_id === row.order_id)
                    .map((line) => (
                      <div
                        key={`${line.worker_id}:${line.operation_id}`}
                        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
                      >
                        <Tag style={{ marginInlineEnd: 0 }}>{line.operation_id}</Tag>
                        {line.station ? <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{line.station}</Text> : null}
                        <Text style={{ whiteSpace: 'nowrap' }}> {line.worker_name}：{line.qty_reported}{uomLabel(line.uom)} × ¥{line.unit_price} = </Text>
                        <Money value={line.amount} />
                        {!line.has_rate ? <Tag color="orange">缺单价</Tag> : null}
                      </div>
                    ))}
                </Space>
              ),
            }}
            locale={{ emptyText: '当日无报工数据' }}
          />
        ) : null}

        {view === 'station' ? (
          <Table
            size="small"
            rowKey="operation_id"
            loading={query.isLoading}
            dataSource={data?.summary_by_station ?? []}
            pagination={false}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: '工位/工序', dataIndex: 'operation_id', ellipsis: true },
              { title: '工位名', dataIndex: 'station', ellipsis: true, render: (v: string) => v || '-' },
              { title: '涉及订单', dataIndex: 'orders', ellipsis: true, render: (orders: string[]) => orders.join('、') },
              { title: '工人数', dataIndex: 'workers', width: 80, render: (workers: string[]) => workers.length },
              { title: '工资', dataIndex: 'amount', width: 100, render: (v: number) => <Money value={v} /> },
            ]}
            locale={{ emptyText: '当日无报工数据' }}
          />
        ) : null}

        {view === 'worker' ? (
          <Table
            size="small"
            rowKey="worker_id"
            loading={query.isLoading}
            dataSource={data?.summary_by_worker ?? []}
            pagination={false}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: '工人', dataIndex: 'worker_name', ellipsis: true, render: (v: string, row) => `${v}（${row.worker_id}）` },
              { title: '订单数', dataIndex: 'orders', width: 80, render: (orders: string[]) => orders.length },
              { title: '明细行数', dataIndex: 'lines', width: 90 },
              { title: '工资', dataIndex: 'amount', width: 100, render: (v: number) => <Money value={v} /> },
            ]}
            locale={{ emptyText: '当日无报工数据' }}
          />
        ) : null}

        <RateHint />
      </Space>
    </Card>
  );
}

function RateHint() {
  const ratesQuery = useQuery({ queryKey: ['piece-rates-hint'], queryFn: () => fetchPieceRates({}) });
  const count = ratesQuery.data?.length ?? 0;
  return (
    <Descriptions size="small" column={1} style={{ marginTop: 4 }}>
      <Descriptions.Item label="已配置单价">
        {ratesQuery.isLoading ? '加载中…' : `${count} 条（订单×工位）`}
      </Descriptions.Item>
    </Descriptions>
  );
}
