"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeftRight, BellOff } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";

import type { AlertRow } from "../queries";
import { StockStatusBadge } from "./badges";
import { ReorderLevelDialog } from "./reorder-level-dialog";

/**
 * Stock alerts, one row per warehouse position that is out or at its reorder
 * point. Where another warehouse holds more than it needs, the row offers a
 * transfer prefilled with the quantity; otherwise the fix is a purchase,
 * which the reorder view sizes.
 */

function Units({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <span data-numeric className={muted ? "font-mono text-ink-subtle" : "font-mono text-ink"}>
      {value.toLocaleString("en-PH")}
    </span>
  );
}

function transferHref(row: AlertRow): string | null {
  if (!row.rebalance) return null;
  const params = new URLSearchParams({
    from: row.rebalance.fromWarehouseId,
    to: row.warehouseId,
    variantId: row.variantId,
    qty: String(row.rebalance.qty),
  });
  return `/inventory/transfers/new?${params.toString()}`;
}

export function AlertsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  canTransfer,
  canSetReorder,
  toolbar,
  filtered,
}: {
  rows: AlertRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  canTransfer: boolean;
  canSetReorder: boolean;
  toolbar: React.ReactNode;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<AlertRow, unknown>[]>(() => {
    const defs: ColumnDef<AlertRow, unknown>[] = [
      {
        id: "item",
        header: "Item",
        meta: { label: "Item", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="max-w-[10rem] min-w-0 sm:max-w-[16rem] xl:max-w-[20rem]">
            <Link
              href={`/inventory/ledger?variantId=${row.original.variantId}`}
              className="block truncate font-medium text-ink hover:text-accent-strong"
            >
              {row.original.productName}
            </Link>
            <span className="block truncate text-caption text-ink-subtle">
              {row.original.optionSummary}{" "}
              <span className="font-mono text-[11px]">{row.original.sku}</span>
            </span>
            <span className="block font-mono text-[11px] text-ink-muted xl:hidden">
              {row.original.warehouseCode}
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
        id: "available",
        header: "Available",
        meta: { label: "Available", align: "right", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono font-medium text-ink">
            {row.original.available.toLocaleString("en-PH")}
          </span>
        ),
      },
      {
        id: "reorder",
        header: "Reorder at",
        meta: {
          label: "Reorder at",
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => <Units value={row.original.reorderLevel} muted />,
      },
      {
        id: "sold",
        header: "Sold 30d",
        meta: {
          label: "Sold, last 30 days",
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Units value={row.original.soldInWindow} muted={row.original.soldInWindow === 0} />
        ),
      },
      {
        id: "cover",
        header: "Cover",
        meta: {
          label: "Days of cover",
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.daysOfCover === null ? (
            <span className="text-caption whitespace-nowrap text-ink-subtle">no sales</span>
          ) : (
            <span data-numeric className="font-mono whitespace-nowrap text-ink-muted">
              {row.original.daysOfCover} d
            </span>
          ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status" } satisfies ColumnMeta,
        cell: ({ row }) => <StockStatusBadge status={row.original.level} />,
      },
      {
        id: "action",
        header: "Suggested fix",
        meta: { label: "Suggested fix", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => {
          const href = canTransfer ? transferHref(row.original) : null;
          if (row.original.rebalance && href) {
            return (
              <Link
                href={href}
                className="inline-flex items-center gap-1.5 text-body-sm whitespace-nowrap text-accent-strong hover:underline"
              >
                <ArrowLeftRight className="size-3.5" aria-hidden />
                Move{" "}
                <span data-numeric className="font-mono">
                  {row.original.rebalance.qty}
                </span>{" "}
                from{" "}
                <span className="font-mono text-[12px]">{row.original.rebalance.fromCode}</span>
              </Link>
            );
          }
          if (row.original.rebalance) {
            return (
              <span className="text-body-sm whitespace-nowrap text-ink-muted">
                {row.original.rebalance.qty} spare in {row.original.rebalance.fromCode}
              </span>
            );
          }
          return (
            <span className="text-body-sm whitespace-nowrap text-ink-subtle">
              Reorder from supplier
            </span>
          );
        },
      },
    ];

    if (canSetReorder) {
      defs.push({
        id: "edit",
        header: () => <span className="sr-only">Reorder point</span>,
        meta: { label: "Edit reorder point", locked: true, className: "w-9" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <ReorderLevelDialog
            variantId={row.original.variantId}
            sku={row.original.sku}
            reorderLevel={row.original.reorderLevel}
            reorderQty={row.original.reorderQty}
          />
        ),
      });
    }

    return defs;
  }, [canTransfer, canSetReorder]);

  return (
    <DataTable
      tableId="inventory-alerts"
      data={rows}
      columns={columns}
      getRowId={(row) => `${row.variantId}:${row.warehouseId}`}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="urgency"
      dir="asc"
      toolbar={toolbar}
      noun={["alert", "alerts"]}
      empty={
        <EmptyState
          icon={BellOff}
          title={filtered ? "Nothing alerting here" : "Every shelf is above its reorder point"}
          description={
            filtered
              ? "No position in this warehouse and level needs attention. Try the other warehouse or level."
              : "When a sale, adjustment or transfer takes a position to its reorder point, it appears here."
          }
        />
      }
    />
  );
}
