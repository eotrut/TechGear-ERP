"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Wallet } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { formatAmount } from "@/lib/money";

import type { BillListRow } from "../queries";
import { AgingBadge, BillStatusBadge } from "./badges";

/** Supplier bills. Unpaid views sort by due date, oldest debt first. */

export function BillsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  filtered,
  canCreate,
}: {
  rows: BillListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  filtered: boolean;
  canCreate: boolean;
}) {
  const columns = useMemo<ColumnDef<BillListRow, unknown>[]>(
    () => [
      {
        id: "bill",
        header: "Bill",
        meta: { label: "Bill number", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block whitespace-nowrap">
            <Link
              href={`/purchasing/bills/${row.original.id}`}
              className="font-mono text-[12px] text-ink hover:text-accent-strong"
            >
              {row.original.billNumber}
            </Link>
            {row.original.supplierReference ? (
              <span className="block font-mono text-[11px] text-ink-subtle">
                {row.original.supplierReference}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => <BillStatusBadge status={row.original.status} />,
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
        id: "po",
        header: "PO",
        meta: { label: "Purchase order", className: "hidden xl:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.poId && row.original.poNumber ? (
            <Link
              href={`/purchasing/${row.original.poId}`}
              className="font-mono text-[12px] whitespace-nowrap text-ink-muted hover:text-accent-strong"
            >
              {row.original.poNumber}
            </Link>
          ) : (
            <span className="text-caption text-ink-subtle">none</span>
          ),
      },
      {
        id: "issued",
        header: "Issued",
        meta: { label: "Invoice date", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDate(row.original.issueDate)}
          </span>
        ),
      },
      {
        id: "due",
        header: "Due",
        meta: { label: "Due date", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span data-numeric className="font-mono text-[12px] text-ink-muted">
              {formatDate(row.original.dueDate)}
            </span>
            {row.original.bucket && row.original.bucket !== "current" ? (
              <AgingBadge bucket={row.original.bucket} />
            ) : null}
          </span>
        ),
      },
      {
        id: "total",
        header: "Total, PHP",
        meta: {
          label: "Total",
          align: "right",
          className: "hidden sm:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono whitespace-nowrap text-ink-muted">
            {formatAmount(row.original.totalCentavos)}
          </span>
        ),
      },
      {
        id: "balance",
        header: "Owed, PHP",
        meta: { label: "Balance owed", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span
            data-numeric
            className={
              row.original.balanceCentavos > 0
                ? "font-mono whitespace-nowrap text-ink"
                : "font-mono whitespace-nowrap text-ink-subtle"
            }
          >
            {formatAmount(row.original.balanceCentavos)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="supplier-bills"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="dueDate"
      dir="asc"
      toolbar={toolbar}
      href={(row) => `/purchasing/bills/${row.id}`}
      noun={["bill", "bills"]}
      empty={
        <EmptyState
          icon={Wallet}
          title={filtered ? "No bills in this view" : "No supplier bills yet"}
          description={
            filtered
              ? "Nothing matches. Clear the search or pick another tab."
              : "Record a supplier's invoice once goods arrive. Bills are what the payables aging is built from."
          }
          action={
            filtered || !canCreate ? undefined : (
              <Button asChild variant="primary" size="sm">
                <Link href="/purchasing/bills/new">Record a bill</Link>
              </Button>
            )
          }
        />
      }
    />
  );
}
