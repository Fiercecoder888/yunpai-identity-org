import { statusColors } from './statusColors';

const riskColorMap: Record<string, string> = {
  high: statusColors.risk,
  medium: statusColors.warning,
  low: statusColors.info,
};

const statusColorMap: Record<string, string> = {
  pending: 'default',
  need_review: statusColors.warning,
  running: statusColors.info,
  completed: statusColors.success,
  failed: statusColors.risk,
  cancelled: 'default',
};

const riskLabelMap: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

const statusLabelMap: Record<string, string> = {
  pending: '待处理',
  need_review: '待审核',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function RiskStatusTag({ risk, status }: { risk: string; status: string }) {
  const riskColor = riskColorMap[risk];
  const statusColor = statusColorMap[status];

  return (
    <span className="risk-status-tag" data-testid="risk-status-tag">
      <span
        className="risk-status-tag-segment"
        style={riskColor && riskColor !== 'default' ? { background: riskColor } : { background: '#6b7280' }}
      >
        {riskLabelMap[risk] ?? risk}
      </span>
      <span
        className="risk-status-tag-segment"
        style={statusColor && statusColor !== 'default' ? { background: statusColor } : { background: '#9ca3af' }}
      >
        {statusLabelMap[status] ?? status}
      </span>
    </span>
  );
}
