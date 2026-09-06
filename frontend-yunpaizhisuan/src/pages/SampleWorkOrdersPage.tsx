import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  message,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { TaskId } from '../components/TaskId';
import {
  listSampleWorkOrders,
  getSampleWorkOrder,
  transitionSampleWorkOrder,
  type SampleWorkOrder,
  type SampleWorkOrderStatus,
} from '../services/sampleWorkOrderApi';

const { Title, Paragraph } = Typography;

const STATUS_META: Record<
  SampleWorkOrderStatus,
  { label: string; color: string }
> = {
  created: { label: '已创建', color: 'default' },
  executing: { label: '打样执行中', color: 'processing' },
  inspecting: { label: '样品检验中', color: 'warning' },
  done: { label: '已结案（合格）', color: 'success' },
  rejected: { label: '已驳回', color: 'error' },
};

const TYPE_LABEL: Record<string, string> = {
  normal: '正式订单',
  pre_order: '预订单',
  sample: '样品单',
};

export function SampleWorkOrdersPage() {
  const [items, setItems] = useState<SampleWorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [detail, setDetail] = useState<SampleWorkOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [reviewerInput, setReviewerInput] = useState('');
  const [resultInput, setResultInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSampleWorkOrders({ status: statusFilter, limit: 200 });
      setItems(data.items);
      setTotal(data.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (orderId: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await getSampleWorkOrder(orderId));
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDetailLoading(false);
    }
  };

  const transition = async (
    orderId: string,
    input: { status?: SampleWorkOrderStatus; remind?: boolean },
  ) => {
    setActionBusy(true);
    try {
      const updated = await transitionSampleWorkOrder(orderId, {
        ...input,
        reviewer: reviewerInput.trim() || undefined,
        result: resultInput.trim() || undefined,
      });
      setDetail(updated);
      void message.success('打样单状态已更新');
      await load();
    } catch (cause) {
      void message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(false);
    }
  };

  const nextAction = useMemo(() => {
    if (!detail) return null;
    const status = detail.status;
    if (status === 'created') {
      return { label: '开始打样', status: 'executing' as const };
    }
    if (status === 'executing') {
      return { label: '送样检验', status: 'inspecting' as const };
    }
    if (status === 'inspecting') {
      return null;
    }
    return null;
  }, [detail]);

  const columns = [
    {
      title: '打样单号/订单',
      dataIndex: 'order_id',
      render: (value: string) => (
        <Button type="link" onClick={() => void openDetail(value)}>
          {value}
        </Button>
      ),
    },
    {
      title: '类型',
      dataIndex: 'order_type',
      render: (value: string) => TYPE_LABEL[value] ?? value ?? '-',
    },
    { title: '产品名称', dataIndex: 'product_name', render: (value: unknown) => String(value ?? '-') },
    { title: '数量', dataIndex: 'qty', render: (value: unknown) => (value === null || value === undefined ? '-' : String(value)) },
    {
      title: '状态',
      dataIndex: 'status',
      render: (value: SampleWorkOrderStatus) => {
        const meta = STATUS_META[value] ?? { label: value, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: '检验结论', dataIndex: 'result', render: (value: unknown) => String(value ?? '-') },
    { title: '检验人', dataIndex: 'reviewer', render: (value: unknown) => String(value ?? '-') },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      render: (value: string) => (value ? new Date(value).toLocaleString() : '-'),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>打样组看板（样品/预订单）</Title>
      <Paragraph type="secondary">
        预订单/样品单走独立打样流程：简化 M2 → 打样执行 → 样品检验 → 样品库，
        不生成正式排程、不触发采购。台账状态机：created → executing → inspecting → done/rejected。
      </Paragraph>
      <Card
        title="样品/预订单台账"
        extra={
          <Space>
            <Segmented
              value={statusFilter ?? 'all'}
              onChange={(value) => setStatusFilter(value === 'all' ? undefined : String(value))}
              options={[
                { label: '全部', value: 'all' },
                { label: '打样中', value: 'executing' },
                { label: '检验中', value: 'inspecting' },
                { label: '已完成', value: 'done' },
                { label: '已驳回', value: 'rejected' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      >
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
        <Table
          rowKey="order_id"
          dataSource={items}
          columns={columns}
          loading={loading}
          pagination={{ pageSize: 20, total, showSizeChanger: false }}
          locale={{ emptyText: '暂无打样单' }}
        />
      </Card>

      <Drawer
        title={`打样单详情 · ${detail?.order_id ?? ''}`}
        open={detail !== null}
        onClose={() => setDetail(null)}
        width={520}
        loading={detailLoading}
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => (detail ? void openDetail(detail.order_id) : undefined)}
          >
            刷新
          </Button>
        }
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="订单号">{detail.order_id}</Descriptions.Item>
              <Descriptions.Item label="类型">
                {TYPE_LABEL[detail.order_type ?? ''] ?? detail.order_type ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="产品名称">{detail.product_name ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="数量">{detail.qty ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="打样组">{detail.sample_group ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_META[detail.status]?.color ?? 'default'}>
                  {STATUS_META[detail.status]?.label ?? detail.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="检验结论">{detail.result ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="检验人">{detail.reviewer ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="流程 TaskID">{detail.tracking_task_id ? <TaskId value={detail.tracking_task_id} /> : '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {detail.created_at ? new Date(detail.created_at).toLocaleString() : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {detail.updated_at ? new Date(detail.updated_at).toLocaleString() : '-'}
              </Descriptions.Item>
            </Descriptions>

            {detail.status === 'inspecting' ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input
                  value={reviewerInput}
                  onChange={(event) => setReviewerInput(event.target.value)}
                  placeholder="检验人（可选）"
                />
                <Input
                  value={resultInput}
                  onChange={(event) => setResultInput(event.target.value)}
                  placeholder="检验结论备注（可选）"
                />
                <Space>
                  <Button
                    type="primary"
                    loading={actionBusy}
                    onClick={() => void transition(detail.order_id, { status: 'done' })}
                  >
                    检验合格·结案入库
                  </Button>
                  <Button
                    danger
                    loading={actionBusy}
                    onClick={() => void transition(detail.order_id, { status: 'rejected' })}
                  >
                    检验不合格·驳回
                  </Button>
                </Space>
              </Space>
            ) : nextAction ? (
              <Button
                type="primary"
                loading={actionBusy}
                onClick={() => void transition(detail.order_id, { status: nextAction.status })}
              >
                {nextAction.label}
              </Button>
            ) : null}

            {detail.status === 'executing' || detail.status === 'created' ? (
              <Button
                loading={actionBusy}
                onClick={() => void transition(detail.order_id, { remind: true })}
              >
                催办
              </Button>
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
