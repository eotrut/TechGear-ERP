import Link from "next/link";

import type { TrendPoint } from "@/components/charts/trend-chart";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatNumber } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";

import { bucketLabel, type Granularity } from "../services/date-range";
import { averageOrderValue } from "../services/measures";
import type { ChannelRow, LineGroupRow, SalesFigures, SalespersonRow } from "../services/sales";
import { formatShare, ReportTable, type ReportColumn } from "./report-kit";

/** Pieces of the sales and gross profit reports, shared with the dashboard. */

/** Buckets and their comparison buckets, aligned by position, as chart points. */
export function trendPoints<T extends { key: string }>(
  series: readonly T[],
  previous: readonly T[],
  granularity: Granularity,
  pick: (bucket: T) => number,
): TrendPoint[] {
  return series.map((bucket, index) => {
    const before = previous[index];
    return {
      key: bucket.key,
      label: bucketLabel(bucket.key, granularity),
      value: pick(bucket),
      ...(before
        ? { previous: pick(before), previousLabel: bucketLabel(before.key, granularity) }
        : {}),
    };
  });
}

/**
 * How merchandise becomes revenue. Product and category rows add up to the
 * first line; the last line is the revenue every other page reports (D-44).
 * Stripe shows gross volume to net the same way.
 */
export function RevenueBridge({ totals }: { totals: SalesFigures }) {
  const rows = [
    { label: "Merchandise", value: totals.merchandise, sign: "" },
    { label: "Shipping charged", value: totals.shipping, sign: "+" },
    { label: "Refunds", value: totals.refunds, sign: "-" },
  ];
  return (
    <dl className="flex flex-col text-body-sm">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-3 border-b border-hairline py-2"
        >
          <dt className="text-ink-muted">{row.label}</dt>
          <dd data-numeric className="font-mono text-ink">
            {row.sign === "-" && row.value > 0 ? "-" : row.sign === "+" ? "+" : ""}
            {formatAmount(row.value)}
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 py-2">
        <dt className="font-medium text-ink">Revenue</dt>
        <dd data-numeric className="font-mono font-medium text-ink">
          {formatPeso(totals.revenue)}
        </dd>
      </div>
      <p className="text-caption text-ink-subtle">
        VAT inclusive. Includes {formatPeso(totals.vat)} output VAT.
      </p>
    </dl>
  );
}

// ------------------------------------------------------------------- tables

const share = (part: number, whole: number) => (
  <span className="text-ink-subtle">{formatShare(part, whole)}</span>
);

/**
 * Everything past the top `limit` rows folds into one "other" row, so the
 * page stays scannable while the total still adds up. The CSV has every row.
 */
export function foldTail(rows: LineGroupRow[], limit: number, noun: string): LineGroupRow[] {
  if (rows.length <= limit + 1) return rows;
  const tail = rows.slice(limit);
  const other = tail.reduce<LineGroupRow>(
    (sum, row) => ({
      ...sum,
      orders: sum.orders + row.orders,
      units: sum.units + row.units,
      returned: sum.returned + row.returned,
      merchandise: sum.merchandise + row.merchandise,
      cost: sum.cost + row.cost,
    }),
    {
      id: "__other",
      name: `${tail.length} other ${noun}`,
      detail: "Export the report for every row",
      orders: 0,
      units: 0,
      returned: 0,
      merchandise: 0,
      cost: 0,
    },
  );
  return [...rows.slice(0, limit), other];
}

export function LineGroupTable({
  rows: allRows,
  kind,
  merchandiseTotal,
  limit,
}: {
  rows: LineGroupRow[];
  kind: "product" | "category";
  merchandiseTotal: number;
  limit?: number;
}) {
  const rows = limit
    ? foldTail(allRows, limit, kind === "product" ? "products" : "categories")
    : allRows;
  const sum = (pick: (row: LineGroupRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const columns: ReportColumn<LineGroupRow>[] = [
    {
      key: "name",
      header: kind === "product" ? "Product" : "Category",
      cell: (row) =>
        kind === "product" && row.id !== "__other" ? (
          <>
            <Link href={`/products/${row.id}`} className="text-ink hover:text-accent-strong">
              {row.name}
            </Link>
            {row.detail ? (
              <span className="block text-caption text-ink-subtle">{row.detail}</span>
            ) : null}
          </>
        ) : (
          <>
            <span className={row.id === "__other" ? "text-ink-muted" : "text-ink"}>{row.name}</span>
            {row.detail ? (
              <span className="block text-caption text-ink-subtle">{row.detail}</span>
            ) : null}
          </>
        ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (row) => formatNumber(row.orders),
      footer: null,
    },
    {
      key: "units",
      header: "Units",
      align: "right",
      numeric: true,
      cell: (row) => formatNumber(row.units),
      footer: formatNumber(sum((r) => r.units)),
    },
    {
      key: "returned",
      header: "Returned",
      align: "right",
      numeric: true,
      hideBelow: "lg",
      cell: (row) =>
        row.returned === 0 ? (
          <span className="text-ink-subtle">0</span>
        ) : (
          formatNumber(row.returned)
        ),
      footer: formatNumber(sum((r) => r.returned)),
    },
    {
      key: "merchandise",
      header: "Merchandise, PHP",
      align: "right",
      numeric: true,
      cell: (row) => formatAmount(row.merchandise),
      footer: formatAmount(sum((r) => r.merchandise)),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      numeric: true,
      hideBelow: "sm",
      cell: (row) => share(row.merchandise, merchandiseTotal),
      footer: "100%",
    },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      caption={kind === "product" ? "Sales by product" : "Sales by category"}
      footerLabel="Total merchandise"
      empty="No sales in this period."
    />
  );
}

export function ChannelTable({
  rows,
  revenueTotal,
  showMargin = false,
}: {
  rows: ChannelRow[];
  revenueTotal: number;
  showMargin?: boolean;
}) {
  const sum = (pick: (row: ChannelRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const columns: ReportColumn<ChannelRow>[] = [
    { key: "channel", header: "Channel", cell: (row) => CHANNEL_LABEL[row.channel] },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      numeric: true,
      cell: (row) => formatNumber(row.orders),
      footer: formatNumber(sum((r) => r.orders)),
    },
    {
      key: "aov",
      header: "Avg order, PHP",
      align: "right",
      numeric: true,
      hideBelow: "md",
      cell: (row) => formatAmount(averageOrderValue(row.revenue, row.orders)),
      footer: formatAmount(
        averageOrderValue(
          sum((r) => r.revenue),
          sum((r) => r.orders),
        ),
      ),
    },
    ...(showMargin
      ? ([
          {
            key: "netSales",
            header: "Net sales, PHP",
            align: "right",
            numeric: true,
            hideBelow: "lg",
            cell: (row) => formatAmount(row.netSales),
            footer: formatAmount(sum((r) => r.netSales)),
          },
          {
            key: "grossProfit",
            header: "Gross profit, PHP",
            align: "right",
            numeric: true,
            hideBelow: "sm",
            cell: (row) => formatAmount(row.grossProfit),
            footer: formatAmount(sum((r) => r.grossProfit)),
          },
          {
            key: "margin",
            header: "Margin",
            align: "right",
            numeric: true,
            cell: (row) => formatShare(row.grossProfit, row.netSales),
            footer: formatShare(
              sum((r) => r.grossProfit),
              sum((r) => r.netSales),
            ),
          },
        ] satisfies ReportColumn<ChannelRow>[])
      : ([
          {
            key: "revenue",
            header: "Revenue, PHP",
            align: "right",
            numeric: true,
            cell: (row) => formatAmount(row.revenue),
            footer: formatAmount(sum((r) => r.revenue)),
          },
          {
            key: "share",
            header: "Share",
            align: "right",
            numeric: true,
            hideBelow: "sm",
            cell: (row) => share(row.revenue, revenueTotal),
            footer: "100%",
          },
        ] satisfies ReportColumn<ChannelRow>[])),
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.channel}
      caption="Sales by channel"
      footerLabel="Total"
      empty="No sales in this period."
    />
  );
}

export function SalespersonTable({
  rows,
  revenueTotal,
}: {
  rows: SalespersonRow[];
  revenueTotal: number;
}) {
  const columns: ReportColumn<SalespersonRow>[] = [
    {
      key: "name",
      header: "Salesperson",
      cell: (row) => (
        <span className={row.userId ? "text-ink" : "text-ink-subtle"}>{row.name}</span>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      numeric: true,
      cell: (row) => formatNumber(row.orders),
    },
    {
      key: "aov",
      header: "Avg order, PHP",
      align: "right",
      numeric: true,
      hideBelow: "sm",
      cell: (row) => formatAmount(averageOrderValue(row.revenue, row.orders)),
    },
    {
      key: "revenue",
      header: "Revenue, PHP",
      align: "right",
      numeric: true,
      cell: (row) => formatAmount(row.revenue),
    },
    {
      key: "share",
      header: "Share",
      align: "right",
      numeric: true,
      hideBelow: "sm",
      cell: (row) => share(row.revenue, revenueTotal),
    },
  ];
  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.userId ?? "unassigned"}
      caption="Sales by salesperson"
      empty="No sales in this period."
    />
  );
}
