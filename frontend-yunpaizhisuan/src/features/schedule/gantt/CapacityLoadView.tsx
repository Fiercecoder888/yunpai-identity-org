import { Alert, Space } from 'antd';
import { useMemo } from 'react';
import type { ScheduleBoard } from '../../../types/api';
import { useWorkbenchStore } from '../../../store/useWorkbenchStore';
import { computeCapacityLoad, type CapacityLoad } from './capacityLoad';

const LOW_HEX = { r: 230, g: 240, b: 255 };
const HIGH_HEX = { r: 239, g: 68, b: 68 };

const heatColor = (intensity: number) => {
  const ratio = Math.min(1, Math.max(0, intensity));
  const r = Math.round(LOW_HEX.r + (HIGH_HEX.r - LOW_HEX.r) * ratio);
  const g = Math.round(LOW_HEX.g + (HIGH_HEX.g - LOW_HEX.g) * ratio);
  const b = Math.round(LOW_HEX.b + (HIGH_HEX.b - LOW_HEX.b) * ratio);
  return `rgba(${r}, ${g}, ${b}, 0.92)`;
};

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

const CapacityHeatmap = ({ capacity }: { capacity: CapacityLoad }) => (
  <div className="capacity-grid" role="table" aria-label="产能负载热力">
    <div className="capacity-grid-row capacity-grid-header" role="row">
      <div className="capacity-label-cell" role="columnheader">
        资源
      </div>
      {capacity.buckets.map((bucket) => (
        <div className="capacity-header-cell" role="columnheader" key={bucket.key} title={bucket.label}>
          {bucket.label}
        </div>
      ))}
      <div className="capacity-total-cell" role="columnheader">
        总负载
      </div>
    </div>
    {capacity.rows.map((row) => (
      <div className="capacity-grid-row" role="row" key={row.resourceId}>
        <div className="capacity-label-cell" role="cell">
          {row.resourceName}
        </div>
        {row.buckets.map((entry) => {
          const tone = loadTone(entry.load, capacity.maxColumnLoad);
          const title = `${entry.bucketKey}：${entry.load} 项任务${capacity.workHoursAvailable ? `，${entry.workHours} 工时` : '（工时未提供）'}`;
          return (
            <div
              className={`capacity-cell capacity-cell-${tone}`}
              role="cell"
              key={entry.bucketKey}
              title={title}
              style={{ backgroundColor: entry.load > 0 ? heatColor(entry.load / Math.max(1, capacity.maxColumnLoad)) : undefined }}
            >
              {entry.load > 0 ? entry.load : ''}
            </div>
          );
        })}
        <div className="capacity-total-cell" role="cell">
          {row.totalLoad}
        </div>
      </div>
    ))}
  </div>
);

const CapacityStacked = ({ capacity }: { capacity: CapacityLoad }) => (
  <div className="capacity-stacked" data-testid="capacity-stacked">
    {capacity.rows.map((row) => (
      <div className="capacity-stacked-row" key={row.resourceId}>
        <span className="capacity-stacked-label">{row.resourceName}</span>
        <div className="capacity-stacked-track">
          {capacity.buckets.map((bucket) => {
            const entry = row.buckets.find((item) => item.bucketKey === bucket.key);
            const load = entry?.load ?? 0;
            const intensity = capacity.maxColumnLoad > 0 ? load / capacity.maxColumnLoad : 0;
            return (
              <div
                className="capacity-stacked-segment"
                key={bucket.key}
                style={{
                  left: `${bucket.leftPercent}%`,
                  width: `${bucket.widthPercent}%`,
                  opacity: load > 0 ? 0.25 + intensity * 0.75 : 0,
                  backgroundColor: heatColor(intensity),
                }}
                title={`${row.resourceName} ${bucket.label}：${load} 项任务`}
              />
            );
          })}
        </div>
      </div>
    ))}
  </div>
);

export function CapacityLoadView({ board }: { board: ScheduleBoard }) {
  const scheduleScale = useWorkbenchStore((state) => state.scheduleScale);
  const capacity = useMemo(() => computeCapacityLoad(board, scheduleScale), [board, scheduleScale]);

  return (
    <div className="capacity-load" data-testid="capacity-load">
      <Space direction="vertical" size={12} className="page-stack">
        <Alert
          type="info"
          showIcon
          message={`产能负载（${scheduleScale === 'week' ? '按周' : scheduleScale === 'month' ? '按月' : '按日'}）`}
          description={`负载 = 资源上同时占用的工序数。${capacity.workHoursAvailable ? '工时来自工序 work_hours 字段。' : '工时字段未提供，负载按工序占用统计（未伪造）。'}`}
        />
        {capacity.rows.length > 0 ? (
          <>
            <CapacityStacked capacity={capacity} />
            <CapacityHeatmap capacity={capacity} />
            <div className="capacity-legend">
              <span className="capacity-legend-title">负载等级</span>
              <span className="capacity-legend-cell capacity-cell-none" />
              <span>无</span>
              <span className="capacity-legend-cell capacity-cell-low" />
              <span>低</span>
              <span className="capacity-legend-cell capacity-cell-medium" />
              <span>中</span>
              <span className="capacity-legend-cell capacity-cell-high" />
              <span>高</span>
              <span className="capacity-legend-note">颜色越深表示该资源在该时段负载越高。</span>
            </div>
          </>
        ) : (
          <Alert type="info" showIcon message="暂无任务数据，无法计算产能负载。" />
        )}
      </Space>
    </div>
  );
}
