import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Empty, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

import { isMswDemoMode } from '../app/runtimeMode';
import { getQcDashboard, type QcDashboard, type QcSourceStatus } from '../services/qcApi';

const { Title, Paragraph } = Typography;

const sourceColor: Record<string, string> = {
  ok: 'green',
  idle: 'default',
  reserved: 'blue',
};

export function QcDashboardPage() {
  const demoMode = isMswDemoMode();
  const [dashboard, setDashboard] = useState<QcDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setDashboard(await getQcDashboard());
    } catch (err) {
      setError(String(err));
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!demoMode) {
      void load();
    }
  }, [demoMode]);

  const recentEvents = useMemo(
    () => (Array.isArray(dashboard?.recent_events) ? dashboard.recent_events : []),
    [dashboard],
  );

  const sourceRows: QcSourceStatus[] = Array.isArray(dashboard?.sources)
    ? dashboard.sources
    : [];

  const columns = [
    { title: '时间', dataIndex: 'ts', render: (value: unknown) => String(value ?? '-') },
    { title: '数据源', dataIndex: 'source', render: (value: unknown) => <Tag>{String(value ?? '-')}</Tag> },
    { title: '机器', dataIndex: 'machine_code', render: (value: unknown) => String(value ?? '-') },
    { title: 'CNC 程序', dataIndex: 'program_id', render: (value: unknown) => String(value ?? '-') },
    { title: '订单', dataIndex: 'order_id', render: (value: unknown) => String(value ?? '-') },
    { title: '工位', dataIndex: 'station', render: (value: unknown) => String(value ?? '-') },
  ];

  return (
    <div className="qc-dashboard-page" data-testid="qc-dashboard-page">
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Title level={3}>品控数据链路看板（阶段 1）</Title>
          <Paragraph type="secondary">
            采集 → 存储 → 回放数据链路概览；预警与模型为阶段 2/3 占位。
          </Paragraph>
        </div>
        <Row gutter={16}>
          <Col span={6}>
            <Card>
              <Statistic title="工艺参数事件" value={dashboard?.telemetry_total ?? 0} loading={loading} />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic title="检验记录" value={dashboard?.quality_total ?? 0} loading={loading} />
            </Card>
          </Col>
          <Col span={12}>
            <Card title="数据源状态">
              <Space wrap>
                {sourceRows.map((item) => (
                  <Tag key={item.source} color={sourceColor[item.status] ?? 'default'}>
                    {item.label}：{item.count}
                  </Tag>
                ))}
                {sourceRows.length === 0 && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
              </Space>
            </Card>
          </Col>
        </Row>
        <Card
          title="最近事件"
          extra={
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
              刷新
            </Button>
          }
        >
          <Table
            rowKey={(record) => String(record.event_id ?? '')}
            columns={columns}
            dataSource={recentEvents}
            size="small"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: error ? `加载失败：${error}` : '暂无采集数据' }}
          />
        </Card>
      </Space>
    </div>
  );
}
