import { Progress, Space, Tag, Typography } from 'antd';
import { useM1BatchProgress } from './useM1BatchProgress';

export type M1TaskProgressListProps = {
  parentId?: string;
  enabled?: boolean;
};

export function M1TaskProgressList({ parentId, enabled = true }: M1TaskProgressListProps) {
  const query = useM1BatchProgress(parentId, enabled);
  const summary = query.data?.summary;

  if (!query.isEnabled || !summary || summary.total === 0) {
    return null;
  }

  const statusLabel = query.isError
    ? '进度回显暂不可用'
    : summary.failed > 0
      ? `${summary.failed} 个失败 · ${summary.done} 个完成`
      : summary.total === summary.done
        ? '批量任务全部完成'
        : `${summary.done}/${summary.total} 个任务完成`;

  return (
    <div className="m1-batch-progress" aria-label={`M1 批量识别进度 ${summary.percent}%`}>
      <Space size={8}>
        <Typography.Text strong>批量识别进度</Typography.Text>
        <Tag color={summary.failed > 0 ? 'error' : summary.percent >= 100 ? 'success' : 'processing'}>
          {statusLabel}
        </Tag>
      </Space>
      <Progress percent={summary.percent} size="small" status={query.isError ? 'exception' : summary.failed > 0 ? 'exception' : 'active'} />
    </div>
  );
}
