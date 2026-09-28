"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/format";
import { formatPeso, formatPesoCompact } from "@/lib/money";

import { ChartLegend, ChartTooltipCard, type TooltipRenderProps } from "./chart-tooltip";

/**
 * Columns per period, one or two series. A second series is only ever a
 * second measure worth comparing side by side (units in against units out),
 * and takes the warm series-2 hue the dataviz validator passed against Aqua.
 * Bars are capped at 24px with a 4px rounded data end and a 2px gap between
 * neighbours; the baseline carries a hairline so a loss month reads as below
 * zero at a glance.
 */

export type ColumnSeries = { key: string; label: string };
export type ColumnDatum = { key: string; label: string } & Record<string, number | string>;

type Format = "peso" | "count";

const COLORS = ["var(--chart-1)", "var(--chart-2)"] as const;

function formatValue(value: number, format: Format): string {
  return format === "peso" ? formatPeso(value) : formatNumber(value);
}

export function ColumnChart({
  data,
  series,
  format = "peso",
  height = 240,
  caption,
}: {
  data: ColumnDatum[];
  series: [ColumnSeries] | [ColumnSeries, ColumnSeries];
  format?: Format;
  height?: number;
  caption: string;
}) {
  const hasNegative = data.some((datum) =>
    series.some((s) => typeof datum[s.key] === "number" && (datum[s.key] as number) < 0),
  );

  function renderTooltip({ active, payload }: TooltipRenderProps) {
    const datum = payload?.[0]?.payload as ColumnDatum | undefined;
    if (!active || !datum) return null;
    return (
      <ChartTooltipCard
        title={datum.label}
        rows={series.map((s, index) => ({
          key: s.key,
          label: s.label,
          value: formatValue(Number(datum[s.key] ?? 0), format),
          color: COLORS[index] ?? COLORS[0],
        }))}
      />
    );
  }

  return (
    <figure className="flex flex-col gap-2">
      {series.length > 1 ? (
        <ChartLegend
          items={series.map((s, index) => ({
            label: s.label,
            color: COLORS[index] ?? COLORS[0],
            shape: "square" as const,
          }))}
        />
      ) : null}
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer={false}
            data={data}
            margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap="24%"
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--chart-axis)" }}
              tick={{ fill: "var(--ink-subtle)", fontSize: 11 }}
              minTickGap={16}
              interval="preserveStartEnd"
              tickMargin={8}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--ink-subtle)", fontSize: 11 }}
              tickFormatter={(value: number) =>
                format === "peso" ? formatPesoCompact(value) : formatNumber(value)
              }
              allowDecimals={false}
            />
            {hasNegative ? <ReferenceLine y={0} stroke="var(--chart-axis)" /> : null}
            <Tooltip
              content={renderTooltip}
              cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
              isAnimationActive={false}
            />
            {series.map((s, index) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={COLORS[index] ?? COLORS[0]}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key}>
              <th scope="row">{datum.label}</th>
              {series.map((s) => (
                <td key={s.key}>{formatValue(Number(datum[s.key] ?? 0), format)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
