import { Button, Input, Progress, Space, Table } from 'antd';
import { useMemo, useState } from 'react';
import { PageState } from '../../components/PageState';
import { StatusTag } from '../../components/StatusTag';
import type { M1ReviewItem } from '../../types/api';

type M1ReviewTableProps = {
  loading: boolean;
  error: unknown;
  items?: M1ReviewItem[];
  selectedId?: string | null;
  onSelect: (item: M1ReviewItem) => void;
};

export function M1ReviewTable({ loading, error, items, selectedId, onSelect }: M1ReviewTableProps) {
  const [taskIdQuery, setTaskIdQuery] = useState('');
  const visibleItems = useMemo(() => {
    const query = taskIdQuery.trim().toLocaleLowerCase();
    return query ? items?.filter((item) => item.taskId.toLocaleLowerCase().includes(query)) : items;
  }, [items, taskIdQuery]);

  return (
    <PageState loading={loading} error={error} empty={items?.length === 0}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Input.Search
          allowClear
          aria-label="按待审核任务ID搜索"
          placeholder="输入待审核任务ID"
          value={taskIdQuery}
          onChange={(event) => setTaskIdQuery(event.target.value)}
        />
        <Table
          rowKey="id"
          pagination={false}
          dataSource={visibleItems}
          locale={{ emptyText: '未找到匹配审核任务' }}
          rowClassName={(item) => (item.id === selectedId ? 'ant-table-row-selected' : '')}
          columns={[
          { title: '字段名', dataIndex: 'field', width: 160 },
          { title: '识别值', dataIndex: 'recognizedValue' },
          {
            title: '置信度',
            dataIndex: 'confidence',
            width: 160,
            render: (value: number) => <Progress percent={Math.round(value * 100)} size="small" status={value < 0.7 ? 'exception' : 'normal'} />,
          },
          { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => <StatusTag value={value === 'confirmed' ? 'completed' : 'need_review'} /> },
          {
            title: '操作',
            width: 130,
            render: (_, item) => (
              <Button size="small" type={item.id === selectedId ? 'primary' : 'default'} onClick={() => onSelect(item)}>
                打开审核
              </Button>
            ),
          },
          ]}
        />
      </Space>
    </PageState>
  );
}
