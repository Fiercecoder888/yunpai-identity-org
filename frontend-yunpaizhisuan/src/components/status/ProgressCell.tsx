type ProgressCellProps = {
  percent: number;
  suffix?: string;
  color?: string;
};

export function ProgressCell({ percent, suffix, color = '#1677ff' }: ProgressCellProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <span className="progress-cell" data-testid="progress-cell">
      <span className="progress-cell-track" aria-hidden="true">
        <span className="progress-cell-fill" style={{ width: `${clamped}%`, background: color }} />
      </span>
      <span className="progress-cell-value">
        {Math.round(clamped)}%{suffix ? ` ${suffix}` : ''}
      </span>
    </span>
  );
}
