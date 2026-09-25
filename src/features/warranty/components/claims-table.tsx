"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { formatDate } from "@/lib/format";

import type { ClaimListRow } from "../queries";
import { ClaimStatusBadge } from "./claim-status-badge";

/** Warranty claims, newest first. */
export function ClaimsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  filtered,
}: {
  rows: ClaimListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<ClaimListRow, unknown>[]>(
    () => [
      {
        id: "claim",
        header: "Claim",
        meta: { label: "Claim", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Link
            href={`/warranty/${row.original.id}`}
            className="font-mono text-[12px] whitespace-nowrap text-ink hover:text-accent-strong"
          >
            {row.original.claimNumber}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => <ClaimStatusBadge status={row.original.status} />,
      },
      {
        id: "item",
        header: "Item",
        meta: { label: "Item" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block max-w-[18rem]">
            <span className="block truncate text-ink">{row.original.productName}</span>
            <span className="font-mono text-[11px] text-ink-subtle">{row.original.sku}</span>
          </span>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        meta: { label: "Customer", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block max-w-[12rem] truncate text-ink-muted">
            {row.original.customerName}
          </span>
        ),
      },
      {
        id: "issue",
        header: "Issue",
        meta: { label: "Issue", className: "hidden xl:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block max-w-[22rem] truncate text-ink-muted">{row.original.issue}</span>
        ),
      },
      {
        id: "submitted",
        header: "Submitted",
        meta: { label: "Submitted", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDate(row.original.submittedAt)}
          </span>
        ),
      },
      {
        id: "covered",
        header: "Covered until",
        meta: { label: "Covered until", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDate(row.original.warrantyExpiresAt)}
          </span>
        ),
      },
      {
        id: "assignee",
        header: "Handled by",
        meta: { label: "Handled by", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.assigneeName ? (
            <span className="text-caption whitespace-nowrap text-ink-muted">
              {row.original.assigneeName}
            </span>
          ) : (
            <span className="text-caption text-ink-subtle">unassigned</span>
          ),
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="warranty-claims"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="submittedAt"
      dir="desc"
      toolbar={toolbar}
      href={(row) => `/warranty/${row.id}`}
      noun={["claim", "claims"]}
      empty={
        <EmptyState
          icon={ShieldCheck}
          title={filtered ? "No claims here" : "No warranty claims yet"}
          description={
            filtered
              ? "Nothing is at this step. The other tabs hold the rest."
              : "A claim starts from a delivered order line that is still inside its warranty."
          }
        />
      }
    />
  );
}
