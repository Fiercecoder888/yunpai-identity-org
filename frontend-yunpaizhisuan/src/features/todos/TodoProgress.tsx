import { Progress, Space, Typography } from 'antd';

export type TodoProgressProps = {
  done: number;
  total: number;
};

export function TodoProgress({ done, total }: TodoProgressProps) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="todo-progress" data-testid="todo-progress">
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Progress
          percent={percent}
          size="small"
          status={total > 0 && done >= total ? 'success' : 'normal'}
          strokeColor={total > 0 && done >= total ? '#16a34a' : undefined}
        />
        <Typography.Text type="secondary" className="todo-progress-text">
          已完成 {done} / {total}
        </Typography.Text>
      </Space>
    </div>
  );
}
