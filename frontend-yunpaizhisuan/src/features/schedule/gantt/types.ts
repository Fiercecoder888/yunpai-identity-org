import type { ScheduleBoard, ScheduleDependency, ScheduleTask } from '../../../types/api';
import type { ScheduleScale } from '../../../store/useWorkbenchStore';

export type GanttBarKind = 'planned' | 'locked' | 'wip' | 'delayed';

export type GanttBar = {
  leftPercent: number;
  widthPercent: number;
};

export type AxisColumn = {
  key: string;
  label: string;
  leftPercent: number;
  widthPercent: number;
  isWeek: boolean;
  isMonth: boolean;
};

export type GanttTask = ScheduleTask & {
  leftPercent: number;
  widthPercent: number;
  barKind: GanttBarKind;
  isCritical: boolean;
  /** 关键路径标注状态：available=契约字段或依赖图可推出；unavailable=字段缺失（前端标「未提供」）。 */
  criticalPath: 'available' | 'unavailable';
  actualBar: GanttBar | null;
  hasActualData: boolean;
};

export type GanttLayout = {
  tasks: GanttTask[];
  columns: AxisColumn[];
  totalDays: number;
  minStartDay: number;
  maxEndDay: number;
  scale: ScheduleScale;
  criticalPathAvailable: boolean;
};

export type GanttAdapterOptions = {
  scale?: ScheduleScale;
  resourceFilter?: 'all' | string;
  timelineStart?: string;
  dependencies?: ScheduleDependency[];
  /** 时间窗裁剪（天偏移，与任务 startDay 同一坐标空间）；裁剪后列/任务/拖拽范围均受窗口约束。 */
  window?: { startDay?: number; endDay?: number };
};

export type GanttAdapter = {
  toGanttTasks: (board: ScheduleBoard, options?: GanttAdapterOptions) => GanttTask[];
  toGanttLayout: (board: ScheduleBoard, options?: GanttAdapterOptions) => GanttLayout;
};
