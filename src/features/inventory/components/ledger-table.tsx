"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { formatDateTime } from "@/lib/format";
import { formatAmount } from "@/lib/money";

import type { LedgerRow, LedgerSource } from "../queries";
import { STOCK_REASON_LABEL } from "../schemas";
import { MovementBadge, QtyDelta } from "./badges";

/**
 * The stock ledger: every movement, newest first, each with the balance it
 * left behind. Reading down a filtered variant is reading its running balance
 * backwards, which is the whole point of storing `balanceAfter`.
 *
 * Source documents link where their page exists. Orders, receipts and returns
 * are shown by number until their modules land, rather than linking to a 404.
 */

function sourceHref(source: LedgerSource): string | null {
  if (source.kind === "adjustment") return `/inventory/adjustments/${source.id}`;
  if (source.kind === "transfer") return `/inventory/transfers/${source.id}`;
  return null;
}

function Source({ row }: { row: LedgerRow }) {
  const reason = STOCK_REASON_LABEL[row.reason] ?? row.reason;
  if (!row.source) {
    return <span className="text-caption text-ink-subtle">{reason}</span>;
  }
  const href = sourceHref(row.source);
  return (
    <span className="block whitespace-nowrap">
      {href ? (
        <Link href={href} className="font-mono text-[12px] text-accent-strong hover:underline">
          {row.source.label}
        </Link>
      ) : (
        <span className="font-mono text-[12px] text-ink-muted">{row.source.label}</span>
      )}
      <span className="block text-caption text-ink-subtle">{reason}</span>
    </span>
  );
}

export function LedgerTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  withCost,
  toolbar,
  filtered,
}: {
  rows: LedgerRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  withCost: boolean;
  toolbar: React.ReactNode;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<LedgerRow, unknown>[]>(() => {
    const defs: ColumnDef<LedgerRow, unknown>[] = [
      {
        id: "when",
        header: "When",
        meta: { label: "When", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <>
            <time
              dateTime={new Date(row.original.occurredAt).toISOString()}
              className="font-mono text-[12px] whitespace-nowrap text-ink-muted"
              data-numeric
            >
              {formatDateTime(row.original.occurredAt)}
            </time>
            {/* The item column is hidden on a phone; keep the SKU in view. */}
            <span className="block font-mono text-[11px] text-ink-subtle sm:hidden">
              {row.original.sku} {row.original.warehouseCode}
            </span>
          </>
        ),
      },
      {
        id: "type",
        header: "Type",
        meta: { label: "Type", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => <MovementBadge type={row.original.type} />,
      },
      {
        id: "item",
        header: "Item",
        meta: { label: "Item", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="max-w-[11rem] min-w-0 xl:max-w-[18rem]">
            <Link
              href={`/inventory/ledger?variantId=${row.original.variantId}`}
              className="block truncate text-ink hover:text-accent-strong"
              title={`${row.original.productName}, ${row.original.optionSummary}`}
            >
              {row.original.productName}
            </Link>
            <span className="block truncate font-mono text-[11px] text-ink-subtle">
              {row.original.sku}
              <span className="xl:hidden"> {row.original.warehouseCode}</span>
            </span>
          </div>
        ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        meta: { label: "Warehouse", className: "hidden xl:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {row.original.warehouseCode}
          </span>
        ),
      },
      {
        id: "qty",
        header: "Qty",
        meta: { label: "Quantity", align: "right", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => <QtyDelta value={row.original.qtyDelta} />,
      },
      {
        id: "balance",
        header: "Balance",
        meta: { label: "Balance after", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-ink-muted">
            {row.original.balanceAfter.toLocaleString("en-PH")}
          </span>
        ),
      },
    ];

    if (withCost) {
      defs.push({
        id: "cost",
        header: "Unit cost",
        meta: {
          label: "Unit cost",
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono whitespace-nowrap text-ink-subtle">
            {formatAmount(row.original.unitCostCentavos)}
          </span>
        ),
      });
    }

    defs.push(
      {
        id: "source",
        header: "Source",
        meta: { label: "Source", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => <Source row={row.original} />,
      },
      {
        id: "actor",
        header: "By",
        meta: { label: "Recorded by", className: "hidden xl:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-caption whitespace-nowrap text-ink-subtle">
            {row.original.actorName ?? "System"}
          </span>
        ),
      },
    );

    return defs;
  }, [withCost]);

  return (
    <DataTable
      tableId="inventory-ledger"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="occurredAt"
      dir="desc"
      toolbar={toolbar}
      noun={["movement", "movements"]}
      empty={
        <EmptyState
          icon={ScrollText}
          title={filtered ? "No movements match these filters" : "The ledger is empty"}
          description={
            filtered
              ? "Nothing moved that fits this search, type and date range. Widen the dates or clear a filter."
              : "Every receipt, sale, return, adjustment and transfer lands here as it happens."
          }
        />
      }
    />
  );
}
