import { Alert, Button, Card, Empty, Space, Spin, Tag, Timeline, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getWorkbenchActivities, type WorkbenchActivity } from '../../services/activityApi';
import { relativeTime } from '../../utils/relativeTime';

export const workbenchActivityQueryKey = ['workbench', 'activities'] as const;

const activityColor = (status: WorkbenchActivity['status']): string => {
  switch (status) {
    case 'success':
      return 'green';
    case 'warning':
      return 'orange';
    case 'error':
      return 'red';
    default:
      return 'blue';
  }
};

const activityLabel = (status: WorkbenchActivity['status']): string => {
  switch (status) {
    case 'success':
      return '成功';
    case 'warning':
      return '关注';
    case 'error':
      return '失败';
    default:
      return '信息';
  }
};

export function ActivityTimeline() {
  const query = useQuery({
    queryKey: workbenchActivityQueryKey,
    queryFn: () => getWorkbenchActivities({ limit: 20 }),
    staleTime: 30_000,
  });

  const now = useMemo(() => Date.now(), []);

  return (
    <Card
      title="最近动态"
      extra={
        <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
          刷新
        </Button>
      }
      className="activity-timeline-card"
    >
      {query.isLoading ? (
        <Space className="page-stack" direction="vertical" align="center">
          <Spin />
        </Space>
      ) : null}

      {query.isError ? (
        <Alert type="warning" showIcon message="动态时间流加载失败" description="请检查 mock 场景或后端接口状态。" />
      ) : null}

      {!query.isLoading && !query.isError && (query.data?.length ?? 0) === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />
      ) : (
        <Timeline
          className="activity-timeline"
          items={(query.data ?? []).map((activity) => ({
            color: activityColor(activity.status),
            children: (
              <div className="activity-item">
                <div className="activity-item-head">
                  <Tag color={activityColor(activity.status)}>{activityLabel(activity.status)}</Tag>
                  <Typography.Text strong>{activity.module}</Typography.Text>
                  <Typography.Text type="secondary" className="activity-item-time">
                    {relativeTime(activity.time, now)}
                  </Typography.Text>
                </div>
                <div className="activity-item-message">
                  <Typography.Text>{activity.message}</Typography.Text>
                </div>
              </div>
            ),
          }))}
        />
      )}
    </Card>
  );
}
