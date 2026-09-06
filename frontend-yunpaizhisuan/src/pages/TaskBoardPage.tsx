import { Button, Card, Checkbox, Input, Segmented, Select, Space, Table, Tooltip, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeading } from '../components/PageHeading';
import { PageState } from '../components/PageState';
import { RiskStatusTag } from '../components/RiskStatusTag';
import { formatDateOrPlaceholder } from '../components/taskKanban/formatDateOrPlaceholder';
import { groupTasksBy } from '../components/taskKanban/groupTasksBy';
import { KanbanBoard, TASK_DISPATCH_UNAVAILABLE_MESSAGE } from '../components/taskKanban/KanbanBoard';
import { TaskBoardStatsRow } from '../components/taskKanban/TaskBoardStatsRow';
import { getTasks } from '../services/taskApi';

type TaskBoardView = 'kanban' | 'table';

const taskBoardCurrentUserStorageKey = 'yunpai-taskboard-current-user';
const defaultTaskBoardUser = '工艺员';

const getTaskBoardCurrentUser = () => {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(taskBoardCurrentUserStorageKey);
    if (stored) {
      return stored;
    }
  }
  return defaultTaskBoardUser;
};

export function TaskBoardPage() {
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [view, setView] = useState<TaskBoardView>('kanban');
  const [onlyMine, setOnlyMine] = useState(false);
  const currentUser = useMemo(() => getTaskBoardCurrentUser(), []);
  const query = useQuery({ queryKey: ['tasks'], queryFn: getTasks });

  const dataSource = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return (query.data ?? []).filter((task) => {
      const riskMatches = riskFilter === 'all' || task.riskLevel === riskFilter;
      const keywordMatches =
        !needle ||
        task.title.toLowerCase().includes(needle) ||
        task.owner.toLowerCase().includes(needle);
      const mineMatches = !onlyMine || task.owner === currentUser;
      return riskMatches && keywordMatches && mineMatches;
    });
  }, [query.data, riskFilter, keyword, onlyMine, currentUser]);

  const groups = useMemo(() => groupTasksBy(dataSource, 'status'), [dataSource]);

  return (
    <div className="page-stack">
      <PageHeading path="/tasks" description="" />
      <Card
        title="任务看板"
      extra={
        <Space wrap>
          <Input
            aria-label="任务搜索"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索任务或负责人"
            style={{ width: 220 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Select
            aria-label="风险筛选"
            value={riskFilter}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部风险' },
              { value: 'high', label: '高风险' },
              { value: 'medium', label: '中风险' },
              { value: 'low', label: '低风险' },
            ]}
            onChange={setRiskFilter}
          />
          <Checkbox checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)}>
            我的任务
          </Checkbox>
          <Segmented
            value={view}
            options={[
              { label: '看板', value: 'kanban' },
              { label: '表格', value: 'table' },
            ]}
            onChange={(value) => setView(value as TaskBoardView)}
          />
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">任务列表、状态、负责人和风险等级。</Typography.Paragraph>
      <TaskBoardStatsRow tasks={query.data ?? []} currentUser={currentUser} />
      <PageState loading={query.isLoading} error={query.error} empty={dataSource.length === 0} onRetry={() => void query.refetch()}>
        {view === 'kanban' ? (
          <KanbanBoard groups={groups} currentUser={currentUser} />
        ) : (
          <Table
            rowKey="id"
            dataSource={dataSource}
            pagination={false}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: '任务', dataIndex: 'title' },
              { title: '负责人', dataIndex: 'owner', width: 120 },
              {
                title: '风险 / 状态',
                key: 'risk-status',
                width: 180,
                render: (_value, task) => <RiskStatusTag risk={task.riskLevel} status={task.status} />,
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 190,
                render: (value: string | undefined) => <Space>{formatDateOrPlaceholder(value)}</Space>,
              },
              {
                title: '操作',
                key: 'actions',
                width: 100,
                render: () => (
                  <Tooltip title={TASK_DISPATCH_UNAVAILABLE_MESSAGE}>
                    <span>
                      <Button size="small" disabled autoInsertSpace={false}>
                        分派
                      </Button>
                    </span>
                  </Tooltip>
                ),
              },
            ]}
          />
        )}
      </PageState>
      </Card>
    </div>
  );
}
