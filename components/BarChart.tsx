"use client";

import { Category } from "@/lib/daily";

// Hand-rolled horizontal bars — no charting dependency, and it prints
// exactly as it renders since it's plain SVG. When `onSelect` is given,
// rows with a service become clickable and drill into that day's list.
export default function BarChart({
  data,
  format,
  onSelect,
}: {
  data: Category[];
  format: (n: number) => string;
  onSelect?: (category: Category) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.amount));
  const rowHeight = 30;
  const labelWidth = 120;
  const valueWidth = 60;
  const chartWidth = 640;
  const barArea = chartWidth - labelWidth - valueWidth;
  const height = data.length * rowHeight;

  if (data.every((d) => d.amount === 0)) {
    return <p className="text-sm text-ink-3">Nothing recorded for this day.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${chartWidth} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Bar chart"
        style={{ maxWidth: chartWidth }}
      >
        {data.map((d, i) => {
          const y = i * rowHeight;
          const barW = Math.max(d.amount > 0 ? 2 : 0, (d.amount / max) * barArea);
          const clickable = !!onSelect && !!d.service;
          return (
            <g
              key={d.key}
              onClick={clickable ? () => onSelect!(d) : undefined}
              style={clickable ? { cursor: "pointer" } : undefined}
              className={clickable ? "group" : undefined}
            >
              {/* Full-width hit area so the label and the empty track are
                  clickable too, not just the filled part of the bar. */}
              {clickable && <rect x={0} y={y} width={chartWidth} height={rowHeight} fill="transparent" />}
              <text
                x={0}
                y={y + rowHeight / 2}
                dominantBaseline="middle"
                fontSize="12"
                fill={clickable ? "rgb(var(--ink-2))" : "rgb(var(--ink-3))"}
                className={clickable ? "group-hover:underline" : undefined}
              >
                {d.label}
              </text>
              <rect
                x={labelWidth}
                y={y + 6}
                width={barArea}
                height={rowHeight - 14}
                rx={4}
                fill="rgb(var(--surface-3))"
              />
              <rect
                x={labelWidth}
                y={y + 6}
                width={barW}
                height={rowHeight - 14}
                rx={4}
                fill={d.color}
                className={clickable ? "transition-opacity group-hover:opacity-75" : undefined}
              />
              <text
                x={chartWidth}
                y={y + rowHeight / 2}
                dominantBaseline="middle"
                textAnchor="end"
                fontSize="12"
                fontWeight="600"
                fill="rgb(var(--ink))"
              >
                {format(d.amount)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
