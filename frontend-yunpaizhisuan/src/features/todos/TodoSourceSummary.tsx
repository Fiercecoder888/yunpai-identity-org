import { Col, Progress, Row, Tag, Typography } from 'antd';
import { todoSourceMeta, todoSourceOrder, type TodoSource } from './todoAggregation';

export type TodoSourceProgress = Record<TodoSource, { done: number; total: number }>;

export function TodoSourceSummary({
  sourceCounts,
  sourceProgress,
}: {
  sourceCounts: Record<TodoSource, number>;
  sourceProgress?: TodoSourceProgress;
}) {
  return (
    <Row gutter={[8, 8]}>
      {todoSourceOrder.map((source) => {
        const meta = todoSourceMeta[source];
        const count = sourceCounts[source];
        const progress = sourceProgress?.[source];
        const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
        return (
          <Col span={6} key={source}>
            <div className="todo-source-card">
              <Typography.Text className="todo-source-label" type="secondary">
                {meta.label}
              </Typography.Text>
              <div className="todo-source-count">
                <Tag color={count > 0 ? meta.color : 'default'}>{count}</Tag>
              </div>
              <Typography.Text className="todo-source-desc" type="secondary">
                {meta.description}
              </Typography.Text>
              {progress ? (
                <Progress
                  className="todo-source-progress"
                  percent={percent}
                  size="small"
                  strokeColor={meta.color}
                  showInfo={false}
                />
              ) : null}
            </div>
          </Col>
        );
      })}
    </Row>
  );
}
