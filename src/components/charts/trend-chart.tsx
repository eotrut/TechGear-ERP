"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/format";
import { formatPeso, formatPesoCompact } from "@/lib/money";

import { ChartLegend, ChartTooltipCard, type TooltipRenderProps } from "./chart-tooltip";

/**
 * A measure over time, with the comparison period as a ghost line behind it
 * (Stripe's "vs. previous period"). One hue: the series is Aqua at 2px over a
 * 10% wash; the comparison is a neutral 1.5px line, never a second colour,
 * because it is the same measure, not a different one.
 *
 * The crosshair snaps to the nearest bucket and the tooltip lists both
 * periods, so nobody has to land on a 2px line. A visually hidden table
 * carries every value for screen readers; the page's own table carries them
 * for everybody else.
 */

export type TrendPoint = {
  key: string;
  /** Axis label: "Sep 28" or "Sep 2026". */
  label: string;
  value: number;
  /** The same position in the comparison period, when there is one. */
  previous?: number;
  previousLabel?: string;
};

type Format = "peso" | "count";

function formatValue(value: number, format: Format): string {
  return format === "peso" ? formatPeso(value) : formatNumber(value);
}

function formatTick(value: number, format: Format): string {
  return format === "peso" ? formatPesoCompact(value) : formatNumber(value);
}

export function TrendChart({
  data,
  seriesLabel,
  previousLabel = "Previous period",
  format = "peso",
  height = 240,
  caption,
}: {
  data: TrendPoint[];
  seriesLabel: string;
  previousLabel?: string;
  format?: Format;
  height?: number;
  caption: string;
}) {
  const hasPrevious = data.some((point) => point.previous !== undefined);

  function renderTooltip({ active, payload }: TooltipRenderProps) {
    const point = payload?.[0]?.payload as TrendPoint | undefined;
    if (!active || !point) return null;
    return (
      <ChartTooltipCard
        rows={[
          {
            key: "current",
            label: point.label,
            value: formatValue(point.value, format),
            color: "var(--chart-1)",
          },
          ...(point.previous !== undefined
            ? [
                {
                  key: "previous",
                  label: point.previousLabel ?? previousLabel,
                  value: formatValue(point.previous, format),
                  color: "var(--chart-compare)",
                  muted: true,
                },
              ]
            : []),
        ]}
      />
    );
  }

  return (
    <figure className="flex flex-col gap-2">
      {hasPrevious ? (
        <ChartLegend
          items={[
            { label: seriesLabel, color: "var(--chart-1)", shape: "line" },
            { label: previousLabel, color: "var(--chart-compare)", shape: "line" },
          ]}
        />
      ) : null}
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          {/* The figure's caption is the accessible version, so the SVG is
              hidden and must not take focus either. */}
          <ComposedChart
            data={data}
            margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tick={{ fill: "var(--ink-subtle)", fontSize: 11 }}
              minTickGap={24}
              interval="preserveStartEnd"
              tickMargin={8}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-subtle)", fontSize: 11 }}
              tickFormatter={(value: number) => formatTick(value, format)}
              allowDecimals={false}
            />
            <Tooltip
              content={renderTooltip}
              cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
              isAnimationActive={false}
            />
            {hasPrevious ? (
              <Line
                dataKey="previous"
                type="monotone"
                stroke="var(--chart-compare)"
                strokeWidth={1.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ) : null}
            <Area
              dataKey="value"
              type="monotone"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="var(--chart-1)"
              fillOpacity={0.1}
              activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--canvas)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">{seriesLabel}</th>
            {hasPrevious ? <th scope="col">{previousLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{formatValue(point.value, format)}</td>
              {hasPrevious ? (
                <td>{point.previous === undefined ? "" : formatValue(point.previous, format)}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
