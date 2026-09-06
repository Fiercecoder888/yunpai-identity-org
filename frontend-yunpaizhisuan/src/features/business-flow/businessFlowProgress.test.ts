import { describe, expect, it } from 'vitest';
import { buildModuleProgress, statusColor, statusLabel } from './businessFlowProgress';
import type { TrackingSnapshot } from '../../services/trackingSnapshotApi';
import type { BusinessFlowOrder } from '../../services/businessFlowApi';

const order: BusinessFlowOrder = {
  catalogId: 'hist-catalog-008',
  orderId: 'SO-HIST-008',
  productName: 'HDMI 线缆',
  status: '已验收',
  taskId: 'task-hist-008',
  runnable: true,
};

const snapshot: TrackingSnapshot = {
  task_id: 'task-hist-008',
  status: 'success',
  module_runs: [
    { module: 'm1', status: 'done' },
    { module: 'm2', status: 'done' },
    { module: 'm3', status: 'done' },
    { module: 'm4', status: 'done' },
    { module: 'm5', status: 'running' },
  ],
  entities: [
    { entity_id: 'bom-1', entity_type: 'bom', module: 'm2', status: 'done', metadata: { bom_lines: [{}] } },
    { entity_id: 'plan-1', entity_type: 'procurement_plan', module: 'm3', status: 'done', metadata: { shortage_lines: 2 } },
    { entity_id: 'sugg-1', entity_type: 'purchase_suggestion', module: 'm4', status: 'done' },
  ],
  events: [],
};

describe('businessFlowProgress', () => {
  it('maps an empty snapshot to idle', () => {
    const progress = buildModuleProgress('m1', undefined, order);
    expect(progress.status).toBe('idle');
    expect(progress.progressPercent).toBe(0);
    expect(progress.items).toHaveLength(0);
  });

  it('derives M1 success from module run and shows file', () => {
    const progress = buildModuleProgress('m1', snapshot, order);
    expect(progress.status).toBe('success');
    expect(progress.progressPercent).toBe(100);
    expect(progress.items[0]).toMatchObject({ label: '订单文件识别', status: 'success' });
  });

  it('shows M2 BOM line count', () => {
    const progress = buildModuleProgress('m2', snapshot, order);
    expect(progress.status).toBe('success');
    const item = progress.items.find((value) => value.label === '历史 BOM 匹配');
    expect(item?.detail).toBe('1 行 BOM 物料');
  });

  it('shows M3 shortage as waiting_human when shortage_lines > 0', () => {
    const progress = buildModuleProgress('m3', snapshot, order);
    const item = progress.items.find((value) => value.label === '缺料');
    expect(item?.status).toBe('waiting_human');
    expect(item?.detail).toBe('2 项缺料');
  });

  it('shows M4 suggestion count', () => {
    const progress = buildModuleProgress('m4', snapshot, order);
    expect(progress.status).toBe('success');
    expect(progress.items[0]).toMatchObject({ label: '采购建议入库', status: 'success' });
  });

  it('shows M5 running status', () => {
    const progress = buildModuleProgress('m5', snapshot, order);
    expect(progress.status).toBe('running');
    expect(progress.progressPercent).toBe(55);
  });

  it('exports status labels and colors', () => {
    expect(statusLabel.running).toBe('运行中');
    expect(statusColor.success).toBe('success');
  });
});
