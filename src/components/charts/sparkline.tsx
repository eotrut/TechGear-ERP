/**
 * A bare trend line for a KPI tile: no axis, no grid, no hover. The tile's
 * own number is the value; this only says which way it has been going.
 * Plain SVG so it renders on the server with the tile.
 */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  label: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pad = 2;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = pad + (height - pad * 2) * (1 - (value - min) / span);
    return [x, y] as const;
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="overflow-visible"
      preserveAspectRatio="none"
    >
      <polyline
        points={`0,${height} ${line} ${width},${height}`}
        fill="var(--chart-1)"
        fillOpacity={0.08}
        stroke="none"
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {last ? <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--chart-1)" /> : null}
    </svg>
  );
}
