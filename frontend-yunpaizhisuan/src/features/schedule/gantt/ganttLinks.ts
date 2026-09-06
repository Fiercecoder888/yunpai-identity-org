import type { ScheduleDependency, ScheduleResource } from '../../../types/api';
import type { GanttLayout, GanttTask } from './types';

export type GanttLinkAnchor = {
  /** 0..100，相对时间轴（track）宽度的百分比 x */
  xPercent: number;
  /** 行内垂直中线偏移（px，相对 rows 区域顶部） */
  y: number;
};

export type GanttLinkPath = {
  id: string;
  type: ScheduleDependency['type'];
  lagDays: number;
  predecessorId: string;
  successorId: string;
  predecessorResourceId: string;
  successorResourceId: string;
  from: GanttLinkAnchor;
  to: GanttLinkAnchor;
  /** SVG path data：x 为百分比宽度，y 为 px（viewBox 由渲染方给出） */
  d: string;
};

export type GanttLinkBuildOptions = {
  /** 每行高度 px，默认 64（与 .gantt-row 一致） */
  rowHeight?: number;
  /** track 高度 px，默认 48（与 .gantt-track 一致） */
  trackHeight?: number;
  /** 资源排序，用于跨资源连线 y 定位；缺省时所有任务视为同一行 */
  resourceOrder?: ScheduleResource[];
};

export const GANTT_LINK_DEFAULT_ROW_HEIGHT = 64;
export const GANTT_LINK_DEFAULT_TRACK_HEIGHT = 48;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const rowIndexOf = (resourceId: string, resources?: ScheduleResource[]) => {
  if (!resources || resources.length === 0) {
    return 0;
  }
  const index = resources.findIndex((resource) => resource.id === resourceId);
  return index === -1 ? 0 : index;
};

const rowYOf = (rowIndex: number, rowHeight: number, trackHeight: number) => rowIndex * rowHeight + trackHeight / 2;

/**
 * 构造折线路径：finish_to_start 从前驱右缘出发、start_to_start 从双左缘出发，
 * 终点统一落到后继左缘；lagDays 按 scaleUnit 平移起点（越界钳制到 0..100）。
 */
export function buildLinkPaths(layout: GanttLayout, dependencies: ScheduleDependency[], options: GanttLinkBuildOptions = {}): GanttLinkPath[] {
  const taskById = new Map(layout.tasks.map((task) => [task.id, task]));
  const rowHeight = options.rowHeight ?? GANTT_LINK_DEFAULT_ROW_HEIGHT;
  const trackHeight = options.trackHeight ?? GANTT_LINK_DEFAULT_TRACK_HEIGHT;
  const scaleUnit = 100 / Math.max(1, layout.totalDays);

  const links: GanttLinkPath[] = [];
  for (const dependency of dependencies) {
    const predecessor = taskById.get(dependency.predecessorId);
    const successor = taskById.get(dependency.successorId);
    if (!predecessor || !successor) {
      continue;
    }
    const lagOffset = dependency.lagDays * scaleUnit;
    const startFromLeft = dependency.type === 'start_to_start';
    const fromX = (startFromLeft ? predecessor.leftPercent : predecessor.leftPercent + predecessor.widthPercent) + lagOffset;
    const toX = successor.leftPercent;
    const from = { xPercent: clampPercent(fromX), y: rowYOf(rowIndexOf(predecessor.resourceId, options.resourceOrder), rowHeight, trackHeight) };
    const to = { xPercent: clampPercent(toX), y: rowYOf(rowIndexOf(successor.resourceId, options.resourceOrder), rowHeight, trackHeight) };
    links.push({
      id: dependency.id,
      type: dependency.type,
      lagDays: dependency.lagDays,
      predecessorId: dependency.predecessorId,
      successorId: dependency.successorId,
      predecessorResourceId: predecessor.resourceId,
      successorResourceId: successor.resourceId,
      from,
      to,
      d: buildOrthogonalPath(from, to),
    });
  }
  return links;
}

export function buildOrthogonalPath(from: GanttLinkAnchor, to: GanttLinkAnchor): string {
  const midX = (from.xPercent + to.xPercent) / 2;
  return `M ${from.xPercent} ${from.y} H ${midX} V ${to.y} H ${to.xPercent}`;
}

export const isRelatedLink = (link: Pick<GanttLinkPath, 'predecessorId' | 'successorId'>, task: GanttTask | null) =>
  task !== null && (link.predecessorId === task.id || link.successorId === task.id);
