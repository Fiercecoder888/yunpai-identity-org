import type { TrackingSnapshot } from '../../services/trackingSnapshotApi';
import type { BusinessFlowOrder } from '../../services/businessFlowApi';

export type ModuleFlowStatus = 'idle' | 'running' | 'success' | 'failed' | 'waiting_human';

export type ModuleProgressItem = {
  label: string;
  detail: string;
  status: ModuleFlowStatus;
};

export type ModuleProgress = {
  status: ModuleFlowStatus;
  progressPercent: number;
  items: ModuleProgressItem[];
};

export const statusColor: Record<ModuleFlowStatus, string> = {
  idle: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  waiting_human: 'warning',
};

export const statusLabel: Record<ModuleFlowStatus, string> = {
  idle: '待启动',
  running: '运行中',
  success: '已完成',
  failed: '失败',
  waiting_human: '需人工',
};

const runStatusToFlow = (status: string | undefined): ModuleFlowStatus => {
  if (!status) return 'idle';
  const value = status.toLowerCase();
  if (value === 'ok' || value === 'done' || value === 'success' || value === 'completed' || value === 'published') {
    return 'success';
  }
  if (value === 'failed' || value === 'error' || value === 'cancelled') {
    return 'failed';
  }
  if (value === 'waiting_human' || value === 'needs_review' || value === 'pending' || value === 'blocked') {
    return 'waiting_human';
  }
  if (value === 'queued' || value === 'running' || value === 'processing') {
    return 'running';
  }
  return 'idle';
};

const statusProgressPercent: Record<ModuleFlowStatus, number> = {
  idle: 0,
  running: 55,
  success: 100,
  failed: 100,
  waiting_human: 75,
};

function extractOrderFields(snapshot: TrackingSnapshot | undefined): Record<string, unknown> {
  const entities = snapshot?.entities ?? [];
  return entities.reduce<Record<string, unknown>>((acc, entity) => {
    if (entity.metadata && typeof entity.metadata === 'object') {
      Object.assign(acc, entity.metadata);
    }
    return acc;
  }, {});
}

export function buildModuleProgress(
  module: string,
  snapshot: TrackingSnapshot | undefined,
  order: BusinessFlowOrder | undefined,
): ModuleProgress {
  if (!snapshot) {
    return { status: 'idle', progressPercent: 0, items: [] };
  }
  const moduleRun = snapshot.module_runs?.find((run) => run.module === module);
  const status = runStatusToFlow(moduleRun?.status);
  const fields = extractOrderFields(snapshot);
  const moduleEntities = (snapshot.entities ?? []).filter(
    (entity) =>
      entity.module === module ||
      (entity.metadata && typeof entity.metadata === 'object' && String(entity.metadata.module ?? '') === module),
  );
  const items: ModuleProgressItem[] = [];

  switch (module) {
    case 'm1': {
      const filename = order?.orderId ?? String(fields.filename ?? '');
      items.push({
        label: '订单文件识别',
        detail: filename ? `文件：${filename}` : '暂无文件',
        status: status === 'success' ? 'success' : status === 'failed' ? 'failed' : 'running',
      });
      const confidence = fields.overall_confidence ?? fields.confidence;
      if (typeof confidence === 'number') {
        items.push({ label: '识别置信度', detail: `${(confidence * 100).toFixed(1)}%`, status: 'success' });
      }
      break;
    }
    case 'm2': {
      const bomLines = moduleEntities.find((entity) => entity.entity_type === 'bom')?.metadata?.bom_lines;
      const lines = Array.isArray(bomLines) ? bomLines.length : fields.bom_lines;
      items.push({
        label: '历史 BOM 匹配',
        detail: lines !== undefined ? `${lines} 行 BOM 物料` : '暂无 BOM',
        status,
      });
      const openQuestions = Array.isArray(fields.open_questions) ? fields.open_questions.length : 0;
      if (openQuestions > 0) {
        items.push({ label: '开放问题', detail: `${openQuestions} 项待人工确认`, status: 'waiting_human' });
      }
      break;
    }
    case 'm3': {
      const shortageLines = fields.shortage_lines ?? fields.order_shortage_qty;
      const planLines = fields.plan_lines ?? fields.total_lines;
      items.push({
        label: '物料需求计算',
        detail: planLines !== undefined ? `${planLines} 行计划` : '暂无计划',
        status,
      });
      if (shortageLines !== undefined) {
        const count = Number(shortageLines);
        items.push({
          label: '缺料',
          detail: `${count} 项缺料`,
          status: count > 0 ? 'waiting_human' : 'success',
        });
      }
      break;
    }
    case 'm4': {
      const suggestions = Array.isArray(fields.suggestions)
        ? fields.suggestions.length
        : Array.isArray(fields.valid_rows)
          ? fields.valid_rows.length
          : undefined;
      items.push({
        label: '采购建议入库',
        detail: suggestions !== undefined ? `${suggestions} 条建议` : '暂无采购建议',
        status,
      });
      break;
    }
    case 'm5': {
      const operations = fields.operations ?? fields.scheduled_operation_count;
      items.push({
        label: '生产排程',
        detail: operations !== undefined ? `${operations} 个工序` : '暂无排程',
        status,
      });
      const planVersion = fields.plan_version;
      if (planVersion) {
        items.push({ label: '计划版本', detail: String(planVersion), status: 'success' });
      }
      break;
    }
    default:
      items.push({ label: module.toUpperCase(), detail: statusLabel[status], status });
  }

  return { status, progressPercent: statusProgressPercent[status], items };
}

export function getTaskIdFromOrder(order: BusinessFlowOrder | undefined, savedRuns: Record<string, { task_id?: string }>): string | undefined {
  return order?.taskId ?? (order ? savedRuns[order.catalogId]?.task_id : undefined);
}
