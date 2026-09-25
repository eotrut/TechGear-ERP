"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { RotateCcw } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/money";

import type { ReturnListRow } from "../queries";
import { ReturnStatusBadge } from "./badges";

/** Returns, newest first. A row opens the RMA. */
export function ReturnsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  filtered,
  moneyVisible,
}: {
  rows: ReturnListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  filtered: boolean;
  moneyVisible: boolean;
}) {
  const columns = useMemo<ColumnDef<ReturnListRow, unknown>[]>(() => {
    const list: ColumnDef<ReturnListRow, unknown>[] = [
      {
        id: "rma",
        header: "RMA",
        meta: { label: "RMA", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Link
            href={`/returns/${row.original.id}`}
            className="font-mono text-[12px] whitespace-nowrap text-ink hover:text-accent-strong"
          >
            {row.original.rmaNumber}
          </Link>
        ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => <ReturnStatusBadge status={row.original.status} />,
      },
      {
        id: "customer",
        header: "Customer",
        meta: { label: "Customer" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block max-w-[14rem] truncate text-ink">{row.original.customerName}</span>
        ),
      },
      {
        id: "order",
        header: "Order",
        meta: { label: "Order", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {row.original.orderNumber}
          </span>
        ),
      },
      {
        id: "reason",
        header: "Reason",
        meta: { label: "Reason", className: "hidden xl:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="block max-w-[22rem] truncate text-ink-muted">{row.original.reason}</span>
        ),
      },
      {
        id: "units",
        header: "Units",
        meta: { label: "Units", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="block text-right font-mono whitespace-nowrap text-ink">
            {row.original.units}
            {row.original.writeOffs > 0 ? (
              <span className="block text-[11px] text-danger">
                {row.original.writeOffs} line{row.original.writeOffs === 1 ? "" : "s"} written off
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: "requested",
        header: "Requested",
        meta: { label: "Requested", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDate(row.original.requestedAt)}
          </span>
        ),
      },
    ];
    if (moneyVisible) {
      list.push({
        id: "refund",
        header: "Refund",
        meta: { label: "Refund", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="block text-right font-mono whitespace-nowrap text-ink">
            {row.original.refundCentavos === null ? "" : formatPeso(row.original.refundCentavos)}
            {row.original.status !== "COMPLETED" && row.original.status !== "REJECTED" ? (
              <span className="block text-[11px] text-ink-subtle">estimate</span>
            ) : null}
          </span>
        ),
      });
    }
    return list;
  }, [moneyVisible]);

  return (
    <DataTable
      tableId="returns"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="requestedAt"
      dir="desc"
      toolbar={toolbar}
      href={(row) => `/returns/${row.id}`}
      noun={["return", "returns"]}
      empty={
        <EmptyState
          icon={RotateCcw}
          title={filtered ? "No returns here" : "No returns yet"}
          description={
            filtered
              ? "Nothing is waiting at this step. The other tabs hold the rest."
              : "Returns start from a delivered order. Open the order and choose Start a return."
          }
        />
      }
    />
  );
}
