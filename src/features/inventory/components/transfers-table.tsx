"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeftRight, ArrowRight } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

import type { TransferListRow } from "../queries";
import { TransferStatusBadge } from "./badges";

/** Transfer documents, newest first. A row opens the transfer. */

function When({ value }: { value: Date | null }) {
  if (!value) return <span className="text-caption text-ink-subtle">not yet</span>;
  return (
    <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
      {formatDate(value)}
    </span>
  );
}

export function TransfersTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  filtered,
}: {
  rows: TransferListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<TransferListRow, unknown>[]>(
    () => [
      {
        id: "reference",
        header: "Reference",
        meta: { label: "Reference", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Link
            href={`/inventory/transfers/${row.original.id}`}
            className="font-mono text-[12px] whitespace-nowrap text-ink hover:text-accent-strong"
          >
            {row.original.reference}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => <TransferStatusBadge status={row.original.status} />,
      },
      {
        id: "route",
        header: "Route",
        meta: { label: "Route", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {row.original.fromCode}
            <ArrowRight className="size-3 text-ink-subtle" aria-label="to" />
            {row.original.toCode}
          </span>
        ),
      },
      {
        id: "lines",
        header: "Lines",
        meta: {
          label: "Lines",
          align: "right",
          className: "hidden lg:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-ink-muted">
            {row.original.lines}
          </span>
        ),
      },
      {
        id: "units",
        header: "Units",
        meta: { label: "Units", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => {
          const short =
            row.original.status === "RECEIVED" && row.original.unitsReceived < row.original.units;
          return (
            <span data-numeric className="font-mono whitespace-nowrap text-ink">
              {short ? (
                <>
                  {row.original.unitsReceived}
                  <span className="text-ink-subtle"> of {row.original.units}</span>
                </>
              ) : (
                row.original.units
              )}
            </span>
          );
        },
      },
      {
        id: "created",
        header: "Created",
        meta: { label: "Created", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => <When value={row.original.createdAt} />,
      },
      {
        id: "shipped",
        header: "Dispatched",
        meta: { label: "Dispatched", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.status === "CANCELLED" && !row.original.shippedAt ? (
            <span className="text-caption text-ink-subtle">never</span>
          ) : (
            <When value={row.original.shippedAt} />
          ),
      },
      {
        id: "received",
        header: "Received",
        meta: { label: "Received", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.status === "CANCELLED" ? (
            <span className="text-caption text-ink-subtle">never</span>
          ) : (
            <When value={row.original.receivedAt} />
          ),
      },
      {
        id: "actor",
        header: "By",
        meta: { label: "Created by", className: "hidden xl:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-caption whitespace-nowrap text-ink-subtle">
            {row.original.actorName}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="inventory-transfers"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="createdAt"
      dir="desc"
      toolbar={toolbar}
      href={(row) => `/inventory/transfers/${row.id}`}
      noun={["transfer", "transfers"]}
      empty={
        <EmptyState
          icon={ArrowLeftRight}
          title={filtered ? "No transfers with this status" : "No transfers yet"}
          description={
            filtered
              ? "Nothing is in that state right now. The other tabs hold the rest."
              : "Move stock between warehouses. It leaves the source when dispatched and lands at the destination when received."
          }
          action={
            filtered ? undefined : (
              <Button asChild variant="primary" size="sm">
                <Link href="/inventory/transfers/new">New transfer</Link>
              </Button>
            )
          }
        />
      }
    />
  );
}
