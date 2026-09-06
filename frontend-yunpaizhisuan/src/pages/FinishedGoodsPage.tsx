import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Descriptions,
  Empty,
  InputNumber,
  message,
  Modal,
  Space,
  Table,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { JsonDebugCollapse, StructuredSection } from '../components/StructuredJson';
import {
  getBusinessFinishedGoods,
  inspectFinishedGoods,
  type JsonRecord,
} from '../services/businessTraceApi';
import { isMswDemoMode } from '../app/runtimeMode';


const { Title, Paragraph } = Typography;


export function FinishedGoodsPage() {
  const demoMode = isMswDemoMode();
  const [report, setReport] = useState<JsonRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inspectingItem, setInspectingItem] = useState<JsonRecord | null>(null);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [scrapItem, setScrapItem] = useState<JsonRecord | null>(null);
  const [scrapQty, setScrapQty] = useState<number | null>(0);
  const [scrapBusy, setScrapBusy] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await getBusinessFinishedGoods());
    } catch (err) {
      setError(String(err));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!demoMode) {
      void load();
    }
  }, [demoMode]);

  const items = useMemo(
    () => (Array.isArray(report?.items) ? report.items as JsonRecord[] : []),
    [report],
  );

  const summary = useMemo(() => {
    const totals = (report?.totals as JsonRecord | undefined) ?? {};
    return {
      itemCount: items.length,
      producedTotal: items.reduce((sum, item) => sum + Number(item.produced_total ?? 0), 0),
      goodTotal: items.reduce((sum, item) => sum + Number(item.good_total ?? 0), 0),
      defectTotal: items.reduce((sum, item) => sum + Number(item.defect_total ?? 0), 0),
      quantityOnHand: items.reduce(
        (sum, item) => sum + Number((item.balance as JsonRecord | undefined)?.quantity_on_hand ?? 0),
        0,
      ),
      totals,
    };
  }, [items, report]);

  const columns = [
    { title: '物料编码', dataIndex: 'material_code' },
    { title: '名称', dataIndex: 'name' },
    { title: '单位', dataIndex: 'unit' },
    {
      title: '现存',
      dataIndex: ['balance', 'quantity_on_hand'],
      render: (value: unknown) => String(value ?? '-'),
    },
    {
      title: '可用',
      dataIndex: ['balance', 'quantity_available'],
      render: (value: unknown) => String(value ?? '-'),
    },
    {
      title: '待检/冻结',
      dataIndex: ['balance', 'quantity_blocked'],
      render: (value: unknown) => String(value ?? '-'),
    },
    { title: '累计产出', dataIndex: 'produced_total' },
    { title: '报废', dataIndex: 'defect_total' },
    { title: '良品', dataIndex: 'good_total' },
    {
      title: '良率',
      dataIndex: 'yield_rate',
      render: (value: unknown) => (value === null || value === undefined ? '-' : `${Number(value) * 100}%`),
    },
    {
      title: '批次',
      dataIndex: 'lots',
      render: (value: unknown) => (Array.isArray(value) ? value.join('、') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, row: JsonRecord) => (
        <Space size={4}>
          {Number((row.balance as JsonRecord | undefined)?.quantity_blocked ?? 0) > 0 ? (
            <>
              <Button type="link" onClick={() => setInspectingItem(row)}>
                检验放行
              </Button>
              <Button
                type="link"
                danger
                onClick={() => {
                  setScrapItem(row);
                  setScrapQty(Number((row.balance as JsonRecord | undefined)?.quantity_blocked ?? 0));
                }}
              >
                检验不合格
              </Button>
            </>
          ) : null}
          <Button
            type="link"
            onClick={() => navigate(`/modules/trace-workbench?material=${encodeURIComponent(String(row.material_id))}`)}
          >
            查看物料追溯
          </Button>
        </Space>
      ),
    },
  ];

  const confirmInspection = async () => {
    if (!inspectingItem) {
      return;
    }
    const blocked = Number((inspectingItem.balance as JsonRecord | undefined)?.quantity_blocked ?? 0);
    setInspectBusy(true);
    try {
      await inspectFinishedGoods({
        materialId: String(inspectingItem.material_id),
        orderId: String(inspectingItem.order_id ?? ''),
        quantity: blocked,
        result: 'pass',
      });
      void message.success(`检验放行成功：${String(inspectingItem.name)} ${blocked} 转可用`);
      setInspectingItem(null);
      await load();
    } catch (err) {
      void message.error(`检验放行失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setInspectBusy(false);
    }
  };

  const confirmScrap = async () => {
    if (!scrapItem) {
      return;
    }
    const quantity = Number(scrapQty ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      void message.warning('请输入有效的报废数量');
      return;
    }
    setScrapBusy(true);
    try {
      await inspectFinishedGoods({
        materialId: String(scrapItem.material_id),
        orderId: String(scrapItem.order_id ?? ''),
        quantity,
        result: 'fail',
      });
      void message.success(`检验不合格已报废：${String(scrapItem.name)} ${quantity}`);
      setScrapItem(null);
      await load();
    } catch (err) {
      void message.error(`报废失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScrapBusy(false);
    }
  };

  if (demoMode) {
    return (
      <div className="page-stack" style={{ padding: 24 }}>
        <Title level={3}>成品库</Title>
        <Paragraph type="secondary">
          完工产出先进待检，检验合格后才进入可用量；这里汇总成品库现存/可用/待检与累计产出、报废、良率。
        </Paragraph>
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="成品库汇总（Demo 模式空态样例）：真实模式连接统一事实账本后展示现存/可用/待检与良率。"
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>成品库</Title>
      <Paragraph type="secondary">
        完工产出先进待检，检验合格后才进入可用量；这里汇总成品库现存/可用/待检与累计产出、报废、良率。
      </Paragraph>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Button loading={loading} icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
        {error ? (
          <div className="page-state-error" role="alert">
            <ReloadOutlined className="page-state-error-icon" />
            <div className="page-state-error-title">数据加载失败</div>
            <div className="page-state-error-description">成品库数据服务暂时不可用，请稍后重试或检查网络连接。</div>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>重试</Button>
          </div>
        ) : null}
        {report && (
          <>
            <Card size="small" title="成品库汇总">
              <Descriptions size="small" column={3} bordered>
                <Descriptions.Item label="物料种类">{summary.itemCount}</Descriptions.Item>
                <Descriptions.Item label="现存总量">{summary.quantityOnHand}</Descriptions.Item>
                <Descriptions.Item label="累计产出">{summary.producedTotal}</Descriptions.Item>
                <Descriptions.Item label="良品合计">{summary.goodTotal}</Descriptions.Item>
                <Descriptions.Item label="报废合计">{summary.defectTotal}</Descriptions.Item>
                <Descriptions.Item label="加权良率">
                  {summary.producedTotal > 0
                    ? `${((summary.goodTotal / summary.producedTotal) * 100).toFixed(1)}%`
                    : '-'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
            <Table
              rowKey="material_id"
              size="small"
              columns={columns}
              dataSource={items}
              pagination={false}
              scroll={{ x: 'max-content' }}
              expandable={{
                expandedRowRender: (row) => (
                  <StructuredSection title={`${String(row.material_code ?? row.material_id)} 工序良率明细`} data={row.yield_summary} />
                ),
              }}
            />
            {Object.keys(summary.totals).length > 0 ? (
              <StructuredSection title="汇总字段" data={summary.totals} />
            ) : null}
            <JsonDebugCollapse title="成品库原始响应" data={report} />
          </>
        )}
      </Space>
      <Modal
        open={inspectingItem !== null}
        title="检验放行"
        onOk={() => void confirmInspection()}
        onCancel={() => setInspectingItem(null)}
        okText="放行"
        cancelText="取消"
        confirmLoading={inspectBusy}
      >
        {inspectingItem ? (
          <Typography.Paragraph>
            将 <b>{String(inspectingItem.name)}</b> 的待检数量{' '}
            <b>{String((inspectingItem.balance as JsonRecord | undefined)?.quantity_blocked ?? '0')}</b>{' '}
            检验合格并转入可用量？
          </Typography.Paragraph>
        ) : null}
      </Modal>
      <Modal
        open={scrapItem !== null}
        title="检验不合格（报废）"
        onOk={() => void confirmScrap()}
        onCancel={() => setScrapItem(null)}
        okText="报废"
        cancelText="取消"
        confirmLoading={scrapBusy}
      >
        {scrapItem ? (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Typography.Paragraph>
              将 <b>{String(scrapItem.name)}</b> 的不合格数量报废销账（从待检与现存中扣除）？
            </Typography.Paragraph>
            <InputNumber
              aria-label="报废数量"
              min={1}
              max={Number((scrapItem.balance as JsonRecord | undefined)?.quantity_blocked ?? 0)}
              value={scrapQty}
              onChange={(value) => setScrapQty(value)}
              style={{ width: 200 }}
            />
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
