import { Card, Col, Row, Statistic } from 'antd';
import type { TaskItem } from '../../types/api';

type TaskBoardStatsRowProps = {
  tasks: TaskItem[];
  currentUser?: string;
};

const countBy = (tasks: TaskItem[], predicate: (task: TaskItem) => boolean) => tasks.filter(predicate).length;

export function TaskBoardStatsRow({ tasks, currentUser }: TaskBoardStatsRowProps) {
  const pendingReview = countBy(tasks, (task) => task.status === 'need_review');
  const highRisk = countBy(tasks, (task) => task.riskLevel === 'high');
  const mine = currentUser ? countBy(tasks, (task) => task.owner === currentUser) : 0;

  return (
    <Row gutter={[16, 16]} data-testid="task-board-stats-row">
      <Col xs={12} md={6}>
        <Card size="small">
          <Statistic title="任务总数" value={tasks.length} />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small">
          <Statistic title="待审核" value={pendingReview} />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small">
          <Statistic title="高风险" value={highRisk} />
        </Card>
      </Col>
      <Col xs={12} md={6}>
        <Card size="small">
          <Statistic title="我的任务" value={mine} />
        </Card>
      </Col>
    </Row>
  );
}
