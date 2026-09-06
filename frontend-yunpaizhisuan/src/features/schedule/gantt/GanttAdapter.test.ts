import { describe, expect, it } from 'vitest';
import { barKindFromStatus, computeCriticalPathIds, computeFocusWindow, computeTodayWindow, demoGanttAdapter, ganttFallbackTimelineStartUtc, ganttMonthDays } from './GanttAdapter';
import type { ScheduleBoard, ScheduleTask } from '../../../types/api';

const makeBoard = (tasks: Partial<ScheduleTask>[]): ScheduleBoard => ({
  resources: [{ id: 'line-1', name: '产线 1' }],
  tasks: tasks.map(
    (task, index) =>
      ({
        id: `T${index + 1}`,
        title: `任务 ${index + 1}`,
        resourceId: 'line-1',
        startDay: 0,
        durationDays: 1,
        status: 'solved',
        ...task,
      }) as ScheduleTask,
  ),
  conflicts: [],
});

describe('demoGanttAdapter.toGanttLayout', () => {
  it('computes cross-day positions from the shared timeline range', () => {
    const board: ScheduleBoard = {
      resources: [{ id: 'line-1', name: '产线 1' }],
      tasks: [
        { id: 'T1', title: '任务 1', resourceId: 'line-1', startDay: 2, durationDays: 3, status: 'solved' },
        { id: 'T2', title: '任务 2', resourceId: 'line-1', startDay: 4, durationDays: 2, status: 'solved' },
      ],
      conflicts: [],
    };

    const layout = demoGanttAdapter.toGanttLayout(board, { scale: 'day' });
    expect(layout.totalDays).toBe(6);
    expect(layout.minStartDay).toBe(0);
    expect(layout.maxEndDay).toBe(6);
    expect(layout.tasks).toMatchObject([
      { id: 'T1', leftPercent: expect.closeTo(100 / 3, 2), widthPercent: 50 },
      { id: 'T2', leftPercent: expect.closeTo(200 / 3, 2), widthPercent: expect.closeTo(100 / 3, 2) },
    ]);
  });

  it('builds day axis columns for the exact day range', () => {
    const board = makeBoard([{ startDay: 0, durationDays: 3 }]);
    const layout = demoGanttAdapter.toGanttLayout(board, { scale: 'day' });
    expect(layout.columns).toHaveLength(3);
    expect(layout.columns[0]).toMatchObject({ isWeek: false, label: '06/26' });
  });

  it('builds week axis columns grouping seven days per bucket', () => {
    const board = makeBoard([{ startDay: 0, durationDays: 14 }]);
    const layout = demoGanttAdapter.toGanttLayout(board, { scale: 'week' });
    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]).toMatchObject({ isWeek: true, label: '2026-W26' });
  });

  it('builds month axis columns grouping thirty days per bucket', () => {
    const board = makeBoard([{ startDay: 0, durationDays: 60 }]);
    const layout = demoGanttAdapter.toGanttLayout(board, { scale: 'month' });
    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0]).toMatchObject({ isWeek: false, isMonth: true, label: '2026-06' });
    expect(layout.columns[1]).toMatchObject({ isMonth: true, label: '2026-07' });
    expect(ganttMonthDays).toBe(30);
  });

  it('clips tasks and columns to the requested day window', () => {
    const board = makeBoard([
      { startDay: 0, durationDays: 2 },
      { startDay: 3, durationDays: 2 },
      { startDay: 6, durationDays: 2 },
    ]);
    const layout = demoGanttAdapter.toGanttLayout(board, { scale: 'day', window: { startDay: 2, endDay: 6 } });
    expect(layout.totalDays).toBe(4);
    expect(layout.minStartDay).toBe(2);
    expect(layout.maxEndDay).toBe(6);
    expect(layout.tasks.map((task) => task.id)).toEqual(['T2']);
    expect(layout.tasks[0]).toMatchObject({ startDay: 3, leftPercent: 25, widthPercent: 50 });
    expect(layout.columns).toHaveLength(4);
  });

  it('clamps the window into the plan range when it exceeds the edges', () => {
    const board = makeBoard([
      { startDay: 0, durationDays: 2 },
      { startDay: 3, durationDays: 2 },
    ]);
    const layout = demoGanttAdapter.toGanttLayout(board, { scale: 'day', window: { startDay: -5, endDay: 99 } });
    expect(layout.minStartDay).toBe(0);
    expect(layout.maxEndDay).toBe(5);
    expect(layout.tasks).toHaveLength(2);
  });

  it('maps schedule statuses to the four visual bar kinds', () => {
    const board = makeBoard([
      { status: 'solved', rawStatus: undefined },
      { status: 'adjusted', rawStatus: 'locked' },
      { status: 'solving', rawStatus: 'wip' },
      { status: 'conflict' },
      { status: 'adjusted', rawStatus: undefined },
    ]);
    const kinds = demoGanttAdapter.toGanttLayout(board).tasks.map((task) => task.barKind);
    expect(kinds).toEqual(['planned', 'locked', 'wip', 'delayed', 'locked']);
  });

  it('exposes a two-layer bar only when actual data is provided', () => {
    const board = makeBoard([
      { startDay: 1, durationDays: 2, actualStartDay: 2, actualDurationDays: 3 },
      { startDay: 1, durationDays: 2 },
    ]);
    const layout = demoGanttAdapter.toGanttLayout(board, { scale: 'day' });
    expect(layout.tasks[0]).toMatchObject({
      hasActualData: true,
      actualBar: { leftPercent: 40, widthPercent: 60 },
    });
    expect(layout.tasks[1]).toMatchObject({ hasActualData: false, actualBar: null });
  });

  it('expands the timeline so actual work outside the plan is not clipped', () => {
    const layout = demoGanttAdapter.toGanttLayout(makeBoard([{
      startDay: 0,
      durationDays: 2,
      actualStartDay: -2,
      actualDurationDays: 7,
    }]));

    expect(layout).toMatchObject({ minStartDay: -2, maxEndDay: 5, totalDays: 7 });
    expect(layout.tasks[0]).toMatchObject({
      actualBar: { leftPercent: 0, widthPercent: 100 },
      leftPercent: expect.closeTo(200 / 7, 2),
      widthPercent: expect.closeTo(200 / 7, 2),
    });
  });

  it('highlights the declared critical task and reports availability', () => {
    const board = makeBoard([{ startDay: 0, durationDays: 2, critical: true }, { startDay: 2, durationDays: 1 }]);
    const layout = demoGanttAdapter.toGanttLayout(board);
    expect(layout.criticalPathAvailable).toBe(true);
    expect(layout.tasks.map((task) => ({ id: task.id, isCritical: task.isCritical, criticalPath: task.criticalPath }))).toEqual([
      { id: 'T1', isCritical: true, criticalPath: 'available' },
      { id: 'T2', isCritical: false, criticalPath: 'available' },
    ]);
  });

  it('marks critical path as unavailable when no field and no dependency graph exist', () => {
    const layout = demoGanttAdapter.toGanttLayout(makeBoard([{ startDay: 0, durationDays: 2 }]));
    expect(layout.criticalPathAvailable).toBe(false);
    expect(layout.tasks[0]!.criticalPath).toBe('unavailable');
  });

  it('computes the critical path from a dependency chain', () => {
    const board = makeBoard([
      { startDay: 0, durationDays: 2 },
      { startDay: 2, durationDays: 2 },
      { startDay: 4, durationDays: 1 },
    ]);
    const dependencies = [
      { id: 'D1', predecessorId: 'T1', successorId: 'T2', type: 'finish_to_start' as const, lagDays: 0 },
      { id: 'D2', predecessorId: 'T2', successorId: 'T3', type: 'finish_to_start' as const, lagDays: 0 },
    ];
    const layout = demoGanttAdapter.toGanttLayout(board, { dependencies });
    expect(layout.criticalPathAvailable).toBe(true);
    expect(layout.tasks.filter((task) => task.isCritical).map((task) => task.id)).toEqual(['T1', 'T2', 'T3']);
  });

  it('clamps abnormal positions and preserves the raw locked status', () => {
    const board = makeBoard([{ startDay: -3, durationDays: 0, status: 'adjusted', rawStatus: 'locked' }] as Partial<ScheduleTask>[]);
    const task = demoGanttAdapter.toGanttTasks(board)[0];
    expect(task).toMatchObject({
      leftPercent: 0,
      status: 'adjusted',
      rawStatus: 'locked',
      barKind: 'locked',
    });
    expect(task!.widthPercent).toBeGreaterThan(0);
  });

  it('keeps the resource filter applied across scales', () => {
    const board: ScheduleBoard = {
      resources: [
        { id: 'line-1', name: '产线 1' },
        { id: 'line-2', name: '产线 2' },
      ],
      tasks: [
        { id: 'T1', title: '任务 1', resourceId: 'line-1', startDay: 2, durationDays: 3, status: 'solved' },
        { id: 'T2', title: '任务 2', resourceId: 'line-2', startDay: 4, durationDays: 2, status: 'solved' },
      ],
      conflicts: [],
    };
    const tasks = demoGanttAdapter.toGanttTasks(board, { scale: 'week', resourceFilter: 'line-2' });
    expect(tasks.map((task) => task.id)).toEqual(['T2']);
  });
});

describe('barKindFromStatus', () => {
  it('prioritizes the raw backend status over the collapsed schedule status', () => {
    expect(barKindFromStatus({ status: 'adjusted', rawStatus: 'locked' })).toBe('locked');
    expect(barKindFromStatus({ status: 'adjusted', rawStatus: 'wip' })).toBe('wip');
    expect(barKindFromStatus({ status: 'solved' })).toBe('planned');
    expect(barKindFromStatus({ status: 'solving' })).toBe('wip');
    expect(barKindFromStatus({ status: 'adjusted' })).toBe('locked');
    expect(barKindFromStatus({ status: 'conflict' })).toBe('delayed');
    expect(barKindFromStatus({ status: 'published' })).toBe('planned');
  });
});

describe('computeCriticalPathIds', () => {
  it('returns the longest finish-to-start chain', () => {
    const tasks: ScheduleTask[] = [
      { id: 'A', title: 'A', resourceId: 'r', startDay: 0, durationDays: 2, status: 'solved' },
      { id: 'B', title: 'B', resourceId: 'r', startDay: 2, durationDays: 2, status: 'solved' },
      { id: 'C', title: 'C', resourceId: 'r', startDay: 4, durationDays: 1, status: 'solved' },
    ];
    const dependencies = [
      { id: 'D1', predecessorId: 'A', successorId: 'B', type: 'finish_to_start' as const, lagDays: 0 },
      { id: 'D2', predecessorId: 'B', successorId: 'C', type: 'finish_to_start' as const, lagDays: 0 },
    ];
    expect(computeCriticalPathIds(tasks, dependencies).sort()).toEqual(['A', 'B', 'C']);
  });

  it('excludes parallel tasks not on the critical path', () => {
    const tasks: ScheduleTask[] = [
      { id: 'A', title: 'A', resourceId: 'r', startDay: 0, durationDays: 2, status: 'solved' },
      { id: 'B', title: 'B', resourceId: 'r', startDay: 0, durationDays: 2, status: 'solved' },
      { id: 'C', title: 'C', resourceId: 'r', startDay: 2, durationDays: 2, status: 'solved' },
    ];
    const dependencies = [
      { id: 'D1', predecessorId: 'A', successorId: 'C', type: 'finish_to_start' as const, lagDays: 0 },
    ];
    expect(computeCriticalPathIds(tasks, dependencies).sort()).toEqual(['A', 'C']);
  });

  it('respects lag days as a hard predecessor constraint', () => {
    const tasks: ScheduleTask[] = [
      { id: 'A', title: 'A', resourceId: 'r', startDay: 0, durationDays: 1, status: 'solved' },
      { id: 'B', title: 'B', resourceId: 'r', startDay: 1, durationDays: 1, status: 'solved' },
    ];
    const dependencies = [{ id: 'D1', predecessorId: 'A', successorId: 'B', type: 'finish_to_start' as const, lagDays: 2 }];
    expect(computeCriticalPathIds(tasks, dependencies).sort()).toEqual(['A', 'B']);
  });
});

describe('gantt fallback timeline', () => {
  it('anchors the demo fallback at 2026-06-26 UTC', () => {
    expect(new Date(ganttFallbackTimelineStartUtc).toISOString().slice(0, 10)).toBe('2026-06-26');
  });
});

describe('computeTodayWindow', () => {
  const timelineMs = ganttFallbackTimelineStartUtc;

  it('opens a 5-day window centered on today inside the plan range', () => {
    const now = timelineMs + 1 * 24 * 60 * 60 * 1000;
    expect(computeTodayWindow(timelineMs, now, 14)).toEqual({ startDay: 0, endDay: 4 });
  });

  it('snaps to the plan start when today is before the plan', () => {
    const now = timelineMs - 10 * 24 * 60 * 60 * 1000;
    expect(computeTodayWindow(timelineMs, now, 14)).toEqual({ startDay: 0, endDay: 5 });
  });

  it('snaps the window to the plan tail when today is beyond the plan end', () => {
    const now = timelineMs + 40 * 24 * 60 * 60 * 1000;
    expect(computeTodayWindow(timelineMs, now, 6)).toEqual({ startDay: 1, endDay: 6 });
  });
});

describe('computeFocusWindow', () => {
  it('zooms around a selected task with one day of padding', () => {
    expect(computeFocusWindow(3, 2, 10)).toEqual({ startDay: 2, endDay: 6 });
  });

  it('clamps the focus window into the plan range', () => {
    expect(computeFocusWindow(0, 1, 10)).toEqual({ startDay: 0, endDay: 2 });
    expect(computeFocusWindow(9, 2, 10)).toEqual({ startDay: 8, endDay: 10 });
  });
});
