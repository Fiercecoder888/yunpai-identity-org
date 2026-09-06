type MiniSparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  label?: string;
};

const buildPoints = (values: number[], width: number, height: number, strokeWidth: number) => {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin || 1;
  const stepX = values.length > 1 ? (width - strokeWidth) / (values.length - 1) : 0;
  const usableHeight = height - strokeWidth;
  return values.map((value, index) => {
    const x = strokeWidth / 2 + index * stepX;
    const y = strokeWidth / 2 + ((rawMax - value) / range) * usableHeight;
    return [x, y] as const;
  });
};

export function MiniSparkline({
  values,
  width = 96,
  height = 28,
  color = '#1677ff',
  strokeWidth = 1.5,
  label,
}: MiniSparklineProps) {
  if (values.length === 0) {
    return null;
  }

  const points = buildPoints(values, width, height, strokeWidth);
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const area = first && last ? `${line} L ${last[0].toFixed(2)},${height} L ${first[0].toFixed(2)},${height} Z` : '';

  return (
    <svg
      className="yp-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label ?? `趋势 ${values.join('、')}`}
    >
      {area ? <polygon points={area} fill={color} opacity={0.12} /> : null}
      <polyline points={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
