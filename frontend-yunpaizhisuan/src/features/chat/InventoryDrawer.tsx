import { DatabaseOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Drawer, Input, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listM0Inventory,
  type M0InventoryRow,
} from '../../services/m0Api';

const PAGE_SIZE = 200;

const warehouseTagColor = (warehouse?: string) => {
  const w = warehouse ?? '';
  if (w.includes('材料')) return 'blue';
  if (w.includes('成品')) return 'green';
  if (w.includes('线材')) return 'purple';
  if (w.includes('数据')) return 'orange';
  return 'default';
};

const columns: ColumnsType<M0InventoryRow> = [
  { title: '物料编码', dataIndex: 'material_code', width: 140, ellipsis: true },
  { title: '物料名称', dataIndex: 'material_name', ellipsis: true },
  { title: '数量', dataIndex: 'qty', width: 90, align: 'right', sorter: (a, b) => (Number(a.qty) || 0) - (Number(b.qty) || 0) },
  { title: '单位', dataIndex: 'uom', width: 70 },
  { title: '规格', dataIndex: 'spec', width: 110, ellipsis: true },
  {
    title: '仓库',
    dataIndex: 'warehouse',
    width: 110,
    render: (v: string) => (v ? <Tag color={warehouseTagColor(v)}>{v}</Tag> : ''),
  },
];

export function InventoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<M0InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loadedAll, setLoadedAll] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (targetPage: number, code: string) => {
    const normalizedCode = code.trim();
    setLoading(true);
    setError('');
    try {
      const offset = (targetPage - 1) * PAGE_SIZE;
      const { items: rows } = await listM0Inventory(PAGE_SIZE, offset, normalizedCode);
      if (rows.length < PAGE_SIZE) {
        setLoadedAll(true);
      } else {
        setLoadedAll(false);
      }
      setItems(rows);
      setPage(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      message.error(`库存数据加载失败：${errorText(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setKeyword('');
      setSearchInput('');
      void load(1, '');
    }
  }, [load, open]);

  const handleSearch = () => {
    const nextKeyword = searchInput.trim();
    setKeyword(nextKeyword);
    setLoadedAll(false);
    void load(1, nextKeyword);
  };

  const handleRefresh = () => {
    setLoadedAll(false);
    void load(1, keyword);
  };

  const stats = useMemo(() => {
    const totalQty = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
    const warehouses = new Map<string, number>();
    for (const it of items) {
      const w = it.warehouse || it.warehouse_code || '未分仓';
      warehouses.set(w, (warehouses.get(w) || 0) + 1);
    }
    return { totalQty, warehouseList: Array.from(warehouses.entries()).sort((a, b) => b[1] - a[1]) };
  }, [items]);

  return (
    <Drawer
      title={
        <Space>
          <DatabaseOutlined />
          <span>物料库存总览（m0 已入库）</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当前页 {items.length} 行，共加载至第 {page} 页（每页 {PAGE_SIZE} 行）
            {loadedAll ? '，已到最后一页' : ''}
          </Typography.Text>
        </Space>
      }
      width={860}
      open={open}
      onClose={onClose}
      extra={
        <Space>
          <Input
            allowClear
            placeholder="按物料编码过滤"
            prefix={<SearchOutlined />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 180 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            刷新
          </Button>
        </Space>
      }
    >
      {error ? (
        <Typography.Text type="danger">{error}</Typography.Text>
      ) : (
        <Spin spinning={loading}>
          <div style={{ marginBottom: 12 }}>
            <Space size={16} wrap>
              <span>
                当前页数量合计：<b>{stats.totalQty.toLocaleString()}</b>
              </span>
              {stats.warehouseList.slice(0, 6).map(([w, n]) => (
                <Tag key={w} color={warehouseTagColor(w)}>
                  {w}: {n}
                </Tag>
              ))}
            </Space>
          </div>
          <Table<M0InventoryRow>
            rowKey={(row) => `${row.id ?? row.material_code ?? ''}-${row.batch_id ?? ''}`}
            columns={columns}
            dataSource={items}
            size="small"
            loading={loading}
            scroll={{ y: 'calc(100vh - 260px)' }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: loadedAll ? page * PAGE_SIZE : page * PAGE_SIZE + 1,
              showSizeChanger: false,
              onChange: (next) => void load(next, keyword),
              showTotal: (t) => `已加载 ${t} 行${loadedAll ? '' : '（继续翻页加载）'}`,
            }}
          />
        </Spin>
      )}
    </Drawer>
  );
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
