type RingChartProps = {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
};

export function RingChart({ percent, size = 56, strokeWidth = 6, color = '#16a34a', label }: RingChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const dash = (clamped / 100) * circumference;

  return (
    <svg
      className="yp-ring-chart"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `${percent}%`}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight={600} fill="#1f2937">
        {Math.round(clamped)}%
      </text>
    </svg>
  );
}

type MiniBarChartProps = {
  values: number[];
  labels?: string[];
  color?: string;
  label?: string;
};

export function MiniBarChart({ values, labels, color = '#1677ff', label }: MiniBarChartProps) {
  const max = Math.max(...values, 1);

  return (
    <div className="yp-mini-bar-chart" role="img" aria-label={label ?? labels?.join('、') ?? values.join('、')}>
      {values.map((value, index) => (
        <div className="yp-mini-bar-col" key={index}>
          <div className="yp-mini-bar-track">
            <div className="yp-mini-bar-fill" style={{ height: `${(value / max) * 100}%`, background: color }} />
          </div>
          {labels?.[index] ? <span className="yp-mini-bar-label">{labels[index]}</span> : null}
        </div>
      ))}
    </div>
  );
}

type StackedBarSegment = {
  key: string;
  label: string;
  count: number;
  color: string;
};

type StackedBarChartProps = {
  segments: StackedBarSegment[];
  label?: string;
};

export function StackedBarChart({ segments, label }: StackedBarChartProps) {
  const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.count, 0));

  return (
    <div className="yp-stacked-bar">
      <div className="yp-stacked-bar-track" role="img" aria-label={label ?? segments.map((s) => `${s.label} ${s.count}`).join('、')}>
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="yp-stacked-bar-segment"
            style={{ width: `${(segment.count / total) * 100}%`, background: segment.color }}
            title={`${segment.label} ${segment.count}`}
          />
        ))}
      </div>
      <div className="yp-stacked-bar-legend">
        {segments.map((segment) => (
          <span className="yp-stacked-bar-legend-item" key={segment.key}>
            <i style={{ background: segment.color }} />
            {segment.label} {segment.count}
          </span>
        ))}
      </div>
    </div>
  );
}
