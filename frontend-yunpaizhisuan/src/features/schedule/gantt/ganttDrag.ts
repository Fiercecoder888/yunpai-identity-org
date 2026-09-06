import type { ScheduleTask } from '../../../types/api';

export const GANTT_SCALE_UNIT_DAY = 12;
export const GANTT_SCALE_UNIT_WEEK = 6;
export const GANTT_MAX_START_DAY = 14;
export const GANTT_TRACK_FALLBACK_WIDTH = 848;

export type DayPointerGeometry = {
  clientX: number;
  trackLeft: number;
  trackWidth: number;
  scaleUnit: number;
  minStartDay: number;
  maxStartDay: number;
};

export function clampDay(day: number, minStartDay: number, maxStartDay: number): number {
  if (!Number.isFinite(day)) {
    return minStartDay;
  }
  return Math.max(minStartDay, Math.min(maxStartDay, day));
}

export function getDayFromPointer({ clientX, trackLeft, trackWidth, scaleUnit, minStartDay, maxStartDay }: DayPointerGeometry): number {
  const left = Number.isFinite(trackLeft) ? trackLeft : 0;
  const width = Number.isFinite(trackWidth) && trackWidth > 0 ? trackWidth : GANTT_TRACK_FALLBACK_WIDTH;
  const percent = ((clientX - left) / width) * 100;
  return clampDay(minStartDay + Math.round(percent / scaleUnit), minStartDay, maxStartDay);
}

export function getMaxStartDay(durationDays: number, scaleUnit: number, cap = GANTT_MAX_START_DAY): number {
  const widthPercent = Math.min(Math.max(durationDays * scaleUnit, 0), 100);
  return Math.max(0, Math.min(cap, Math.floor((100 - widthPercent) / scaleUnit)));
}

export function findOverlappingTasks(tasks: ScheduleTask[], moved: ScheduleTask, startDay: number): ScheduleTask[] {
  const durationDays = Math.max(1, moved.durationDays);
  return tasks.filter(
    (task) =>
      task.resourceId === moved.resourceId &&
      task.id !== moved.id &&
      startDay < task.startDay + task.durationDays &&
      startDay + durationDays > task.startDay,
  );
}

export function buildDragReason(title: string, originalStartDay: number, previewStartDay: number): string {
  return `人工拖拽调整「${title}」：从第 ${originalStartDay + 1} 天移至第 ${previewStartDay + 1} 天`;
}
