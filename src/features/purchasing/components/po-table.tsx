"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { formatAmount } from "@/lib/money";

import type { PoListRow } from "../queries";
import { PoStatusBadge } from "./badges";

/** Purchase orders, newest first. A row opens the PO. */

export function PoTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  filtered,
  canCreate,
}: {
  rows: PoListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  filtered: boolean;
  canCreate: boolean;
}) {
  const columns = useMemo<ColumnDef<PoListRow, unknown>[]>(
    () => [
      {
        id: "poNumber",
        header: "PO",
        meta: { label: "PO number", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Link
            href={`/purchasing/${row.original.id}`}
            className="font-mono text-[12px] whitespace-nowrap text-ink hover:text-accent-strong"
          >
            {row.original.poNumber}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => <PoStatusBadge status={row.original.status} />,
      },
      {
        id: "supplier",
        header: "Supplier",
        meta: { label: "Supplier", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block max-w-[16rem] truncate text-ink">{row.original.supplierName}</span>
        ),
      },
      {
        id: "warehouse",
        header: "Into",
        meta: {
          label: "Receiving warehouse",
          className: "hidden xl:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-ink-muted">{row.original.warehouseCode}</span>
        ),
      },
      {
        id: "ordered",
        header: "Ordered",
        meta: { label: "Order date", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDate(row.original.orderDate)}
          </span>
        ),
      },
      {
        id: "expected",
        header: "Expected",
        meta: { label: "Expected", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.expectedDate ? (
            <span
              data-numeric
              className={
                row.original.overdue
                  ? "font-mono text-[12px] whitespace-nowrap text-danger"
                  : "font-mono text-[12px] whitespace-nowrap text-ink-muted"
              }
            >
              {formatDate(row.original.expectedDate)}
              {row.original.overdue ? <span className="sr-only"> (overdue)</span> : null}
            </span>
          ) : (
            <span className="text-caption text-ink-subtle">not set</span>
          ),
      },
      {
        id: "units",
        header: "Received",
        meta: { label: "Units received", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => {
          const { unitsReceived, unitsOrdered, status } = row.original;
          if (status === "DRAFT" || status === "CANCELLED") {
            return (
              <span data-numeric className="font-mono whitespace-nowrap text-ink-subtle">
                {unitsOrdered} <span className="font-sans text-caption">ordered</span>
              </span>
            );
          }
          return (
            <span data-numeric className="font-mono whitespace-nowrap text-ink">
              {unitsReceived}
              <span className="text-ink-subtle"> / {unitsOrdered}</span>
            </span>
          );
        },
      },
      {
        id: "total",
        header: "Total, PHP",
        meta: { label: "Total", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono whitespace-nowrap text-ink">
            {formatAmount(row.original.totalCentavos)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="purchase-orders"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="orderDate"
      dir="desc"
      toolbar={toolbar}
      href={(row) => `/purchasing/${row.id}`}
      noun={["purchase order", "purchase orders"]}
      empty={
        <EmptyState
          icon={FileText}
          title={filtered ? "No purchase orders match" : "No purchase orders yet"}
          description={
            filtered
              ? "Nothing in this view. Clear the search or pick another tab."
              : "Raise a purchase order to restock. Receiving it adds the stock and updates each item's average cost."
          }
          action={
            filtered || !canCreate ? undefined : (
              <Button asChild variant="primary" size="sm">
                <Link href="/purchasing/new">New purchase order</Link>
              </Button>
            )
          }
        />
      }
    />
  );
}
