import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ReloadOutlined,
  SearchOutlined,
  SwapOutlined,
} from '@ant-design/icons';

import { isMswDemoMode } from '../app/runtimeMode';
import {
  getBusinessConsumptionVariance,
  getBusinessFlowOutboundFlow,
  getBusinessOrderOutboundFlow,
  refreshBusinessConsumptionVariance,
  type JsonRecord,
} from '../services/businessTraceApi';


const { Title, Paragraph, Text } = Typography;

const REASON_COLORS: Record<string, string> = {
  损耗: 'volcano',
  报废: 'red',
  未归还: 'gold',
  数据缺失: 'default',
  正常: 'green',
};

const REASON_OPTIONS = ['损耗', '报废', '未归还', '数据缺失', '正常'];

const fmt = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
};

const pct = (value: unknown) =>
  value === null || value === undefined ? '-' : `${(Number(value) * 100).toFixed(2)}%`;


export function WarehouseReconcilePage() {
  const demoMode = isMswDemoMode();
  const [report, setReport] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [orderFilter, setOrderFilter] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState<string | undefined>();
  const [flowContext, setFlowContext] = useState<{ orderId: string; runId?: string } | null>(null);
  const [flowData, setFlowData] = useState<JsonRecord | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(
        await getBusinessConsumptionVariance({
          orderId: orderFilter.trim() || undefined,
          materialCode: materialFilter.trim() || undefined,
          reason: reasonFilter,
        }),
      );
    } catch (err) {
      setError(String(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshBusinessConsumptionVariance(orderFilter.trim() || undefined);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!demoMode) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  const items = useMemo(
    () => (Array.isArray(report?.items) ? report.items as JsonRecord[] : []),
    [report],
  );
  const totals = useMemo(() => {
    const value = (report?.totals as JsonRecord | undefined) ?? {};
    const reasons = (value.reasons as JsonRecord | undefined) ?? {};
    return {
      count: Number(value.count ?? items.length),
      standardQty: Number(value.standard_qty ?? 0),
      actualQty: Number(value.actual_qty ?? 0),
      variance: Number(value.variance ?? 0),
      reasons: Object.entries(reasons).map(([name, count]) => ({ name, count: Number(count) })),
    };
  }, [report, items]);

  const pendingFlowNote = useMemo(() => {
    const note = items
      .map((item) => (item.data_quality as JsonRecord | undefined)?.pending_flow_note)
      .find((value) => typeof value === 'string' && value);
    return typeof note === 'string' ? note : '';
  }, [items]);

  const openFlow = async (orderId: string, runId?: string) => {
    setFlowContext({ orderId, runId });
    setFlowData(null);
    setFlowError(null);
    setFlowLoading(true);
    try {
      // run_id 为 ASCII，规避网关对中文订单号编码路径的 400；无 run_id 时按订单号查
      setFlowData(
        runId
          ? await getBusinessFlowOutboundFlow(runId)
          : await getBusinessOrderOutboundFlow(orderId),
      );
    } catch (err) {
      setFlowError(String(err));
    } finally {
      setFlowLoading(false);
    }
  };

  if (demoMode) {
    return (
      <div className="page-stack" style={{ padding: 24 }}>
        <Title level={3}>仓库出库对账</Title>
        <Paragraph type="secondary">
          按订单/物料查看实际领料出库与标准用量（需求×（1+损耗率））的差异，良品率折算进预计用料；订单级出库流向可联查。
        </Paragraph>
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="仓库出库对账（Demo 模式空态样例）：真实模式连接统一事实账本后展示差异账与出库流向。"
          />
        </Card>
      </div>
    );
  }

  const flowMaterials = Array.isArray(flowData?.materials) ? flowData.materials as JsonRecord[] : [];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>仓库出库对账</Title>
      <Paragraph type="secondary">
        实际消耗与标准用量对账：standard_qty=需求×（1+损耗率），yield_adjusted=良品率折算后预计用料，variance=实际−标准。
      </Paragraph>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card size="small">
          <Space wrap>
            <Input
              allowClear
              placeholder="订单号"
              value={orderFilter}
              onChange={(event) => setOrderFilter(event.target.value)}
              onPressEnter={() => void load()}
              style={{ width: 220 }}
            />
            <Input
              allowClear
              placeholder="物料编码"
              value={materialFilter}
              onChange={(event) => setMaterialFilter(event.target.value)}
              onPressEnter={() => void load()}
              style={{ width: 200 }}
            />
            <Select
              allowClear
              placeholder="差异原因"
              value={reasonFilter}
              onChange={setReasonFilter}
              options={REASON_OPTIONS.map((value) => ({ value, label: value }))}
              style={{ width: 140 }}
            />
            <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void load()}>
              查询
            </Button>
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refresh()}>
              刷新差异账
            </Button>
          </Space>
        </Card>
        {pendingFlowNote ? (
          <Alert
            type="warning"
            showIcon
            message="数据准确性提示"
            description={pendingFlowNote}
          />
        ) : null}
        {error ? (
          <div className="page-state-error" role="alert">
            <ReloadOutlined className="page-state-error-icon" />
            <div className="page-state-error-title">数据加载失败</div>
            <div className="page-state-error-description">差异账数据服务暂时不可用，请稍后重试或检查网络连接。</div>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>
          </div>
        ) : null}
        {report && (
          <>
            <Card size="small" title="对账汇总">
              <Space size="large" wrap>
                <Statistic title="差异行数" value={totals.count} />
                <Statistic title="标准用量合计" value={totals.standardQty} precision={2} />
                <Statistic title="实际用量合计" value={totals.actualQty} precision={2} />
                <Statistic
                  title="差异合计"
                  value={totals.variance}
                  precision={2}
                  valueStyle={{ color: totals.variance > 0 ? '#cf1322' : totals.variance < 0 ? '#d48806' : undefined }}
                />
                {totals.reasons.map(({ name, count }) => (
                  <Tag key={name} color={REASON_COLORS[name] ?? 'default'}>
                    {name} × {count}
                  </Tag>
                ))}
              </Space>
            </Card>
            <Table<JsonRecord>
              rowKey="variance_id"
              dataSource={items}
              pagination={{ pageSize: 20, showSizeChanger: true }}
              size="small"
              scroll={{ x: 1200 }}
              columns={[
                { title: '订单号', dataIndex: 'order_id', fixed: 'left', width: 180 },
                { title: '物料编码', dataIndex: 'material_code', width: 150 },
                { title: '物料名称', dataIndex: 'material_name', width: 160 },
                { title: '单位', dataIndex: 'unit', width: 70 },
                {
                  title: '标准用量',
                  dataIndex: 'standard_qty',
                  width: 110,
                  align: 'right',
                  render: fmt,
                },
                {
                  title: '实际用量',
                  dataIndex: 'actual_qty',
                  width: 110,
                  align: 'right',
                  render: fmt,
                },
                {
                  title: '差异',
                  dataIndex: 'variance',
                  width: 110,
                  align: 'right',
                  render: (value: unknown) => {
                    const number = Number(value);
                    return (
                      <Text type={number > 0 ? 'danger' : number < 0 ? 'warning' : undefined}>
                        {fmt(value)}
                      </Text>
                    );
                  },
                },
                {
                  title: '损耗率',
                  dataIndex: 'loss_rate',
                  width: 90,
                  align: 'right',
                  render: pct,
                },
                {
                  title: '良率',
                  dataIndex: 'yield_rate',
                  width: 90,
                  align: 'right',
                  render: pct,
                },
                {
                  title: '良率折算用量',
                  dataIndex: 'yield_adjusted',
                  width: 120,
                  align: 'right',
                  render: fmt,
                },
                {
                  title: '原因',
                  dataIndex: 'reason',
                  width: 100,
                  render: (value: unknown) => (
                    <Tag color={REASON_COLORS[String(value)] ?? 'default'}>{String(value)}</Tag>
                  ),
                },
                { title: '快照时间', dataIndex: 'snapshot_ts', width: 170, render: (value: unknown) => String(value ?? '-') },
                {
                  title: '操作',
                  key: 'action',
                  fixed: 'right',
                  width: 120,
                  render: (_: unknown, row: JsonRecord) => (
                    <Button
                      type="link"
                      icon={<SwapOutlined />}
                      onClick={() =>
                        void openFlow(
                          String(row.order_id ?? ''),
                          typeof row.run_id === 'string' && row.run_id
                            ? row.run_id
                            : undefined,
                        )
                      }
                    >
                      出库流向
                    </Button>
                  ),
                },
              ]}
            />
          </>
        )}
      </Space>
      <Modal
        open={flowContext !== null}
        title={`订单出库流向：${flowContext?.orderId ?? ''}`}
        width={960}
        footer={null}
        onCancel={() => setFlowContext(null)}
      >
        {flowError ? (
          <Alert type="error" showIcon message="出库流向加载失败" description={flowError} />
        ) : null}
        {flowLoading ? <Paragraph type="secondary">加载中…</Paragraph> : null}
        {!flowLoading && !flowError && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {flowMaterials.length === 0 ? (
              <Empty description="该订单暂无物料级出库流水（待现场流程配套）" />
            ) : (
              flowMaterials.map((material) => {
                const movements = Array.isArray(material.movements) ? material.movements as JsonRecord[] : [];
                return (
                  <Card
                    key={String(material.material_id ?? '')}
                    size="small"
                    title={
                      <Space>
                        <Text strong>{String(material.material_code ?? '')}</Text>
                        <Text type="secondary">{String(material.material_name ?? '')}</Text>
                        <Tag>{String(material.unit ?? '')}</Tag>
                      </Space>
                    }
                  >
                    <Descriptions size="small" column={3}>
                      <Descriptions.Item label="标准用量">{fmt(material.standard_qty)}</Descriptions.Item>
                      <Descriptions.Item label="领料出库">{fmt(material.issue_qty)}</Descriptions.Item>
                      <Descriptions.Item label="退库">{fmt(material.return_qty)}</Descriptions.Item>
                    </Descriptions>
                    <Table<JsonRecord>
                      rowKey="movement_id"
                      size="small"
                      pagination={false}
                      dataSource={movements}
                      columns={[
                        { title: '流水类型', dataIndex: 'movement_type', width: 100 },
                        {
                          title: '数量',
                          dataIndex: 'quantity',
                          width: 100,
                          align: 'right',
                          render: fmt,
                        },
                        { title: '仓库/库位', dataIndex: 'location_id', width: 140 },
                        { title: '时间', dataIndex: 'occurred_at', width: 180, render: (value: unknown) => String(value ?? '-') },
                        { title: '来源', dataIndex: 'source_module', width: 90 },
                        { title: '流水ID', dataIndex: 'source_event_id', ellipsis: true },
                      ]}
                    />
                  </Card>
                );
              })
            )}
          </Space>
        )}
      </Modal>
    </div>
  );
}

export default WarehouseReconcilePage;
