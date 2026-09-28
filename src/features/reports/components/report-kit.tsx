import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Download, Minus } from "lucide-react";

import { Sparkline } from "@/components/charts/sparkline";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { changeBps } from "../services/date-range";

/**
 * The pieces every report page is built from. Server components: nothing here
 * needs the browser, so a report is HTML the moment it arrives.
 */

// ------------------------------------------------------------------- delta

/**
 * A signed change against the comparison period. Colour follows whether the
 * move is good (more revenue is, more cost is not), and an arrow plus the
 * sign carry the direction for anyone who cannot see the colour.
 */
export function Delta({
  current,
  previous,
  upIsGood = true,
  against,
  className,
}: {
  current: number;
  previous: number;
  upIsGood?: boolean;
  /** "vs yesterday", "vs prior period". */
  against: string;
  className?: string;
}) {
  const bps = changeBps(current, previous);
  if (bps === null) {
    return (
      <span className={cn("text-caption text-ink-subtle", className)}>
        {against ? "No prior figure to compare" : "New"}
      </span>
    );
  }
  const flat = Math.abs(bps) < 5;
  const good = flat ? null : bps > 0 === upIsGood;
  const Icon = flat ? Minus : bps > 0 ? ArrowUpRight : ArrowDownRight;
  const pct = `${bps > 0 ? "+" : bps < 0 ? "-" : ""}${(Math.abs(bps) / 100).toFixed(1)}%`;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 text-caption", className)}>
      <span
        data-numeric
        className={cn(
          "inline-flex items-center gap-0.5 font-mono font-medium",
          good === true && "text-success",
          good === false && "text-danger",
          good === null && "text-ink-subtle",
        )}
      >
        <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
        {pct}
      </span>
      <span className="text-ink-subtle">{against}</span>
    </span>
  );
}

// ------------------------------------------------------------------- tiles

export type Kpi = {
  label: string;
  value: string;
  /** Comparison, when the figure has one. */
  delta?: { current: number; previous: number; upIsGood?: boolean; against: string };
  hint?: string;
  href?: string;
  trend?: number[];
  tone?: "default" | "warning" | "critical" | "muted";
};

/**
 * Stripe's KPI anatomy at density 8: small-caps label, large value, signed
 * delta, optional bare sparkline. Hairlines above each tile instead of card
 * chrome. Values are mono with tabular figures like every other amount in
 * the app (CLAUDE.md), which also keeps a row of tiles from shimmering as the
 * range changes.
 */
export function KpiGrid({
  items,
  columns = 4,
  compare = true,
}: {
  items: Kpi[];
  columns?: 3 | 4 | 5 | 6;
  /** False when the prior period is outside recorded history: deltas are dropped. */
  compare?: boolean;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-x-6 gap-y-4",
        columns === 3 && "md:grid-cols-3",
        columns === 4 && "md:grid-cols-4",
        columns === 5 && "md:grid-cols-3 xl:grid-cols-5",
        columns === 6 && "md:grid-cols-3 xl:grid-cols-6",
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col border-t border-hairline pt-2.5">
          <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">{item.label}</dt>
          <dd
            data-numeric
            className={cn(
              "mt-1 truncate font-mono text-[1.25rem] leading-tight font-medium tracking-[-0.01em]",
              item.tone === "warning" && "text-warning",
              item.tone === "critical" && "text-danger",
              item.tone === "muted" && "text-ink-subtle",
              (!item.tone || item.tone === "default") && "text-ink",
            )}
          >
            {item.href ? (
              <Link
                href={item.href}
                className="rounded-xs hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
              >
                {item.value}
              </Link>
            ) : (
              item.value
            )}
          </dd>
          {item.delta && compare ? (
            <dd className="mt-0.5">
              <Delta {...item.delta} />
            </dd>
          ) : null}
          {item.hint ? <dd className="mt-0.5 text-caption text-ink-subtle">{item.hint}</dd> : null}
          {item.trend && item.trend.length > 1 ? (
            <dd className="mt-2">
              <Sparkline values={item.trend} label={`${item.label} trend`} />
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

// ----------------------------------------------------------------- section

export function ReportSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={id} className="text-section text-ink">
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 max-w-[70ch] text-body-sm text-ink-subtle">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A framed panel for a chart: the one place a report uses the surface ladder. */
export function ChartPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-hairline bg-canvas p-4 pb-3", className)}>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------- table

export type ReportColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Hide on narrow screens; the CSV always has every column. */
  hideBelow?: "sm" | "md" | "lg";
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

const hideClass = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
} as const;

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  footerLabel,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  empty?: string;
  /** When set, a total row is drawn from each column's `footer`. */
  footerLabel?: string;
}) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-hairline bg-surface-1">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  th,
                  column.align === "right" ? "text-right" : "text-left",
                  column.hideBelow && hideClass[column.hideBelow],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-ink-subtle">
                {empty ?? "Nothing in this period."}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-hairline last:border-b-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-numeric={column.numeric ? true : undefined}
                    className={cn(
                      "px-3 py-2 align-top",
                      column.align === "right" && "text-right",
                      column.numeric && "font-mono whitespace-nowrap",
                      column.hideBelow && hideClass[column.hideBelow],
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
        {footerLabel && rows.length > 0 ? (
          <tfoot>
            <tr className="border-t border-hairline-strong bg-surface-1 font-medium">
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  data-numeric={column.numeric ? true : undefined}
                  className={cn(
                    "px-3 py-2 text-ink",
                    column.align === "right" && "text-right",
                    column.numeric && "font-mono whitespace-nowrap",
                    column.hideBelow && hideClass[column.hideBelow],
                  )}
                >
                  {index === 0 ? footerLabel : column.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ export

/** A plain link to the export route with the page's own parameters. */
export function ExportButton({ href }: { href: string }) {
  return (
    <Button asChild variant="secondary" size="md">
      <a href={href} download>
        <Download aria-hidden />
        Export CSV
      </a>
    </Button>
  );
}

/** "Compared with Jul 31 to Aug 29, 2026", under a report heading. */
export function ComparisonNote({ text }: { text: string }) {
  return <p className="text-caption text-ink-subtle">{text}</p>;
}

/** A share as "12.4%", from basis points or a ratio of two numbers. */
export function formatShare(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export function formatBps(bps: number | null): string {
  return bps === null ? "n/a" : `${(bps / 100).toFixed(1)}%`;
}
