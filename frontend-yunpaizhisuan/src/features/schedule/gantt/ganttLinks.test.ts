import { describe, expect, it } from 'vitest';
import type { ScheduleDependency } from '../../../types/api';
import { buildLinkPaths, buildOrthogonalPath, isRelatedLink } from './ganttLinks';
import type { GanttLayout, GanttTask } from './types';

const makeTask = (overrides: Partial<GanttTask> & Pick<GanttTask, 'id' | 'resourceId' | 'leftPercent' | 'widthPercent'>): GanttTask => ({
  title: overrides.id,
  startDay: 0,
  durationDays: 2,
  status: 'solved',
  barKind: 'planned',
  isCritical: false,
  criticalPath: 'available',
  actualBar: null,
  hasActualData: false,
  ...overrides,
});

const layout: GanttLayout = {
  tasks: [
    makeTask({ id: 'A', resourceId: 'r1', leftPercent: 0, widthPercent: 33.33, startDay: 0, durationDays: 2 }),
    makeTask({ id: 'B', resourceId: 'r1', leftPercent: 50, widthPercent: 33.33, startDay: 3, durationDays: 2 }),
  ],
  columns: [],
  totalDays: 6,
  minStartDay: 0,
  maxEndDay: 6,
  scale: 'day',
  criticalPathAvailable: true,
};

const dep = (overrides: Partial<ScheduleDependency> & Pick<ScheduleDependency, 'predecessorId' | 'successorId'>): ScheduleDependency => ({
  id: `D-${overrides.predecessorId}${overrides.successorId}`,
  type: 'finish_to_start',
  lagDays: 0,
  ...overrides,
});

describe('buildLinkPaths', () => {
  it('draws finish_to_start from the predecessor right edge to the successor left edge', () => {
    const [link] = buildLinkPaths(layout, [dep({ predecessorId: 'A', successorId: 'B', type: 'finish_to_start' })]);
    expect(link).toBeDefined();
    expect(link!.type).toBe('finish_to_start');
    expect(link!.from.xPercent).toBeCloseTo(33.33, 1);
    expect(link!.to.xPercent).toBeCloseTo(50, 1);
    expect(link!.from.y).toBe(link!.to.y);
  });

  it('draws start_to_start from both left edges', () => {
    const [link] = buildLinkPaths(layout, [dep({ predecessorId: 'A', successorId: 'B', type: 'start_to_start' })]);
    expect(link!.from.xPercent).toBeCloseTo(0, 1);
    expect(link!.to.xPercent).toBeCloseTo(50, 1);
  });

  it('translates the start anchor by lagDays using the scale unit', () => {
    const scaleUnit = 100 / layout.totalDays;
    const [link] = buildLinkPaths(layout, [dep({ predecessorId: 'A', successorId: 'B', type: 'finish_to_start', lagDays: 1 })]);
    expect(link!.from.xPercent).toBeCloseTo(33.33 + scaleUnit, 1);
  });

  it('clamps out-of-range anchors into 0..100', () => {
    const clampedLayout: GanttLayout = {
      ...layout,
      tasks: [
        makeTask({ id: 'A', resourceId: 'r1', leftPercent: 90, widthPercent: 25 }),
        makeTask({ id: 'B', resourceId: 'r1', leftPercent: 10, widthPercent: 5 }),
      ],
    };
    const [link] = buildLinkPaths(clampedLayout, [dep({ predecessorId: 'A', successorId: 'B', type: 'finish_to_start', lagDays: 3 })]);
    expect(link!.from.xPercent).toBe(100);
    expect(link!.to.xPercent).toBe(10);
  });

  it('skips dependencies whose tasks are not in the layout', () => {
    const links = buildLinkPaths(layout, [
      dep({ predecessorId: 'A', successorId: 'B' }),
      dep({ predecessorId: 'A', successorId: 'MISSING' }),
      dep({ predecessorId: 'MISSING', successorId: 'B' }),
    ]);
    expect(links).toHaveLength(1);
  });

  it('places cross-resource links on different row y positions', () => {
    const links = buildLinkPaths(
      {
        ...layout,
        tasks: [
          layout.tasks[0]!,
          { ...layout.tasks[1]!, resourceId: 'r2' },
        ],
      },
      [dep({ predecessorId: 'A', successorId: 'B' })],
      {
        resourceOrder: [
          { id: 'r1', name: '产线 1' },
          { id: 'r2', name: '产线 2' },
        ],
        rowHeight: 64,
        trackHeight: 48,
      },
    );
    const [link] = links;
    expect(link!.from.y).toBe(24);
    expect(link!.to.y).toBe(88);
    expect(link!.d).toContain('V 88');
  });

  it('keeps links horizontal when both tasks share a row', () => {
    const [link] = buildLinkPaths(layout, [dep({ predecessorId: 'A', successorId: 'B' })]);
    expect(link!.d).toBe('M 33.33 24 H 41.665 V 24 H 50');
  });
});

describe('buildOrthogonalPath', () => {
  it('builds a right-angle connector', () => {
    expect(buildOrthogonalPath({ xPercent: 10, y: 24 }, { xPercent: 60, y: 88 })).toBe('M 10 24 H 35 V 88 H 60');
  });
});

describe('isRelatedLink', () => {
  const link = { predecessorId: 'A', successorId: 'B' };
  it('matches links touching the selected task', () => {
    const task = makeTask({ id: 'A', resourceId: 'r1', leftPercent: 0, widthPercent: 10 });
    expect(isRelatedLink(link, task)).toBe(true);
    expect(isRelatedLink(link, { ...task, id: 'B' })).toBe(true);
    expect(isRelatedLink(link, { ...task, id: 'C' })).toBe(false);
    expect(isRelatedLink(link, null)).toBe(false);
  });
});
