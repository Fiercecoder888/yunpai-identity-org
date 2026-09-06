import { todoSourceOrder, type TodoItem, type TodoSeverity } from './todoAggregation';

export type TodoSortMode = 'severity' | 'dueAt' | 'source';

const severityRank: Record<TodoSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const parseDueAt = (value: string | undefined): number => {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return timestamp;
};

export function sortTodos(items: TodoItem[], mode: TodoSortMode = 'severity'): TodoItem[] {
  return [...items].sort((left, right) => {
    if (mode === 'severity') {
      const rankDiff = severityRank[left.severity] - severityRank[right.severity];
      if (rankDiff !== 0) {
        return rankDiff;
      }
    }
    if (mode === 'dueAt') {
      const dueDiff = parseDueAt(left.dueAt) - parseDueAt(right.dueAt);
      if (dueDiff !== 0) {
        return dueDiff;
      }
    }
    if (mode === 'source') {
      const sourceDiff = todoSourceOrder.indexOf(left.source) - todoSourceOrder.indexOf(right.source);
      if (sourceDiff !== 0) {
        return sourceDiff;
      }
    }
    return left.id.localeCompare(right.id);
  });
}
