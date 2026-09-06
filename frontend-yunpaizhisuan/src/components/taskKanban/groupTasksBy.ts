import type { TaskItem } from '../../types/api';

export type TaskGroup = {
  key: string;
  label: string;
  tasks: TaskItem[];
};

export const TASK_STATUS_ORDER: TaskItem['status'][] = [
  'need_review',
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
];

export const TASK_STATUS_LABEL: Record<TaskItem['status'], string> = {
  pending: '待处理',
  need_review: '待审核',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const uniqueInOrder = (values: string[]) => Array.from(new Set(values));

export function groupTasksBy(tasks: TaskItem[], by: 'status' | 'owner', order?: string[]): TaskGroup[] {
  if (by === 'owner') {
    const owners = order ?? uniqueInOrder(tasks.map((task) => task.owner));
    return owners.map((owner) => ({
      key: owner,
      label: owner,
      tasks: tasks.filter((task) => task.owner === owner),
    }));
  }

  const statuses = (order as TaskItem['status'][] | undefined) ?? TASK_STATUS_ORDER;
  return statuses.map((status) => ({
    key: status,
    label: TASK_STATUS_LABEL[status] ?? status,
    tasks: tasks.filter((task) => task.status === status),
  }));
}
