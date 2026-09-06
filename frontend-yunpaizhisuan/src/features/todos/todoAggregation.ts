import type { M1ReviewItem } from '../../types/api';
import type { M4Alert } from '../../schemas/m4';
import type { M5FlowDashboardItem } from '../../schemas/m5';
import type { PermissionCode } from '../../services/permissionApi';

export type TodoSource = 'm1' | 'm3' | 'm4' | 'm5';

export type TodoM3PlanSummary = {
  procurement_plan_id: string;
  order_id: string;
  project_id?: string;
  plan_version?: string;
  status?: string;
  availability_status?: string;
  line_count?: number;
  shortage_count: number;
  created_at?: string;
};

export type TodoSeverity = 'low' | 'medium' | 'high';

export type TodoItemPreview = {
  type: 'm1-field' | 'm3-plan' | 'm4-alert' | 'm5-flow';
  summary?: string;
  lines?: string[];
};

export type TodoItemAction = {
  label: string;
  link: string;
};

export type TodoItem = {
  id: string;
  source: TodoSource;
  kind: string;
  title: string;
  detail?: string;
  link: string;
  severity: TodoSeverity;
  count: number;
  done?: boolean;
  dueAt?: string;
  preview?: TodoItemPreview;
  action?: TodoItemAction;
};

export type TodoSourceMeta = {
  label: string;
  description: string;
  color: string;
};

export const todoSourceOrder: TodoSource[] = ['m1', 'm3', 'm4', 'm5'];

export const todoSourceMeta: Record<TodoSource, TodoSourceMeta> = {
  m1: { label: 'M0 解析待审', description: '识别字段人工确认', color: 'blue' },
  m3: { label: 'M3 缺料', description: '物料齐套缺口', color: 'gold' },
  m4: { label: 'M4 逾期', description: '采购交期预警', color: 'red' },
  m5: { label: 'M5 需处理', description: '排程流程关注', color: 'purple' },
};

export type TodoAggregateInput = {
  m1ReviewItems: M1ReviewItem[];
  m3Plans: TodoM3PlanSummary[];
  m4Alerts: M4Alert[];
  m5Flows: M5FlowDashboardItem[];
  permissions?: PermissionCode[];
};

const sourcePermission: Record<TodoSource, PermissionCode | null> = {
  m1: 'm1:read',
  m3: 'm4:read',
  m4: 'm4:read',
  m5: 'schedule:read',
};

export const canViewTodoSource = (permissions: PermissionCode[] | undefined, source: TodoSource): boolean => {
  const required = sourcePermission[source];
  return required == null || permissions == null || permissions.includes(required);
};

export function aggregateTodos(input: TodoAggregateInput): TodoItem[] {
  const items: TodoItem[] = [];

  const m1Pending = input.m1ReviewItems.filter((item) => item.status === 'pending');
  if (m1Pending.length > 0 && canViewTodoSource(input.permissions, 'm1')) {
    items.push({
      id: 'todo-m1-review',
      source: 'm1',
      kind: 'review_pending',
      title: `M0 文档解析待确认 ${m1Pending.length} 项`,
      detail: '识别字段置信度低于阈值，需复核确认',
      link: '/modules/m0-review',
      severity: 'high',
      count: m1Pending.length,
    });
  }

  const shortagePlans = input.m3Plans.filter((plan) => (plan.shortage_count ?? 0) > 0);
  const totalShortage = shortagePlans.reduce((sum, plan) => sum + (plan.shortage_count ?? 0), 0);
  if (shortagePlans.length > 0 && canViewTodoSource(input.permissions, 'm3')) {
    items.push({
      id: 'todo-m3-shortage',
      source: 'm3',
      kind: 'material_shortage',
      title: `M3 缺料计划 ${shortagePlans.length} 个 · 缺料 ${totalShortage} 项`,
      detail: shortagePlans.map((plan) => plan.order_id || plan.procurement_plan_id).slice(0, 5).join('、'),
      link: '/modules/m3-procurement',
      severity: 'high',
      count: totalShortage,
    });
  }

  const overdueAlerts = input.m4Alerts.filter(
    (alert) => alert.status !== 'closed' && (alert.alert_type === 'overdue' || (alert.days_overdue ?? 0) > 0),
  );
  if (overdueAlerts.length > 0 && canViewTodoSource(input.permissions, 'm4')) {
    items.push({
      id: 'todo-m4-overdue',
      source: 'm4',
      kind: 'alert_overdue',
      title: `M4 逾期采购预警 ${overdueAlerts.length} 项`,
      detail: overdueAlerts.map((alert) => `${alert.purchase_order_no} · ${alert.supplier_name}`).join('、'),
      link: '/modules/purchase-warnings',
      severity: 'high',
      count: overdueAlerts.length,
    });
  }

  const attentionFlows = input.m5Flows.filter(
    (flow) =>
      flow.overall_status === 'attention' ||
      (flow.tracking?.retry_count ?? 0) > 0 ||
      (flow.tracking?.dead_letter_count ?? 0) > 0,
  );
  if (attentionFlows.length > 0 && canViewTodoSource(input.permissions, 'm5')) {
    items.push({
      id: 'todo-m5-attention',
      source: 'm5',
      kind: 'flow_attention',
      title: `M5 流程需关注 ${attentionFlows.length} 个版本`,
      detail: attentionFlows.map((flow) => `${flow.plan_version}（${flow.progress_percent}%）`).join('、'),
      link: '/modules/m5-flow',
      severity: 'medium',
      count: attentionFlows.length,
    });
  }

  return items;
}

export const todoSourceCounts = (items: TodoItem[]): Record<TodoSource, number> => {
  const counts: Record<TodoSource, number> = { m1: 0, m3: 0, m4: 0, m5: 0 };
  items.forEach((item) => {
    counts[item.source] += item.count;
  });
  return counts;
};

export const todoTotal = (items: TodoItem[]) => items.reduce((sum, item) => sum + item.count, 0);

export function aggregateTodoItems(input: TodoAggregateInput): TodoItem[] {
  const items: TodoItem[] = [];

  if (canViewTodoSource(input.permissions, 'm1')) {
    const pending = input.m1ReviewItems.filter((item) => item.status === 'pending');
    for (const item of pending) {
      items.push({
        id: `m1-review-${item.id}`,
        source: 'm1',
        kind: 'review_pending',
        title: `${item.field} 需确认`,
        detail: `识别值：${item.recognizedValue} · 置信度 ${(item.confidence * 100).toFixed(0)}%`,
        link: '/modules/m0-review',
        severity: item.confidence < 0.7 ? 'high' : 'medium',
        count: 1,
        done: false,
        preview: {
          type: 'm1-field',
          summary: `${item.taskId} · ${item.field}`,
          lines: [`识别值：${item.recognizedValue}`, `置信度：${(item.confidence * 100).toFixed(0)}%`],
        },
        action: { label: '去处理', link: '/modules/m0-review' },
      });
    }
  }

  if (canViewTodoSource(input.permissions, 'm3')) {
    for (const plan of input.m3Plans) {
      const shortage = plan.shortage_count ?? 0;
      if (shortage <= 0) {
        continue;
      }
      items.push({
        id: `m3-shortage-${plan.procurement_plan_id}`,
        source: 'm3',
        kind: 'material_shortage',
        title: `${plan.order_id || plan.procurement_plan_id} 缺料 ${shortage} 项`,
        detail: `计划 ${plan.plan_version ?? '—'} · 齐套 ${plan.availability_status ?? '—'}`,
        link: '/modules/m3-procurement',
        severity: 'high',
        count: shortage,
        done: false,
        dueAt: plan.created_at,
        preview: {
          type: 'm3-plan',
          summary: `采购计划 ${plan.procurement_plan_id}`,
          lines: [`订单：${plan.order_id ?? '—'}`, `缺料行数：${shortage}`, `状态：${plan.status ?? '—'}`],
        },
        action: { label: '去处理', link: '/modules/m3-procurement' },
      });
    }
  }

  if (canViewTodoSource(input.permissions, 'm4')) {
    const overdueAlerts = input.m4Alerts.filter(
      (alert) => alert.status !== 'closed' && (alert.alert_type === 'overdue' || (alert.days_overdue ?? 0) > 0),
    );
    for (const alert of overdueAlerts) {
      items.push({
        id: `m4-alert-${alert.id}`,
        source: 'm4',
        kind: 'alert_overdue',
        title: `${alert.purchase_order_no} · ${alert.item_name}`,
        detail: `${alert.supplier_name} · 逾期 ${alert.days_overdue} 天`,
        link: '/modules/purchase-warnings',
        severity: 'high',
        count: 1,
        done: false,
        dueAt: alert.promised_date,
        preview: {
          type: 'm4-alert',
          summary: `${alert.purchase_order_no} · ${alert.supplier_name}`,
          lines: [`物料：${alert.item_name}（${alert.item_code}）`, `承诺日期：${alert.promised_date}`, `逾期：${alert.days_overdue} 天`],
        },
        action: { label: '去处理', link: '/modules/purchase-warnings' },
      });
    }
  }

  if (canViewTodoSource(input.permissions, 'm5')) {
    const attentionFlows = input.m5Flows.filter(
      (flow) =>
        flow.overall_status === 'attention' ||
        (flow.tracking?.retry_count ?? 0) > 0 ||
        (flow.tracking?.dead_letter_count ?? 0) > 0,
    );
    for (const flow of attentionFlows) {
      items.push({
        id: `m5-flow-${flow.plan_version}`,
        source: 'm5',
        kind: 'flow_attention',
        title: `${flow.plan_version} 需关注`,
        detail: `进度 ${flow.progress_percent}%`,
        link: '/modules/m5-flow',
        severity: 'medium',
        count: 1,
        done: false,
        dueAt: flow.updated_at,
        preview: {
          type: 'm5-flow',
          summary: `排程版本 ${flow.plan_version}`,
          lines: [
            `进度：${flow.progress_percent}%`,
            `重试：${flow.tracking?.retry_count ?? 0} · 死信：${flow.tracking?.dead_letter_count ?? 0}`,
            `更新：${flow.updated_at}`,
          ],
        },
        action: { label: '去处理', link: '/modules/m5-flow' },
      });
    }
  }

  return items;
}

export type TodoGroup = {
  source: TodoSource;
  label: string;
  description: string;
  color: string;
  count: number;
  items: TodoItem[];
};

export function aggregateTodoGroups(items: TodoItem[]): TodoGroup[] {
  return todoSourceOrder
    .map((source) => {
      const sourceItems = items.filter((item) => item.source === source);
      return {
        source,
        label: todoSourceMeta[source].label,
        description: todoSourceMeta[source].description,
        color: todoSourceMeta[source].color,
        count: sourceItems.reduce((sum, item) => sum + item.count, 0),
        items: sourceItems,
      };
    })
    .filter((group) => group.items.length > 0);
}

export const todoSourceProgress = (items: TodoItem[], isDismissed: (id: string) => boolean): Record<TodoSource, { done: number; total: number }> => {
  const progress: Record<TodoSource, { done: number; total: number }> = {
    m1: { done: 0, total: 0 },
    m3: { done: 0, total: 0 },
    m4: { done: 0, total: 0 },
    m5: { done: 0, total: 0 },
  };
  items.forEach((item) => {
    progress[item.source].total += item.count;
    if (item.done === true || isDismissed(item.id)) {
      progress[item.source].done += item.count;
    }
  });
  return progress;
};
