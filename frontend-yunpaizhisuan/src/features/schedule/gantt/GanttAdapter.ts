import type { ScheduleDependency, ScheduleTask } from '../../../types/api';
import type { ScheduleScale } from '../../../store/useWorkbenchStore';
import type { AxisColumn, GanttAdapter, GanttBar, GanttBarKind, GanttTask } from './types';

const FALLBACK_TIMELINE_START_UTC = Date.UTC(2026, 5, 26);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const MIN_BAR_WIDTH_PERCENT = 1.2;

export const ganttFallbackTimelineStartUtc = FALLBACK_TIMELINE_START_UTC;

export const ganttMonthDays = MONTH_DAYS;

export const barKindFromStatus = (task: Pick<ScheduleTask, 'status' | 'rawStatus'>): GanttBarKind => {
  if (task.rawStatus === 'locked') {
    return 'locked';
  }
  if (task.rawStatus === 'wip') {
    return 'wip';
  }
  switch (task.status) {
    case 'conflict':
      return 'delayed';
    case 'solving':
      return 'wip';
    case 'adjusted':
      return 'locked';
    default:
      return 'planned';
  }
};

const computeTimeline = (tasks: ScheduleTask[]) => {
  const actualStarts = tasks.map((task) => task.actualStartDay).filter((value): value is number => value !== undefined);
  const actualEnds = tasks
    .filter((task) => task.actualStartDay !== undefined && task.actualDurationDays !== undefined)
    .map((task) => Number(task.actualStartDay) + Math.max(1, Number(task.actualDurationDays)));
  const minStartDay = tasks.length === 0 ? 0 : Math.min(0, ...tasks.map((task) => task.startDay), ...actualStarts);
  const maxEndDay = tasks.length === 0 ? 1 : Math.max(1, ...tasks.map((task) => task.startDay + Math.max(1, task.durationDays)), ...actualEnds);
  return { minStartDay, maxEndDay, totalDays: Math.max(1, maxEndDay - minStartDay) };
};

const toPercent = (numerator: number, totalDays: number) => Math.min(100, Math.max(0, (numerator / totalDays) * 100));

const toBar = (startDay: number, durationDays: number, totalDays: number, minStartDay: number): GanttBar => ({
  leftPercent: toPercent(startDay - minStartDay, totalDays),
  widthPercent: Math.max(MIN_BAR_WIDTH_PERCENT, toPercent(Math.max(1, durationDays), totalDays)),
});

const parseTimelineMs = (timelineStart: string | undefined) => {
  if (timelineStart) {
    const parsed = Date.parse(timelineStart);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return FALLBACK_TIMELINE_START_UTC;
};

const formatDayLabel = (ms: number) => {
  const date = new Date(ms);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${month}/${day}`;
};

const isoWeekOf = (ms: number) => {
  const date = new Date(ms);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
};

const formatWeekLabel = (ms: number) => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-W${String(isoWeekOf(ms)).padStart(2, '0')}`;
};

const formatMonthLabel = (ms: number) => {
  const date = new Date(ms);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
};

const buildColumns = (
  minStartDay: number,
  maxEndDay: number,
  totalDays: number,
  timelineMs: number,
  scale: ScheduleScale,
): AxisColumn[] => {
  const columns: AxisColumn[] = [];
  const step = scale === 'week' ? WEEK_DAYS : scale === 'month' ? MONTH_DAYS : 1;
  let start = minStartDay;
  let index = 0;
  while (start < maxEndDay) {
    const end = Math.min(start + step, maxEndDay);
    const dayMs = timelineMs + start * DAY_MS;
    columns.push({
      key: `${scale}-${index}`,
      label: scale === 'week' ? formatWeekLabel(dayMs) : scale === 'month' ? formatMonthLabel(dayMs) : formatDayLabel(dayMs),
      leftPercent: toPercent(start - minStartDay, totalDays),
      widthPercent: toPercent(end - start, totalDays),
      isWeek: scale === 'week',
      isMonth: scale === 'month',
    });
    start = end;
    index += 1;
  }
  return columns;
};

/**
 * 「今天」缩放窗口：以真实当天为中心开一个 5 天窗口，并钳制进计划时间范围，
 * 保证当天在计划之外时窗口仍覆盖计划最近 5 天（避免空白视窗）。
 */
export const computeTodayWindow = (
  timelineMs: number,
  nowMs: number,
  planDays: number,
): { startDay: number; endDay: number } => {
  const planLength = Math.max(1, planDays);
  const windowDays = 5;
  const dayOffset = Math.floor((nowMs - timelineMs) / DAY_MS);
  const desiredStart = dayOffset - 2;
  const desiredEnd = dayOffset + windowDays - 2;
  if (desiredEnd <= 0) {
    return { startDay: 0, endDay: Math.min(planLength, windowDays) };
  }
  if (desiredStart >= planLength) {
    return { startDay: Math.max(0, planLength - windowDays), endDay: planLength };
  }
  return {
    startDay: Math.max(0, desiredStart),
    endDay: Math.min(planLength, desiredEnd),
  };
};

export const computeFocusWindow = (
  startDay: number,
  durationDays: number,
  planDays: number,
): { startDay: number; endDay: number } => {
  const planLength = Math.max(1, planDays);
  const duration = Math.max(1, durationDays);
  return {
    startDay: Math.max(0, Math.min(planLength - 1, startDay - 1)),
    endDay: Math.min(planLength, Math.max(startDay + 1, startDay + duration + 1)),
  };
};

/**
 * 依据契约字段 critical（或 is_critical）标注关键路径；字段缺失时按依赖图计算最长路径；
 * 两者皆不可用时返回 unavailable（前端标「未提供」，不伪造关键路径）。
 */
export const computeCriticalPathIds = (tasks: ScheduleTask[], dependencies: ScheduleDependency[]): string[] => {
  const ids = new Set(tasks.map((task) => task.id));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const predecessors = new Map<string, string[]>();
  for (const dependency of dependencies) {
    if (ids.has(dependency.predecessorId) && ids.has(dependency.successorId)) {
      predecessors.set(dependency.successorId, [...(predecessors.get(dependency.successorId) ?? []), dependency.predecessorId]);
    }
  }
  const durationOf = (id: string) => Math.max(1, taskById.get(id)?.durationDays ?? 1);

  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();
  for (const task of tasks) {
    earliestStart.set(task.id, task.startDay);
    earliestFinish.set(task.id, task.startDay + durationOf(task.id));
  }
  for (let round = 0; round < tasks.length; round += 1) {
    let changed = false;
    for (const dependency of dependencies) {
      if (!ids.has(dependency.predecessorId) || !ids.has(dependency.successorId)) {
        continue;
      }
      const constraint = (earliestFinish.get(dependency.predecessorId) ?? 0) + dependency.lagDays;
      const current = earliestStart.get(dependency.successorId) ?? 0;
      if (constraint > current) {
        earliestStart.set(dependency.successorId, constraint);
        earliestFinish.set(dependency.successorId, constraint + durationOf(dependency.successorId));
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const projectEnd = Math.max(0, ...Array.from(earliestFinish.values()));
  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();
  for (const task of tasks) {
    latestFinish.set(task.id, projectEnd);
    latestStart.set(task.id, projectEnd - durationOf(task.id));
  }
  for (let round = 0; round < tasks.length; round += 1) {
    let changed = false;
    for (const dependency of dependencies) {
      if (!ids.has(dependency.predecessorId) || !ids.has(dependency.successorId)) {
        continue;
      }
      const limit = (latestStart.get(dependency.successorId) ?? 0) - dependency.lagDays;
      const current = latestFinish.get(dependency.predecessorId) ?? 0;
      if (limit < current) {
        latestFinish.set(dependency.predecessorId, limit);
        latestStart.set(dependency.predecessorId, limit - durationOf(dependency.predecessorId));
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  return tasks.filter((task) => (latestStart.get(task.id) ?? 0) === (earliestStart.get(task.id) ?? 0)).map((task) => task.id);
};

const annotateCriticalPath = (tasks: GanttTask[], dependencies: ScheduleDependency[]): { tasks: GanttTask[]; available: boolean } => {
  const declaredIds = new Set(tasks.filter((task) => task.isCritical).map((task) => task.id));
  if (declaredIds.size > 0) {
    return {
      tasks: tasks.map((task) => ({
        ...task,
        criticalPath: 'available' as const,
      })),
      available: true,
    };
  }
  const computedIds = dependencies.length > 0 ? new Set(computeCriticalPathIds(tasks, dependencies)) : new Set<string>();
  if (computedIds.size > 0) {
    return {
      tasks: tasks.map((task) => ({
        ...task,
        isCritical: computedIds.has(task.id),
        criticalPath: 'available' as const,
      })),
      available: true,
    };
  }
  return {
    tasks: tasks.map((task) => ({ ...task, criticalPath: 'unavailable' as const })),
    available: false,
  };
};

export const demoGanttAdapter: GanttAdapter = {
  toGanttLayout: (board, options = {}) => {
    const scale = options.scale ?? 'day';
    const tasks = options.resourceFilter && options.resourceFilter !== 'all'
      ? board.tasks.filter((task) => task.resourceId === options.resourceFilter)
      : board.tasks;
    const timelineMs = parseTimelineMs(board.timelineStart ?? options.timelineStart);
    const { minStartDay: fullMin, maxEndDay: fullMax } = computeTimeline(tasks);

    // 时间窗裁剪：列与任务都按窗口过滤，百分位定位以窗口起点为基准。
    const windowStart = options.window?.startDay !== undefined ? Math.max(fullMin, options.window.startDay) : fullMin;
    const windowEnd = options.window?.endDay !== undefined ? Math.min(fullMax, options.window.endDay) : fullMax;
    const minStartDay = windowStart;
    const maxEndDay = Math.max(windowStart + 1, windowEnd);
    const totalDays = Math.max(1, maxEndDay - minStartDay);

    const baseTasks: GanttTask[] = tasks
      .filter((task) => {
        const planVisible = task.startDay < maxEndDay && task.startDay + Math.max(1, task.durationDays) > minStartDay;
        const actualVisible = task.actualStartDay !== undefined && task.actualDurationDays !== undefined
          && task.actualStartDay < maxEndDay
          && task.actualStartDay + Math.max(1, task.actualDurationDays) > minStartDay;
        return planVisible || actualVisible;
      })
      .map((task) => {
        const bar = toBar(task.startDay, task.durationDays, totalDays, minStartDay);
        const actualBar =
          task.actualStartDay !== undefined && task.actualDurationDays !== undefined
            ? toBar(task.actualStartDay, task.actualDurationDays, totalDays, minStartDay)
            : null;
        return {
          ...task,
          leftPercent: bar.leftPercent,
          widthPercent: bar.widthPercent,
          barKind: barKindFromStatus(task),
          isCritical: task.critical === true,
          criticalPath: 'unavailable' as const,
          actualBar,
          hasActualData: actualBar !== null,
        };
      });

    const columns = buildColumns(minStartDay, maxEndDay, totalDays, timelineMs, scale);
    const annotated = annotateCriticalPath(baseTasks, options.dependencies ?? []);
    return {
      tasks: annotated.tasks,
      columns,
      totalDays,
      minStartDay,
      maxEndDay,
      scale,
      criticalPathAvailable: annotated.available,
    };
  },
  toGanttTasks: (board, options) => demoGanttAdapter.toGanttLayout(board, options).tasks,
};

export const ganttTimelineHelpers = {
  DAY_MS,
  WEEK_DAYS,
  MONTH_DAYS,
  parseTimelineMs,
  formatDayLabel,
  formatWeekLabel,
  formatMonthLabel,
  isoWeekOf,
};
