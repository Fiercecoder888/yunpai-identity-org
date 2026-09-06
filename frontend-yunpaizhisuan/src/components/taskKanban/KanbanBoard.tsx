import { Button, Empty, Tooltip } from 'antd';
import { RiskStatusTag } from '../RiskStatusTag';
import { formatDateOrPlaceholder } from './formatDateOrPlaceholder';
import type { TaskGroup } from './groupTasksBy';

export const TASK_DISPATCH_UNAVAILABLE_MESSAGE = '任务分派后端未交付，演示环境暂不可用';

type KanbanBoardProps = {
  groups: TaskGroup[];
  currentUser?: string;
};

export function KanbanBoard({ groups, currentUser }: KanbanBoardProps) {
  if (groups.every((group) => group.tasks.length === 0)) {
    return <Empty description="暂无任务" data-testid="task-kanban-empty" />;
  }

  return (
    <div className="task-kanban" data-testid="task-kanban">
      {groups.map((group) => (
        <section key={group.key} className="task-kanban-column" data-testid={`task-kanban-column-${group.key}`}>
          <header className="task-kanban-column-header">
            <span className="task-kanban-column-title">{`${group.label} (${group.tasks.length})`}</span>
          </header>
          <div className="task-kanban-column-body">
            {group.tasks.length === 0 ? (
              <div className="task-kanban-column-empty">暂无任务</div>
            ) : (
              group.tasks.map((task) => {
                const isMine = Boolean(currentUser && task.owner === currentUser);
                return (
                  <div
                    key={task.id}
                    className={`task-kanban-card${isMine ? ' task-kanban-card-mine' : ''}`}
                    data-testid="task-kanban-card"
                  >
                    <div className="task-kanban-card-title">{task.title}</div>
                    <RiskStatusTag risk={task.riskLevel} status={task.status} />
                    <div className="task-kanban-card-meta">
                      <span className="task-kanban-card-owner">{task.owner}</span>
                      <span className="task-kanban-card-time">{formatDateOrPlaceholder(task.updatedAt)}</span>
                    </div>
                    <Tooltip title={TASK_DISPATCH_UNAVAILABLE_MESSAGE}>
                      <span className="task-kanban-card-dispatch">
                        <Button size="small" disabled autoInsertSpace={false}>
                          分派
                        </Button>
                      </span>
                    </Tooltip>
                  </div>
                );
              })
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
