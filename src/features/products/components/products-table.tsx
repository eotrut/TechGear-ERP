"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { PackageSearch } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatAmount } from "@/lib/money";
import { formatRelative } from "@/lib/format";
import type { StockHealth } from "@/lib/stock-math";

import type { ProductListRow } from "../queries";
import { BulkPriceDialog } from "./bulk-price-dialog";

/**
 * The product list itself: columns, cells and the bulk bar. Everything that is
 * shared with other resource lists lives in the data-table shell instead.
 *
 * Cost and margin columns exist only for roles holding `products.viewCost`.
 * They are not rendered and then hidden: the server never sends the numbers.
 */

const STOCK_TONE: Record<StockHealth, StatusTone> = {
  in: "success",
  low: "warning",
  out: "critical",
};

const STOCK_LABEL: Record<StockHealth, string> = {
  in: "in stock",
  low: "low",
  out: "out",
};

function statusTone(status: ProductListRow["status"]): StatusTone {
  if (status === "ACTIVE") return "success";
  if (status === "DRAFT") return "info";
  return "neutral";
}

/**
 * A price range on two tight lines rather than one wrapping line: at this
 * density a wrapped range doubles the height of the row it sits in.
 */
function PriceCell({ row }: { row: ProductListRow }) {
  const single = row.minPriceCentavos === row.maxPriceCentavos;

  return (
    <span className="block whitespace-nowrap">
      <span className="font-mono text-ink">{formatAmount(row.minPriceCentavos)}</span>
      {single ? null : (
        <span className="block font-mono text-[11px] text-ink-subtle">
          to {formatAmount(row.maxPriceCentavos)}
        </span>
      )}
    </span>
  );
}

export function ProductsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  sort,
  dir,
  canViewCost,
  canBulkPrice,
  toolbar,
}: {
  rows: ProductListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  sort: string;
  dir: "asc" | "desc";
  canViewCost: boolean;
  canBulkPrice: boolean;
  toolbar: React.ReactNode;
}) {
  const columns = useMemo<ColumnDef<ProductListRow, unknown>[]>(() => {
    const defs: ColumnDef<ProductListRow, unknown>[] = [];

    if (canBulkPrice) {
      defs.push({
        id: "select",
        meta: {
          label: "Selection",
          locked: true,
          // Below sm there is no room for both the tick and the numbers, and
          // bulk pricing is not a phone job.
          className: "hidden w-9 sm:table-cell",
        } satisfies ColumnMeta,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(Boolean(value))}
            aria-label="Select every product on this page"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
            aria-label={`Select ${row.original.name}`}
          />
        ),
      });
    }

    defs.push(
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: "Product",
        meta: { label: "Product", sortKey: "name", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative size-8 shrink-0 overflow-hidden rounded-md border border-hairline bg-surface-2">
              {row.original.imageUrl ? (
                <Image
                  src={row.original.imageUrl}
                  alt={row.original.imageAlt ?? row.original.name}
                  fill
                  sizes="32px"
                  className="object-cover"
                />
              ) : null}
            </span>
            <span className="min-w-0">
              <Link
                href={`/products/${row.original.id}`}
                className="block truncate font-medium text-ink hover:text-accent-strong"
              >
                {row.original.name}
              </Link>
              <span className="block truncate font-mono text-[11px] text-ink-subtle">
                {row.original.leadSku}
                {row.original.variantCount > 1 ? ` plus ${row.original.variantCount - 1} more` : ""}
              </span>
            </span>
          </div>
        ),
      },
      {
        id: "category",
        accessorFn: (row) => row.categoryName,
        header: "Category",
        meta: {
          label: "Category",
          sortKey: "category",
          className: "hidden md:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.categoryName}</span>,
      },
      {
        id: "brand",
        accessorFn: (row) => row.brandName,
        header: "Brand",
        meta: { label: "Brand", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => <span className="text-ink-muted">{row.original.brandName}</span>,
      },
      {
        id: "variants",
        accessorFn: (row) => row.variantCount,
        header: "Variants",
        meta: {
          label: "Variants",
          align: "right",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-mono text-ink-muted">{row.original.variantCount}</span>
        ),
      },
      {
        id: "price",
        accessorFn: (row) => row.minPriceCentavos,
        header: "Price",
        meta: { label: "Price", align: "right", sortKey: "price" } satisfies ColumnMeta,
        cell: ({ row }) => <PriceCell row={row.original} />,
      },
    );

    if (canViewCost) {
      defs.push(
        {
          id: "cost",
          accessorFn: (row) => row.avgCostCentavos,
          header: "Avg cost",
          meta: {
            label: "Average cost",
            align: "right",
            className: "hidden xl:table-cell",
          } satisfies ColumnMeta,
          cell: ({ row }) => (
            <span className="font-mono text-ink-muted">
              {formatAmount(row.original.avgCostCentavos)}
            </span>
          ),
        },
        {
          id: "margin",
          accessorFn: (row) => row.marginBps ?? -1,
          header: "Margin",
          meta: {
            label: "Margin",
            align: "right",
            className: "hidden xl:table-cell",
          } satisfies ColumnMeta,
          cell: ({ row }) => {
            const bps = row.original.marginBps;
            return (
              <span className="font-mono text-ink-muted">
                {bps === null ? "n/a" : `${(bps / 100).toFixed(1)}%`}
              </span>
            );
          },
        },
      );
    }

    defs.push(
      {
        id: "stock",
        accessorFn: (row) => row.onHand,
        header: "On hand",
        meta: { label: "On hand", align: "right", sortKey: "stock" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="inline-flex items-center justify-end gap-2">
            <span className="font-mono text-ink">
              {row.original.onHand.toLocaleString("en-PH")}
            </span>
            <StatusBadge tone={STOCK_TONE[row.original.stock]}>
              {STOCK_LABEL[row.original.stock]}
            </StatusBadge>
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        meta: { label: "Status", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <StatusBadge tone={statusTone(row.original.status)}>
            {row.original.status.toLowerCase()}
          </StatusBadge>
        ),
      },
      {
        id: "updated",
        accessorFn: (row) => row.updatedAt,
        header: "Updated",
        meta: {
          label: "Updated",
          align: "right",
          sortKey: "updated",
          className: "hidden lg:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-ink-subtle">
            {formatRelative(row.original.updatedAt)}
          </span>
        ),
      },
    );

    return defs;
  }, [canBulkPrice, canViewCost]);

  return (
    <DataTable
      tableId="products"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort={sort}
      dir={dir}
      selectable={canBulkPrice}
      toolbar={toolbar}
      href={(row) => `/products/${row.id}`}
      noun={["product", "products"]}
      bulkActions={(ids, clear) => (
        <>
          <BulkPriceDialog productIds={ids} onDone={clear} />
          <Button asChild variant="ghost" size="sm">
            <a href={`/api/export/products?ids=${ids.join(",")}`}>Export selected</a>
          </Button>
        </>
      )}
      empty={
        <EmptyState
          icon={PackageSearch}
          title="No products match those filters"
          description="Widen the price range, clear the stock filter, or search by SKU instead of name."
          action={
            <Button asChild variant="secondary">
              <Link href="/products">Clear filters</Link>
            </Button>
          }
        />
      }
    />
  );
}
