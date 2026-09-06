import type { ScheduleBoard, ScheduleTask } from '../../../types/api';
import type { ScheduleScale } from '../../../store/useWorkbenchStore';
import { ganttTimelineHelpers } from './GanttAdapter';

const { DAY_MS, WEEK_DAYS, MONTH_DAYS, parseTimelineMs, formatDayLabel, formatWeekLabel, formatMonthLabel } = ganttTimelineHelpers;

export type LoadBucket = {
  key: string;
  label: string;
  startDay: number;
  endDay: number;
  leftPercent: number;
  widthPercent: number;
};

export type BucketLoad = {
  bucketKey: string;
  load: number;
  workHours: number | null;
};

export type ResourceLoadRow = {
  resourceId: string;
  resourceName: string;
  buckets: BucketLoad[];
  totalLoad: number;
  totalWorkHours: number | null;
  maxBucketLoad: number;
};

export type CapacityLoad = {
  buckets: LoadBucket[];
  rows: ResourceLoadRow[];
  maxColumnLoad: number;
  scale: ScheduleScale;
  workHoursAvailable: boolean;
};

const overlaps = (taskStart: number, taskEnd: number, bucketStart: number, bucketEnd: number) =>
  taskStart < bucketEnd && taskEnd > bucketStart;

const sumWorkHours = (tasks: ScheduleTask[]) => tasks.reduce((sum, task) => sum + (task.workHours ?? 0), 0);

const buildBuckets = (minStartDay: number, maxEndDay: number, timelineMs: number, scale: ScheduleScale): LoadBucket[] => {
  const buckets: LoadBucket[] = [];
  const step = scale === 'week' ? WEEK_DAYS : scale === 'month' ? MONTH_DAYS : 1;
  const totalDays = Math.max(1, maxEndDay - minStartDay);
  let start = minStartDay;
  let index = 0;
  while (start < maxEndDay) {
    const end = Math.min(start + step, maxEndDay);
    const dayMs = timelineMs + start * DAY_MS;
    buckets.push({
      key: `${scale}-${index}`,
      label: scale === 'week' ? formatWeekLabel(dayMs) : scale === 'month' ? formatMonthLabel(dayMs) : formatDayLabel(dayMs),
      startDay: start,
      endDay: end,
      leftPercent: ((start - minStartDay) / totalDays) * 100,
      widthPercent: ((end - start) / totalDays) * 100,
    });
    start = end;
    index += 1;
  }
  return buckets;
};

export const computeCapacityLoad = (board: ScheduleBoard, scale: ScheduleScale): CapacityLoad => {
  const tasks = board.tasks;
  const timelineMs = parseTimelineMs(board.timelineStart);
  const minStartDay = tasks.length === 0 ? 0 : Math.min(0, ...tasks.map((task) => task.startDay));
  const maxEndDay = tasks.length === 0 ? 1 : Math.max(1, ...tasks.map((task) => task.startDay + Math.max(1, task.durationDays)));
  const buckets = buildBuckets(minStartDay, maxEndDay, timelineMs, scale);
  const workHoursAvailable = tasks.length > 0 && tasks.every((task) => task.workHours !== undefined);

  const rows: ResourceLoadRow[] = board.resources.map((resource) => {
    const resourceTasks = tasks.filter((task) => task.resourceId === resource.id);
    const bucketLoads = buckets.map((bucket) => {
      const overlapping = resourceTasks.filter((task) => overlaps(task.startDay, task.startDay + Math.max(1, task.durationDays), bucket.startDay, bucket.endDay));
      const startedInBucket = resourceTasks.filter((task) => task.startDay >= bucket.startDay && task.startDay < bucket.endDay);
      return {
        bucketKey: bucket.key,
        load: overlapping.length,
        workHours: workHoursAvailable ? sumWorkHours(startedInBucket) : null,
      };
    });
    return {
      resourceId: resource.id,
      resourceName: resource.name,
      buckets: bucketLoads,
      totalLoad: bucketLoads.reduce((sum, entry) => sum + entry.load, 0),
      totalWorkHours: workHoursAvailable ? bucketLoads.reduce((sum, entry) => sum + (entry.workHours ?? 0), 0) : null,
      maxBucketLoad: Math.max(0, ...bucketLoads.map((entry) => entry.load)),
    };
  });

  const maxColumnLoad = Math.max(0, ...rows.flatMap((row) => row.buckets.map((entry) => entry.load)));

  return {
    buckets,
    rows,
    maxColumnLoad,
    scale,
    workHoursAvailable,
  };
};
