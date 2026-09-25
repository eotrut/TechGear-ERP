"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { PackageCheck } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { formatAmount } from "@/lib/money";

import type { ReorderRow } from "../queries";
import { ReorderLevelDialog } from "./reorder-level-dialog";

/**
 * Reorder suggestions, company wide: what to buy and how many. Sorted by how
 * soon each SKU runs dry at its recent sales rate, so the top of the list is
 * the order to place first.
 */

function Units({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <span data-numeric className={muted ? "font-mono text-ink-subtle" : "font-mono text-ink"}>
      {value.toLocaleString("en-PH")}
    </span>
  );
}

export function ReorderTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  withCost,
  canSetReorder,
  canOrder,
  toolbar,
}: {
  rows: ReorderRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  withCost: boolean;
  canSetReorder: boolean;
  /** Links each supplier to a new PO prefilled with its suggestions. */
  canOrder: boolean;
  toolbar: React.ReactNode;
}) {
  const columns = useMemo<ColumnDef<ReorderRow, unknown>[]>(() => {
    const defs: ColumnDef<ReorderRow, unknown>[] = [
      {
        id: "item",
        header: "Item",
        meta: { label: "Item", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="max-w-[10rem] min-w-0 sm:max-w-[20rem]">
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
          </div>
        ),
      },
      {
        id: "available",
        header: "Available",
        meta: { label: "Available, all warehouses", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => <Units value={row.original.available} />,
      },
      {
        id: "onOrder",
        header: "On order",
        meta: {
          label: "On order",
          align: "right",
          className: "hidden md:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Units value={row.original.onOrder} muted={row.original.onOrder === 0} />
        ),
      },
      {
        id: "policy",
        header: "Point / batch",
        meta: {
          label: "Reorder point and batch",
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono whitespace-nowrap text-ink-subtle">
            {row.original.reorderLevel} / {row.original.reorderQty}
          </span>
        ),
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
          className: "hidden md:table-cell",
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
        id: "suggested",
        header: "Order",
        meta: { label: "Suggested order", align: "right", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono font-medium text-ink">
            {row.original.suggestedQty.toLocaleString("en-PH")}
          </span>
        ),
      },
    ];

    if (withCost) {
      defs.push({
        id: "cost",
        header: "Est. cost (PHP)",
        meta: {
          label: "Estimated cost",
          align: "right",
          className: "hidden md:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono whitespace-nowrap text-ink-muted">
            {formatAmount(row.original.estimatedCostCentavos)}
          </span>
        ),
      });
    }

    defs.push({
      id: "supplier",
      header: "Last supplier",
      meta: { label: "Last supplier", className: "hidden xl:table-cell" } satisfies ColumnMeta,
      cell: ({ row }) =>
        row.original.supplierName ? (
          <span className="block max-w-[14rem] truncate text-body-sm text-ink-muted">
            {canOrder && row.original.supplierId ? (
              <Link
                href={`/purchasing/new?supplierId=${row.original.supplierId}&reorder=1`}
                className="hover:text-accent-strong hover:underline"
                title={`Order this supplier's suggestions`}
              >
                {row.original.supplierName}
              </Link>
            ) : (
              row.original.supplierName
            )}
            {row.original.leadTimeDays !== null ? (
              <span className="text-caption text-ink-subtle">
                , {row.original.leadTimeDays} day lead
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-caption text-ink-subtle">never ordered</span>
        ),
    });

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
  }, [withCost, canSetReorder, canOrder]);

  return (
    <DataTable
      tableId="inventory-reorder"
      data={rows}
      columns={columns}
      getRowId={(row) => row.variantId}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="cover"
      dir="asc"
      toolbar={toolbar}
      noun={["suggestion", "suggestions"]}
      empty={
        <EmptyState
          icon={PackageCheck}
          title="Nothing needs reordering"
          description="Every active variant is above its reorder point once open purchase orders are counted."
        />
      }
    />
  );
}
