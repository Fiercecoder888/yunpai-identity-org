type OverdueBarProps = {
  days: number;
  showDays?: boolean;
  maxRiskDays?: number;
  testId?: string;
};

export function OverdueBar({ days, showDays = true, maxRiskDays = 7, testId = 'overdue-bar' }: OverdueBarProps) {
  const level = days > maxRiskDays ? 'is-risk' : days > 0 ? 'is-warning' : 'is-ok';
  return (
    <span className="overdue-indicator">
      <span className={`overdue-bar ${level}`} data-testid={testId} />
      {showDays ? <span>{days} 天</span> : null}
    </span>
  );
}
