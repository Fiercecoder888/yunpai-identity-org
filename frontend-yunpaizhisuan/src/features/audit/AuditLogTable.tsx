import { Table } from 'antd';
import { StatusTag } from '../../components/StatusTag';
import type { AuditLogItem } from '../../types/api';

type AuditLogTableProps = {
  logs?: AuditLogItem[];
};

export function AuditLogTable({ logs }: AuditLogTableProps) {
  return (
    <Table
      rowKey="id"
      pagination={false}
      scroll={{ x: 'max-content' }}
      dataSource={logs}
      columns={[
        { title: '时间', dataIndex: 'time', width: 180 },
        { title: '操作人', dataIndex: 'actor', width: 140 },
        { title: '动作', dataIndex: 'action', width: 180 },
        { title: '模块', dataIndex: 'module', width: 100 },
        { title: '对象', dataIndex: 'targetId', width: 140 },
        { title: '结果', dataIndex: 'result', width: 120, render: (value: string) => <StatusTag value={value} /> },
        { title: '详情', dataIndex: 'detail' },
      ]}
    />
  );
}
