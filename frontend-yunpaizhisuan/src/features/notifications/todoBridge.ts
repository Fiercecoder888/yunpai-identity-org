import type { TodoItem } from '../todos/todoAggregation';
import type { AppNotification, NotificationSeverity } from './useNotificationStore';

const severityMap: Record<TodoItem['severity'], NotificationSeverity> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export const bridgeTodoItems = (todos: TodoItem[]): AppNotification[] => {
  const seen = new Set<string>();
  const notifications: AppNotification[] = [];
  for (const todo of todos) {
    const id = `todo-${todo.id}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    notifications.push({
      id,
      type: todo.kind,
      title: todo.title,
      detail: todo.detail,
      severity: severityMap[todo.severity],
      link: todo.link,
      source: 'todo',
      createdAt: new Date().toISOString(),
    });
  }
  return notifications;
};
