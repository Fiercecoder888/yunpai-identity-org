import type { M5FlowDashboardItem } from '../schemas/m5';
import type { AuditLogItem } from '../types/api';
import { getAuditLogs } from './auditApi';
import { getDashboardSummary } from './dashboardApi';
import { getM5FlowDashboard } from './m5Api';

export type ActivitySource = 'audit' | 'dashboard' | 'm5';

export type WorkbenchActivity = {
  id: string;
  source: ActivitySource;
  module: string;
  message: string;
  status: 'info' | 'success' | 'warning' | 'error';
  time: string;
};

const sortTimestamp = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

const toAuditActivities = (logs: AuditLogItem[]): WorkbenchActivity[] =>
  logs.map((log) => ({
    id: `audit-${log.id}`,
    source: 'audit',
    module: log.module,
    message: log.detail || log.action,
    status: log.result === 'failed' ? 'error' : log.result === 'blocked' ? 'warning' : 'success',
    time: log.time,
  }));

const toDashboardActivities = (summary: { activities: Array<{ id: string; time: string; module: string; message: string; status: 'info' | 'success' | 'warning' | 'error' }> }): WorkbenchActivity[] =>
  summary.activities.map((activity) => ({
    id: `dashboard-${activity.id}`,
    source: 'dashboard',
    module: activity.module,
    message: activity.message,
    status: activity.status,
    time: activity.time,
  }));

const toM5Activities = (flows: M5FlowDashboardItem[]): WorkbenchActivity[] =>
  flows.map((flow) => ({
    id: `m5-${flow.plan_version}`,
    source: 'm5',
    module: 'M5 排程',
    message: `${flow.plan_version} ${flow.overall_status === 'attention' ? '需关注' : flow.overall_status === 'complete' ? '已完成' : '进行中'}，进度 ${flow.progress_percent}%`,
    status: flow.overall_status === 'attention' ? 'warning' : 'success',
    time: flow.updated_at,
  }));

export async function getWorkbenchActivities(options: { limit?: number } = {}): Promise<WorkbenchActivity[]> {
  const limit = options.limit ?? 20;
  const [auditResult, dashboardResult, m5Result] = await Promise.allSettled([
    getAuditLogs(),
    getDashboardSummary(),
    getM5FlowDashboard(),
  ]);

  const activities: WorkbenchActivity[] = [];
  if (auditResult.status === 'fulfilled') {
    activities.push(...toAuditActivities(auditResult.value));
  }
  if (dashboardResult.status === 'fulfilled') {
    activities.push(...toDashboardActivities(dashboardResult.value));
  }
  if (m5Result.status === 'fulfilled') {
    activities.push(...toM5Activities(m5Result.value));
  }

  return activities
    .map((activity) => ({ activity, sortKey: sortTimestamp(activity.time) }))
    .sort((left, right) => right.sortKey - left.sortKey)
    .slice(0, limit)
    .map(({ activity }) => activity);
}
