import Link from "next/link";

import { formatAmount, formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { SupplierAgingRow } from "../queries";
import { AGING_BUCKET_LABEL, AGING_BUCKETS, type AgingTotals } from "../services/bill-rules";

/**
 * Payables aging: what TechGear owes, by how late it is. The strip is the
 * company total; the table splits it by supplier, largest balance first.
 * Numbers, not a chart: five buckets read faster as figures, and the finance
 * reports carry the trend charts.
 */

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

export function AgingStrip({ totals }: { totals: AgingTotals }) {
  const cells = [
    ...AGING_BUCKETS.map((bucket) => ({
      label: AGING_BUCKET_LABEL[bucket],
      value: totals[bucket],
      late: bucket !== "current",
      severe: bucket === "d61_90" || bucket === "d90_plus",
    })),
    { label: "Total owed", value: totals.total, late: false, severe: false },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell, index) => (
        <div
          key={cell.label}
          className={cn(
            "min-w-0 border-t pt-2",
            index === cells.length - 1 ? "border-hairline-strong" : "border-hairline",
          )}
        >
          <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">{cell.label}</dt>
          <dd
            data-numeric
            className={cn(
              "mt-0.5 truncate font-mono text-lead font-medium",
              cell.value === 0
                ? "text-ink-subtle"
                : cell.severe
                  ? "text-danger"
                  : cell.late
                    ? "text-warning"
                    : "text-ink",
            )}
          >
            {formatPeso(cell.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SupplierAgingTable({ rows }: { rows: SupplierAgingRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full text-body-sm">
        <thead>
          <tr className="border-b border-hairline bg-surface-1">
            <th className={`${th} text-left`}>Supplier</th>
            {AGING_BUCKETS.map((bucket) => (
              <th key={bucket} className={`${th} hidden text-right md:table-cell`}>
                {bucket === "current" ? "Not due" : AGING_BUCKET_LABEL[bucket].replace(" days", "")}
              </th>
            ))}
            <th className={`${th} text-right`}>Owed, PHP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.supplierId} className="border-b border-hairline last:border-b-0">
              <td className="px-3 py-2">
                <Link
                  href={`/purchasing/bills?supplierId=${row.supplierId}`}
                  className="text-ink hover:text-accent-strong"
                >
                  {row.supplierName}
                </Link>
                <span className="block text-caption text-ink-subtle" data-numeric>
                  {row.bills} unpaid bill{row.bills === 1 ? "" : "s"}
                </span>
              </td>
              {AGING_BUCKETS.map((bucket) => (
                <td
                  key={bucket}
                  data-numeric
                  className={cn(
                    "hidden px-3 py-2 text-right font-mono md:table-cell",
                    row[bucket] === 0
                      ? "text-ink-subtle"
                      : bucket === "current"
                        ? "text-ink"
                        : bucket === "d1_30"
                          ? "text-warning"
                          : "text-danger",
                  )}
                >
                  {row[bucket] === 0 ? "0" : formatAmount(row[bucket])}
                </td>
              ))}
              <td data-numeric className="px-3 py-2 text-right font-mono font-medium text-ink">
                {formatAmount(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
