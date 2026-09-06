import { describe, expect, it } from 'vitest';
import type { ScheduleTask } from '../../../types/api';
import {
  buildDragReason,
  clampDay,
  findOverlappingTasks,
  getDayFromPointer,
  getMaxStartDay,
  GANTT_TRACK_FALLBACK_WIDTH,
} from './ganttDrag';

const task = (overrides: Partial<ScheduleTask> & Pick<ScheduleTask, 'id' | 'resourceId'>): ScheduleTask => ({
  title: overrides.id,
  startDay: 0,
  durationDays: 3,
  status: 'solved',
  ...overrides,
});

describe('ganttDrag getDayFromPointer', () => {
  it('maps a pointer position to a day using the percent-based track geometry', () => {
    const day = getDayFromPointer({
      clientX: 305.28,
      trackLeft: 0,
      trackWidth: 848,
      scaleUnit: 12,
      minStartDay: 0,
      maxStartDay: 5,
    });
    expect(day).toBe(3);
  });

  it('clamps to the visible day window', () => {
    const day = getDayFromPointer({
      clientX: 100000,
      trackLeft: 0,
      trackWidth: 848,
      scaleUnit: 12,
      minStartDay: 0,
      maxStartDay: 5,
    });
    expect(day).toBe(5);
  });

  it('falls back to a fixed track width when jsdom reports zero geometry', () => {
    const day = getDayFromPointer({
      clientX: 84.8,
      trackLeft: 0,
      trackWidth: 0,
      scaleUnit: 12,
      minStartDay: 0,
      maxStartDay: 5,
    });
    expect(day).toBe(1);
    expect(GANTT_TRACK_FALLBACK_WIDTH).toBeGreaterThan(0);
  });

  it('returns minStartDay for non-finite pointer coordinates', () => {
    const day = getDayFromPointer({
      clientX: Number.NaN,
      trackLeft: 0,
      trackWidth: 848,
      scaleUnit: 12,
      minStartDay: 0,
      maxStartDay: 5,
    });
    expect(day).toBe(0);
  });
});

describe('ganttDrag clampDay / getMaxStartDay', () => {
  it('clamps day into the allowed range', () => {
    expect(clampDay(-1, 0, 5)).toBe(0);
    expect(clampDay(6, 0, 5)).toBe(5);
    expect(clampDay(3, 0, 5)).toBe(3);
  });

  it('keeps the dragged bar within the visible track', () => {
    expect(getMaxStartDay(3, 12)).toBe(5);
    expect(getMaxStartDay(14, 12)).toBe(0);
    expect(getMaxStartDay(1, 12)).toBe(7);
  });
});

describe('ganttDrag findOverlappingTasks', () => {
  const tasks = [
    task({ id: 'SCH-1', resourceId: 'line-1', startDay: 0, durationDays: 3 }),
    task({ id: 'SCH-2', resourceId: 'line-2', startDay: 2, durationDays: 3 }),
    task({ id: 'SCH-3', resourceId: 'line-1', startDay: 5, durationDays: 2 }),
  ];

  it('reports same-resource overlapping tasks and ignores the moved task itself', () => {
    const overlaps = findOverlappingTasks(tasks, tasks[0]!, 5);
    expect(overlaps.map((item) => item.id)).toEqual(['SCH-3']);
  });

  it('ignores tasks on other resources and non-overlapping windows', () => {
    expect(findOverlappingTasks(tasks, tasks[0]!, 2)).toEqual([]);
    expect(findOverlappingTasks(tasks, tasks[1]!, 0)).toEqual([]);
  });

  it('treats touching edges as non-overlapping', () => {
    const overlaps = findOverlappingTasks(tasks, tasks[2]!, 3);
    expect(overlaps).toEqual([]);
  });
});

describe('ganttDrag buildDragReason', () => {
  it('describes the before/after day move', () => {
    expect(buildDragReason('订单 A 粗加工', 0, 3)).toBe('人工拖拽调整「订单 A 粗加工」：从第 1 天移至第 4 天');
  });
});
