import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkbenchStore } from './useWorkbenchStore';

describe('useWorkbenchStore', () => {
  beforeEach(() => {
    useWorkbenchStore.getState().resetWorkbench();
  });

  it('records flow selection, viewport and filter state', () => {
    useWorkbenchStore.getState().setSelectedFlowNodeId('m1');
    useWorkbenchStore.getState().setFlowViewport({ x: 10, y: 20, zoom: 1.4 });
    useWorkbenchStore.getState().setFlowStatusFilter('waiting_human');

    expect(useWorkbenchStore.getState()).toMatchObject({
      selectedFlowNodeId: 'm1',
      flowViewport: { x: 10, y: 20, zoom: 1.4 },
      flowStatusFilter: 'waiting_human',
    });
  });

  it('records schedule resource and scale preferences', () => {
    useWorkbenchStore.getState().setScheduleResourceFilter('line-2');
    useWorkbenchStore.getState().setScheduleScale('week');

    expect(useWorkbenchStore.getState()).toMatchObject({
      scheduleResourceFilter: 'line-2',
      scheduleScale: 'week',
    });
  });

  it('records the month scale and the gantt zoom window', () => {
    useWorkbenchStore.getState().setScheduleScale('month');
    useWorkbenchStore.getState().setGanttWindow({ startDay: 2, endDay: 6 });

    expect(useWorkbenchStore.getState()).toMatchObject({
      scheduleScale: 'month',
      ganttWindow: { startDay: 2, endDay: 6 },
    });

    useWorkbenchStore.getState().setGanttWindow(null);
    expect(useWorkbenchStore.getState().ganttWindow).toBeNull();
  });
});
