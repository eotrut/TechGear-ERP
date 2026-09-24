"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Boxes } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { formatAmount } from "@/lib/money";

import type { StockRow } from "../queries";
import { StockStatusBadge } from "./badges";

/**
 * Stock by variant. With no warehouse chosen the numbers are company totals
 * and each warehouse gets its own available column; choosing a warehouse
 * narrows every number to that one position. A row opens the variant's own
 * ledger, which is where the number on the row comes from.
 */

function Units({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <span data-numeric className={muted ? "font-mono text-ink-subtle" : "font-mono text-ink"}>
      {value.toLocaleString("en-PH")}
    </span>
  );
}

export function StockTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  sort,
  dir,
  warehouses,
  withCost,
  toolbar,
  filtered,
}: {
  rows: StockRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  /** Breakdown columns; empty when the list is narrowed to one warehouse. */
  warehouses: { id: string; code: string }[];
  withCost: boolean;
  toolbar: React.ReactNode;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<StockRow, unknown>[]>(() => {
    const defs: ColumnDef<StockRow, unknown>[] = [
      {
        id: "item",
        header: "Item",
        meta: { label: "Item", sortKey: "name", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="max-w-[9rem] min-w-0 sm:max-w-[16rem] xl:max-w-[22rem]">
            <Link
              href={`/products/${row.original.productId}`}
              className="block truncate font-medium text-ink hover:text-accent-strong"
            >
              {row.original.productName}
            </Link>
            <span className="block truncate text-caption text-ink-subtle">
              {row.original.optionSummary}
              {/* Below xl the SKU column gives way to the numbers. */}
              <span className="font-mono text-[11px] xl:hidden"> {row.original.sku}</span>
            </span>
          </div>
        ),
      },
      {
        id: "sku",
        header: "SKU",
        meta: {
          label: "SKU",
          sortKey: "sku",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {row.original.sku}
          </span>
        ),
      },
    ];

    for (const warehouse of warehouses) {
      defs.push({
        id: `wh-${warehouse.id}`,
        header: warehouse.code,
        meta: {
          label: `Available in ${warehouse.code}`,
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => {
          const value = row.original.byWarehouse[warehouse.id] ?? 0;
          return <Units value={value} muted={value <= 0} />;
        },
      });
    }

    defs.push(
      {
        id: "onHand",
        header: "On hand",
        meta: {
          label: "On hand",
          align: "right",
          sortKey: "onHand",
          className: "hidden md:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => <Units value={row.original.onHand} />,
      },
      {
        id: "reserved",
        header: "Reserved",
        meta: {
          label: "Reserved",
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Units value={row.original.reserved} muted={row.original.reserved === 0} />
        ),
      },
      {
        id: "available",
        header: "Available",
        meta: {
          label: "Available",
          align: "right",
          sortKey: "available",
          locked: true,
        } satisfies ColumnMeta,
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
    );

    if (withCost) {
      defs.push({
        id: "value",
        header: "Value (PHP)",
        meta: {
          label: "Value at cost",
          align: "right",
          sortKey: "value",
          className: "hidden md:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono whitespace-nowrap text-ink-muted">
            {formatAmount(row.original.valueCentavos)}
          </span>
        ),
      });
    }

    defs.push({
      id: "status",
      header: "Status",
      meta: { label: "Status", align: "right", locked: true } satisfies ColumnMeta,
      cell: ({ row }) => <StockStatusBadge status={row.original.status} />,
    });

    return defs;
  }, [warehouses, withCost]);

  return (
    <DataTable
      tableId="inventory-stock"
      data={rows}
      columns={columns}
      getRowId={(row) => row.variantId}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort={sort}
      dir={dir}
      toolbar={toolbar}
      href={(row) => `/inventory/ledger?variantId=${row.variantId}`}
      noun={["variant", "variants"]}
      empty={
        <EmptyState
          icon={Boxes}
          title={filtered ? "No stock matches these filters" : "No variants yet"}
          description={
            filtered
              ? "Nothing in the catalogue fits that search and status. Clear a filter to widen the list."
              : "Add a product with at least one variant, then receive stock against it."
          }
          action={
            filtered ? undefined : (
              <Link
                href="/products/new"
                className="text-body-sm text-accent-strong hover:underline"
              >
                Add a product
              </Link>
            )
          }
        />
      }
    />
  );
}
