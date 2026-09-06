import { Input, Progress, Space, Table } from 'antd';
import { useMemo, useState } from 'react';
import { PageState } from '../../components/PageState';
import { StatusTag } from '../../components/StatusTag';
import type { M1RecognitionTask } from '../../types/api';

type M1TaskListProps = {
  loading: boolean;
  error: unknown;
  tasks?: M1RecognitionTask[];
};

export function M1TaskList({ loading, error, tasks }: M1TaskListProps) {
  const [taskIdQuery, setTaskIdQuery] = useState('');
  const visibleTasks = useMemo(() => {
    const query = taskIdQuery.trim().toLocaleLowerCase();
    return query ? tasks?.filter((task) => task.id.toLocaleLowerCase().includes(query)) : tasks;
  }, [taskIdQuery, tasks]);

  return (
    <PageState loading={loading} error={error} empty={tasks?.length === 0}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Input.Search
          allowClear
          aria-label="按任务ID搜索"
          placeholder="输入任务ID"
          value={taskIdQuery}
          onChange={(event) => setTaskIdQuery(event.target.value)}
        />
        <Table
          rowKey="id"
          pagination={false}
          dataSource={visibleTasks}
          locale={{ emptyText: '未找到匹配任务' }}
          columns={[
            { title: '任务', dataIndex: 'id', width: 140 },
            { title: '文件', dataIndex: 'filename' },
            { title: '状态', dataIndex: 'status', width: 120, render: (value: string) => <StatusTag value={value} /> },
            { title: '进度', dataIndex: 'progress', width: 180, render: (value: number) => <Progress percent={value} size="small" /> },
          ]}
        />
      </Space>
    </PageState>
  );
}
