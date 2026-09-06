import { describe, expect, it } from 'vitest';
import { computeCapacityLoad } from './capacityLoad';
import type { ScheduleBoard } from '../../../types/api';

const board: ScheduleBoard = {
  resources: [
    { id: 'line-1', name: '产线 1' },
    { id: 'line-2', name: '产线 2' },
  ],
  tasks: [
    { id: 'T1', title: '任务 1', resourceId: 'line-1', startDay: 0, durationDays: 2, status: 'solved', workHours: 8 },
    { id: 'T2', title: '任务 2', resourceId: 'line-1', startDay: 1, durationDays: 2, status: 'solved', workHours: 8 },
    { id: 'T3', title: '任务 3', resourceId: 'line-2', startDay: 0, durationDays: 3, status: 'solved' },
  ],
  conflicts: [],
};

describe('computeCapacityLoad', () => {
  it('counts overlapping tasks per resource per day', () => {
    const load = computeCapacityLoad(board, 'day');
    expect(load.buckets).toHaveLength(3);
    const line1 = load.rows.find((row) => row.resourceId === 'line-1');
    expect(line1?.buckets.map((entry) => entry.load)).toEqual([1, 2, 1]);
    expect(line1?.totalLoad).toBe(4);
    const line2 = load.rows.find((row) => row.resourceId === 'line-2');
    expect(line2?.buckets.map((entry) => entry.load)).toEqual([1, 1, 1]);
    expect(load.maxColumnLoad).toBe(2);
  });

  it('suppresses work hours for every row when any task lacks the field', () => {
    const load = computeCapacityLoad(board, 'day');
    expect(load.workHoursAvailable).toBe(false);
    expect(load.rows.every((row) => row.totalWorkHours === null)).toBe(true);
    expect(load.rows.every((row) => row.buckets.every((entry) => entry.workHours === null))).toBe(true);
  });

  it('reports work hours when every task provides them', () => {
    const fullBoard: ScheduleBoard = {
      ...board,
      tasks: board.tasks.map((task) => ({ ...task, workHours: 8 })),
    };
    const load = computeCapacityLoad(fullBoard, 'day');
    expect(load.workHoursAvailable).toBe(true);
    expect(load.rows.find((row) => row.resourceId === 'line-1')?.totalWorkHours).toBe(16);
  });

  it('groups buckets by week on the week scale', () => {
    const load = computeCapacityLoad(board, 'week');
    expect(load.scale).toBe('week');
    expect(load.buckets).toHaveLength(1);
    expect(load.rows.every((row) => row.buckets.length === 1)).toBe(true);
  });

  it('returns empty rows for an empty board', () => {
    const empty: ScheduleBoard = { resources: [], tasks: [], conflicts: [] };
    const load = computeCapacityLoad(empty, 'day');
    expect(load.rows).toHaveLength(0);
    expect(load.maxColumnLoad).toBe(0);
  });
});
