import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getScheduleBoard } from '../../services/scheduleApi';
import { useWorkbenchStore } from '../../store/useWorkbenchStore';
import type { ScheduleBoard } from '../../types/api';
import { demoGanttAdapter } from '../schedule/gantt/GanttAdapter';
import { computeCapacityLoad } from '../schedule/gantt/capacityLoad';

const loadTone = (load: number, max: number) => {
  if (max <= 0) {
    return 'none';
  }
  const ratio = load / max;
  if (ratio >= 0.8) {
    return 'high';
  }
  if (ratio >= 0.5) {
    return 'medium';
  }
  return 'low';
};

type CockpitGanttPreviewProps = {
  board?: ScheduleBoard;
  loading?: boolean;
};

export function CockpitGanttPreview({ board: boardProp, loading: loadingProp }: CockpitGanttPreviewProps) {
  const boardQuery = useQuery({ queryKey: ['schedule-board'], queryFn: getScheduleBoard });
  const board = boardProp ?? boardQuery.data;
  const loading = loadingProp ?? boardQuery.isLoading;
  const scheduleScale = useWorkbenchStore((state) => state.scheduleScale);

  const layout = useMemo(() => (board ? demoGanttAdapter.toGanttLayout(board, { scale: scheduleScale }) : null), [board, scheduleScale]);
  const capacity = useMemo(() => (board ? computeCapacityLoad(board, scheduleScale) : null), [board, scheduleScale]);

  if (loading || !board || !layout || !capacity) {
    return (
      <section className="cockpit-panel" data-testid="cockpit-gantt-preview">
        <div className="cockpit-panel-title">排程甘特概览</div>
        <div className="cockpit-loading">正在加载排程…</div>
      </section>
    );
  }

  return (
    <section className="cockpit-panel" data-testid="cockpit-gantt-preview">
      <div className="cockpit-panel-title">排程甘特概览</div>
      <div className="cockpit-mini-gantt">
        {board.resources.map((resource) => (
          <div className="cockpit-mini-row" key={resource.id}>
            <span className="cockpit-mini-label">{resource.name}</span>
            <div className="cockpit-mini-track">
              {layout.tasks
                .filter((task) => task.resourceId === resource.id)
                .map((task) => (
                  <div
                    key={task.id}
                    className={`cockpit-mini-bar cockpit-mini-bar-${task.barKind}`}
                    style={{ left: `${task.leftPercent}%`, width: `${task.widthPercent}%` }}
                    title={task.title}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="cockpit-panel-subtitle">产能负载（暗色）</div>
      <div className="cockpit-capacity" role="table" aria-label="产能负载热力">
        <div className="cockpit-capacity-header" role="row">
          <span className="cockpit-capacity-cell cockpit-capacity-label" role="columnheader">
            资源
          </span>
          {capacity.buckets.map((bucket) => (
            <span className="cockpit-capacity-cell" role="columnheader" key={bucket.key} title={bucket.label}>
              {bucket.label}
            </span>
          ))}
        </div>
        {capacity.rows.map((row) => (
          <div className="cockpit-capacity-row" role="row" key={row.resourceId}>
            <span className="cockpit-capacity-cell cockpit-capacity-label" role="cell">
              {row.resourceName}
            </span>
            {row.buckets.map((entry) => (
              <span
                className={`cockpit-capacity-cell cockpit-capacity-cell-${loadTone(entry.load, capacity.maxColumnLoad)}`}
                role="cell"
                key={entry.bucketKey}
                title={`${entry.bucketKey}：${entry.load} 项任务`}
              >
                {entry.load > 0 ? entry.load : ''}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
