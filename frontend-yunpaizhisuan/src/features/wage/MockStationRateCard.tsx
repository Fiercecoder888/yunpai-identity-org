import { Alert, Button, Card, Form, InputNumber, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createM0MasterRow } from '../../services/m0Api';
import { fetchPieceRates } from '../../services/pieceWageApi';
import { MOCK_STATIONS, stationDisplayLabel } from '../roles/stationCatalog';

const { Text } = Typography;

const uomOptions = [
  { value: '件', label: '件' },
  { value: '米', label: '米' },
  { value: '公斤', label: '公斤' },
  { value: '套', label: '套' },
];

/**
 * 模拟工位与计件单价（组长页卡片）：
 * - 工位来源：SOP/PMC 工序目录（MOCK_STATIONS），可下拉选择或自由输入
 * - 按工位设置计件单价：订单留空 = 该工位通用单价（所有订单生效）
 *   写入 m0_master_piece_rate（order_id='' → 通用），计件工资即时按新价计算
 */
export function MockStationRateCard() {
  const [form] = Form.useForm<{ station: string | string[]; unit_price: number; uom: string }>();
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const ratesQuery = useQuery({ queryKey: ['piece-rates-all'], queryFn: () => fetchPieceRates({}) });
  const rates = useMemo(() => ratesQuery.data ?? [], [ratesQuery.data]);

  // 通用单价（订单留空 = 按工位生效）按工位汇总展示
  const byStation = useMemo(() => {
    const map = new Map<string, { operationId: string; operationName: string; station: string; unitPrice: number; uom: string }>();
    for (const rate of rates) {
      if (rate.order_id) continue; // 只看通用工位价
      map.set(rate.operation_id || rate.station, {
        operationId: rate.operation_id,
        operationName: '',
        station: rate.station,
        unitPrice: rate.unit_price,
        uom: rate.uom,
      });
    }
    return Array.from(map.values());
  }, [rates]);

  const save = async (values: { station: string | string[]; unit_price: number; uom: string }) => {
    // tags 模式提交值为数组，取首项归一化为字符串
    const rawStation = Array.isArray(values.station) ? (values.station[0] as string | undefined) : values.station;
    const stationName = (rawStation || '').trim();
    if (!stationName) {
      message.warning('请选择或输入工位');
      return;
    }
    if (values.unit_price == null || values.unit_price < 0) {
      message.warning('请输入有效单价');
      return;
    }
    const selected = MOCK_STATIONS.find((s) => s.station === stationName);
    setSaving(true);
    try {
      await createM0MasterRow('m0_master_piece_rate', {
        order_id: '', // 订单留空 = 该工位通用单价
        product_id: '',
        product_name: '',
        operation_id: selected?.operationId ?? '',
        station: stationName,
        unit_price: values.unit_price,
        uom: values.uom || '件',
        effective_from: '',
        source: 'leader-mock-station',
      });
      message.success(`已设置「${stationName}」计件单价 ${values.unit_price} 元/${values.uom || '件'}`);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ['piece-rates-all'] });
      await queryClient.invalidateQueries({ queryKey: ['piece-rates-hint'] });
    } catch (cause) {
      message.error(`设置失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="模拟工位与计件单价" size="small" extra={<Tag color="blue">SOP/PMC 工位目录</Tag>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="按工位设置计件单价"
          description="选择/输入模拟工位（来源 SOP/PMC 工序目录）→ 填单价与单位 → 保存。订单留空即该工位通用单价（所有订单生效）；工人报该工位后工资按此价计算。"
        />
        <Form form={form} layout="inline" onFinish={(values) => void save(values)} style={{ rowGap: 12 }}>
          <Form.Item name="station" label="模拟工位" rules={[{ required: true, message: '选择或输入工位' }]} style={{ minWidth: 280 }}>
            <Select
              showSearch
              mode="tags"
              maxCount={1}
              placeholder="选择或输入工位（押出/绞线/注塑/裁线…）"
              options={MOCK_STATIONS.map((station) => ({
                value: station.station,
                label: stationDisplayLabel(station),
              }))}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.trim().toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="unit_price" label="单价(元)" rules={[{ required: true, message: '填单价' }]}>
            <InputNumber min={0} step={0.01} precision={4} style={{ width: 120 }} placeholder="如 0.15" />
          </Form.Item>
          <Form.Item name="uom" label="单位" initialValue="件">
            <Select style={{ width: 100 }} options={uomOptions} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存单价
            </Button>
          </Form.Item>
        </Form>

        <Table
          size="small"
          rowKey={(row) => row.station}
          loading={ratesQuery.isLoading}
          dataSource={byStation}
          pagination={false}
          locale={{ emptyText: '尚未设置工位通用单价' }}
          columns={[
            { title: '工位', dataIndex: 'station' },
            { title: '工序', dataIndex: 'operationId', render: (v: string) => v || '-' },
            { title: '单价', dataIndex: 'unitPrice', render: (v: number, row) => <Text strong>¥{v} / {row.uom}</Text> },
          ]}
        />
      </Space>
    </Card>
  );
}
