import { Tag } from 'antd';
import { statusColor, statusLabel } from './status/statusRegistry';

const segmentBackground = (color: string) => (color === 'default' ? '#9ca3af' : color);

type StatusTagProps = {
  value: string;
  variant?: 'single' | 'risk';
  /** variant="risk" 时的风险段值；缺省时第一段与 value 相同。 */
  risk?: string;
};

export function StatusTag({ value, variant = 'single', risk }: StatusTagProps) {
  if (variant === 'risk') {
    const riskValue = risk ?? value;
    return (
      <span className="risk-status-tag" data-testid="status-tag-risk">
        <span className="risk-status-tag-segment" style={{ background: segmentBackground(statusColor(riskValue)) }}>
          {statusLabel(riskValue)}
        </span>
        <span className="risk-status-tag-segment" style={{ background: segmentBackground(statusColor(value)) }}>
          {statusLabel(value)}
        </span>
      </span>
    );
  }

  return <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>;
}
