import { create } from 'zustand';

export type FlowStatusFilter = 'all' | 'idle' | 'running' | 'success' | 'failed' | 'waiting_human';
export type ScheduleScale = 'day' | 'week' | 'month';

export type GanttWindow = {
  startDay: number;
  endDay: number;
};

export type FlowViewport = {
  x: number;
  y: number;
  zoom: number;
};

type WorkbenchState = {
  selectedFlowNodeId: string | null;
  flowViewport: FlowViewport;
  flowStatusFilter: FlowStatusFilter;
  scheduleResourceFilter: 'all' | string;
  scheduleScale: ScheduleScale;
  ganttWindow: GanttWindow | null;
  setSelectedFlowNodeId: (id: string | null) => void;
  setFlowViewport: (viewport: FlowViewport) => void;
  setFlowStatusFilter: (filter: FlowStatusFilter) => void;
  setScheduleResourceFilter: (filter: 'all' | string) => void;
  setScheduleScale: (scale: ScheduleScale) => void;
  setGanttWindow: (window: GanttWindow | null) => void;
  resetWorkbench: () => void;
};

const initialState = {
  selectedFlowNodeId: null,
  flowViewport: { x: 0, y: 0, zoom: 1 },
  flowStatusFilter: 'all' as FlowStatusFilter,
  scheduleResourceFilter: 'all',
  scheduleScale: 'day' as ScheduleScale,
  ganttWindow: null,
};

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  ...initialState,
  setSelectedFlowNodeId: (id) => set({ selectedFlowNodeId: id }),
  setFlowViewport: (viewport) => set({ flowViewport: viewport }),
  setFlowStatusFilter: (filter) => set({ flowStatusFilter: filter }),
  setScheduleResourceFilter: (filter) => set({ scheduleResourceFilter: filter }),
  setScheduleScale: (scale) => set({ scheduleScale: scale }),
  setGanttWindow: (ganttWindow) => set({ ganttWindow }),
  resetWorkbench: () => set(initialState),
}));
