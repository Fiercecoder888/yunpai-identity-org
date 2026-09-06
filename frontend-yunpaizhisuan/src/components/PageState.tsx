import { Button, Empty, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

type PageStateProps = {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyDescription?: string;
  onRetry?: () => void;
  children: ReactNode;
};

export function PageState({ loading, error, empty, emptyDescription, onRetry, children }: PageStateProps) {
  if (loading) {
    return <Skeleton active paragraph={{ rows: 5 }} />;
  }

  if (error) {
    return (
      <div className="page-state-error" role="alert">
        <ReloadOutlined className="page-state-error-icon" />
        <div className="page-state-error-title">数据加载失败</div>
        <div className="page-state-error-description">数据服务暂时不可用，请稍后重试或检查网络连接。</div>
        {onRetry ? (
          <Button icon={<ReloadOutlined />} onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </div>
    );
  }

  if (empty) {
    return <Empty description={emptyDescription ?? '暂无数据'} />;
  }

  return children;
}
