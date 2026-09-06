import { useQuery } from '@tanstack/react-query';
import { getM1Batch } from '../../services/m1Api';

export type M1BatchProgressSummary = {
  total: number;
  done: number;
  running: number;
  failed: number;
  percent: number;
  pending: number;
};

export const summarizeM1BatchProgress = (statuses: string[]): M1BatchProgressSummary => {
  const total = statuses.length;
  const done = statuses.filter((status) => ['completed', 'need_review'].includes(status)).length;
  const failed = statuses.filter((status) => ['failed', 'cancelled'].includes(status)).length;
  const running = statuses.filter((status) => ['pending', 'running'].includes(status)).length;
  const pending = total - done - failed;
  const percent = total === 0 ? 0 : Math.round(((done + failed) / total) * 100);
  return { total, done, running, failed, pending, percent };
};

export function useM1BatchProgress(parentId?: string, enabled = false) {
  return useQuery({
    queryKey: ['m1-batch-progress', parentId],
    queryFn: () => getM1Batch(parentId as string),
    enabled: Boolean(parentId) && enabled,
    refetchInterval: 4000,
    select: (tasks) => ({
      tasks,
      summary: summarizeM1BatchProgress(tasks.map((task) => task.status)),
    }),
  });
}
