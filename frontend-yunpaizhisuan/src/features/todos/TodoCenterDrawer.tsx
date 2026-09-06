import {
  Alert,
  Button,
  Drawer,
  Empty,
  List,
  Segmented,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentRole } from '../roles/useCurrentRole';
import { useTodoCenter } from './useTodoCenter';
import { todoSourceMeta, todoSourceProgress, type TodoItem } from './todoAggregation';
import { TodoProgress } from './TodoProgress';
import { TodoSourceSummary } from './TodoSourceSummary';
import { sortTodos, type TodoSortMode } from './todoSorting';
import { useTodoDismissStore } from './useTodoDismissStore';

const summaryTitleBySource = (group: { label: string; count: number }): string => `${group.label} ${group.count} 项`;

export function TodoCenterDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const roleQuery = useCurrentRole();
  const todo = useTodoCenter(roleQuery.data?.permissions);
  const dismissed = useTodoDismissStore((state) => state.dismissed);
  const dismiss = useTodoDismissStore((state) => state.dismiss);
  const undismiss = useTodoDismissStore((state) => state.undismiss);

  const [sortMode, setSortMode] = useState<TodoSortMode>('severity');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);
  const summaryBySource = useMemo(() => new Map(todo.items.map((item) => [item.source, item])), [todo.items]);

  const visibleGroups = useMemo(
    () =>
      todo.groups
        .map((group) => ({
          ...group,
          items: sortTodos(
            group.items.filter((item) => showDismissed || !dismissedSet.has(item.id)),
            sortMode,
          ),
        }))
        .filter((group) => group.items.length > 0 || showDismissed),
    [todo.groups, dismissedSet, showDismissed, sortMode],
  );

  const doneCount = todo.detailItems.filter((item) => dismissedSet.has(item.id)).length;
  const sourceProgress = useMemo(
    () => todoSourceProgress(todo.detailItems, (id) => dismissedSet.has(id)),
    [todo.detailItems, dismissedSet],
  );

  const openLink = (item: TodoItem) => {
    onClose();
    navigate(item.action?.link ?? item.link);
    void queryClient.invalidateQueries({ queryKey: ['todo'] });
  };

  const renderItem = (item: TodoItem) => {
    const isExpanded = expandedId === item.id;
    const isDismissedItem = dismissedSet.has(item.id);
    return (
      <List.Item
        className={isDismissedItem ? 'todo-row is-dismissed' : 'todo-row'}
        actions={[
          <Button
            key="dismiss"
            type="link"
            size="small"
            onClick={() => (isDismissedItem ? undismiss(item.id) : dismiss(item.id))}
          >
            {isDismissedItem ? '恢复' : '忽略'}
          </Button>,
          <Button key="go" type="link" size="small" onClick={() => openLink(item)}>
            去处理
          </Button>,
        ]}
      >
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Button
            type="text"
            size="small"
            className="todo-row-expand"
            aria-expanded={isExpanded}
            onClick={() => setExpandedId(isExpanded ? null : item.id)}
          >
            <Space size={8}>
              {isExpanded ? <DownOutlined /> : <RightOutlined />}
              <Tag color={item.severity === 'high' ? 'red' : item.severity === 'medium' ? 'gold' : 'blue'}>
                {item.severity === 'high' ? '高' : item.severity === 'medium' ? '中' : '低'}
              </Tag>
              {isDismissedItem ? <Tag color="default">已忽略</Tag> : null}
              <Typography.Text delete={isDismissedItem}>{item.title}</Typography.Text>
            </Space>
          </Button>
          <div className="todo-row-detail">
            <Typography.Text type="secondary">{item.detail}</Typography.Text>
          </div>
          {isExpanded && item.preview ? (
            <div className="todo-row-preview">
              <Typography.Text strong>{item.preview.summary}</Typography.Text>
              {(item.preview.lines ?? []).map((line) => (
                <Typography.Text key={line} type="secondary">
                  {line}
                </Typography.Text>
              ))}
            </div>
          ) : null}
          <Typography.Text type="secondary" className="todo-row-source">
            来源：{todoSourceMeta[item.source].label}
          </Typography.Text>
        </Space>
      </List.Item>
    );
  };

  return (
    <Drawer title="我的待办" open={open} onClose={onClose} width={560}>
      <Space direction="vertical" size={16} className="page-stack">
        {todo.error ? (
          <Alert type="warning" showIcon message="部分待办数据源加载失败" description="请检查 mock 场景或后端接口状态。" />
        ) : null}
        <Space wrap>
          <Segmented
            size="small"
            value={sortMode}
            options={[
              { label: '优先级', value: 'severity' },
              { label: '截止', value: 'dueAt' },
              { label: '来源', value: 'source' },
            ]}
            onChange={(value) => setSortMode(value as TodoSortMode)}
          />
          <Switch
            size="small"
            checked={showDismissed}
            onChange={setShowDismissed}
            checkedChildren="显示已忽略"
            unCheckedChildren="隐藏已忽略"
          />
        </Space>
        <TodoProgress done={doneCount} total={todo.detailItems.length} />
        <TodoSourceSummary sourceCounts={todo.sourceCounts} sourceProgress={sourceProgress} />

        {todo.loading ? (
          <Space className="page-stack" direction="vertical" align="center">
            <Spin />
          </Space>
        ) : null}

        {!todo.loading && todo.detailItems.length === 0 ? (
          <Empty description="暂无待办" />
        ) : (
          visibleGroups.map((group) => (
            <div key={group.source} className="todo-group">
              <Typography.Text strong className="todo-group-title">
                {summaryBySource.get(group.source)?.title ?? summaryTitleBySource(group)}
              </Typography.Text>
              {group.items.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="已全部忽略" />
              ) : (
                <List dataSource={group.items} renderItem={renderItem} />
              )}
            </div>
          ))
        )}
      </Space>
    </Drawer>
  );
}
