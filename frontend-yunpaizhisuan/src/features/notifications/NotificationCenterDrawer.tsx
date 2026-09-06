import { Alert, Button, Drawer, Empty, List, Space, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentRole } from '../roles/useCurrentRole';
import { useTodoCenter } from '../todos/useTodoCenter';
import { bridgeTodoItems } from './todoBridge';
import { useNotificationStore, type AppNotification } from './useNotificationStore';

const severityMeta: Record<AppNotification['severity'], { label: string; color: string }> = {
  high: { label: '高', color: 'red' },
  medium: { label: '中', color: 'gold' },
  low: { label: '低', color: 'blue' },
  info: { label: '信息', color: 'default' },
};

const formatTime = (value: string) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
};

export function NotificationCenterDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const items = useNotificationStore((state) => state.items);
  const readIds = useNotificationStore((state) => state.readIds);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const transport = useNotificationStore((state) => state.transport);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const mergeItems = useNotificationStore((state) => state.mergeItems);
  const roleQuery = useCurrentRole();
  const todo = useTodoCenter(roleQuery.data?.permissions);

  useEffect(() => {
    mergeItems(bridgeTodoItems(todo.items));
  }, [mergeItems, todo.items]);

  const visible = tab === 'unread' ? items.filter((item) => !readIds.has(item.id)) : items;

  const openNotification = (item: AppNotification) => {
    markRead(item.id);
    onClose();
    if (item.link) {
      navigate(item.link);
    }
  };

  return (
    <Drawer
      title="通知中心"
      open={open}
      onClose={onClose}
      width={460}
      extra={
        unreadCount > 0 ? (
          <Button type="link" size="small" onClick={markAllRead}>
            全部已读
          </Button>
        ) : null
      }
    >
      <Space direction="vertical" size={12} className="page-stack" data-testid="notification-center">
        <Alert
          type="info"
          showIcon
          message={`通知传输：${transport === 'sse' ? 'SSE 实时' : '轮询'}${transport === 'sse' ? '' : '（demo）'}`}
          description="未读通知按读取状态在本地持久化；SSE 实时推送待真实后端交付。"
        />
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'unread' | 'all')}
          items={[
            { key: 'unread', label: `未读${unreadCount > 0 ? `（${unreadCount}）` : ''}` },
            { key: 'all', label: '全部' },
          ]}
        />
        {visible.length === 0 ? (
          <Empty description="暂无通知" />
        ) : (
          <List
            dataSource={visible}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button key="read" type="link" size="small" onClick={() => markRead(item.id)}>
                    {readIds.has(item.id) ? '已读' : '标记已读'}
                  </Button>,
                  item.link ? (
                    <Button key="go" type="link" size="small" onClick={() => openNotification(item)}>
                      去查看
                    </Button>
                  ) : null,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={8}>
                      <Tag color={severityMeta[item.severity].color}>{severityMeta[item.severity].label}</Tag>
                      <span>{item.title}</span>
                    </Space>
                  }
                  description={
                    <Space direction="vertical" size={4}>
                      {item.detail ? <span>{item.detail}</span> : null}
                      <Typography.Text type="secondary">
                        {formatTime(item.createdAt)} · 来源：{item.source}
                      </Typography.Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Space>
    </Drawer>
  );
}
