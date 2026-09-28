"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Wallet } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/format";
import { formatAmount } from "@/lib/money";

import type { ExpenseRow } from "../queries";
import { EXPENSE_CATEGORY_LABEL } from "../schemas";

/** The expense register: one row per receipt, newest first. */
export function ExpensesTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  canManage,
  filtered,
}: {
  rows: ExpenseRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  canManage: boolean;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<ExpenseRow, unknown>[]>(
    () => [
      {
        id: "reference",
        header: "Expense",
        meta: { label: "Expense", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block min-w-0">
            <span className="font-mono text-[12px] text-ink">{row.original.reference}</span>
            <span className="block max-w-[22rem] truncate text-caption text-ink-subtle">
              {row.original.description}
            </span>
          </span>
        ),
      },
      {
        id: "category",
        header: "Category",
        meta: { label: "Category", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <StatusBadge>{EXPENSE_CATEGORY_LABEL[row.original.category].toLowerCase()}</StatusBadge>
        ),
      },
      {
        id: "vendor",
        header: "Vendor",
        meta: { label: "Vendor", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-ink-muted">{row.original.vendor ?? "Not recorded"}</span>
        ),
      },
      {
        id: "date",
        header: "Date",
        meta: { label: "Date", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDate(row.original.incurredAt)}
          </span>
        ),
      },
      {
        id: "vat",
        header: "Input VAT",
        meta: {
          label: "Input VAT",
          align: "right",
          className: "hidden md:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span
            data-numeric
            className="block text-right font-mono whitespace-nowrap text-ink-muted"
          >
            {row.original.vatCentavos === 0 ? "None" : formatAmount(row.original.vatCentavos)}
          </span>
        ),
      },
      {
        id: "amount",
        header: "Amount, PHP",
        meta: { label: "Amount", align: "right", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="block text-right font-mono whitespace-nowrap text-ink">
            {formatAmount(row.original.amountCentavos)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="expenses"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="date"
      dir="desc"
      toolbar={toolbar}
      href={(row) => `/expenses/${row.id}`}
      noun={["expense", "expenses"]}
      empty={
        <EmptyState
          icon={Wallet}
          title={filtered ? "No expenses match" : "No expenses in this period"}
          description={
            filtered
              ? "Nothing in this range matches the category or search. Clear a filter to see more."
              : "Rent, payroll, ad spend and courier bills land here and flow into the profit and loss."
          }
          action={
            canManage && !filtered ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/expenses/new">
                  <Plus aria-hidden />
                  Record an expense
                </Link>
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
