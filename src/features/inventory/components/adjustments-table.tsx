"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardPen } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import { formatAmount } from "@/lib/money";

import type { AdjustmentListRow } from "../queries";
import { STOCK_REASON_LABEL } from "../schemas";

/** Adjustment documents, newest first. A row opens the document. */
export function AdjustmentsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  withCost,
  canCreate,
  toolbar,
  filtered,
}: {
  rows: AdjustmentListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  withCost: boolean;
  canCreate: boolean;
  toolbar: React.ReactNode;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<AdjustmentListRow, unknown>[]>(() => {
    const defs: ColumnDef<AdjustmentListRow, unknown>[] = [
      {
        id: "reference",
        header: "Reference",
        meta: { label: "Reference", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Link
            href={`/inventory/adjustments/${row.original.id}`}
            className="font-mono text-[12px] whitespace-nowrap text-ink hover:text-accent-strong"
          >
            {row.original.reference}
          </Link>
        ),
      },
      {
        id: "date",
        header: "Recorded",
        meta: { label: "Recorded", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "warehouse",
        header: "Warehouse",
        meta: { label: "Warehouse", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-ink-muted">{row.original.warehouseCode}</span>
        ),
      },
      {
        id: "reason",
        header: "Reason",
        meta: { label: "Reason", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="max-w-[20rem] min-w-0">
            <StatusBadge tone={row.original.reason === "COUNT_CORRECTION" ? "info" : "warning"}>
              {(STOCK_REASON_LABEL[row.original.reason] ?? row.original.reason).toLowerCase()}
            </StatusBadge>
            {row.original.note ? (
              <span className="mt-0.5 hidden truncate text-caption text-ink-subtle lg:block">
                {row.original.note}
              </span>
            ) : null}
          </div>
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
        meta: { label: "Units in and out", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono whitespace-nowrap">
            {row.original.unitsIn > 0 ? (
              <span className="text-success">+{row.original.unitsIn}</span>
            ) : null}
            {row.original.unitsIn > 0 && row.original.unitsOut > 0 ? (
              <span className="text-ink-subtle"> / </span>
            ) : null}
            {row.original.unitsOut > 0 ? (
              <span className="text-ink">-{row.original.unitsOut}</span>
            ) : null}
            {row.original.unitsIn === 0 && row.original.unitsOut === 0 ? (
              <span className="text-ink-subtle">0</span>
            ) : null}
          </span>
        ),
      },
    ];

    if (withCost) {
      defs.push({
        id: "value",
        header: "Value (PHP)",
        meta: {
          label: "Value change at cost",
          align: "right",
          className: "hidden md:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span
            data-numeric
            className={
              row.original.valueDeltaCentavos < 0
                ? "font-mono whitespace-nowrap text-ink"
                : "font-mono whitespace-nowrap text-success"
            }
          >
            {row.original.valueDeltaCentavos > 0 ? "+" : ""}
            {formatAmount(row.original.valueDeltaCentavos)}
          </span>
        ),
      });
    }

    defs.push({
      id: "actor",
      header: "By",
      meta: { label: "Recorded by", className: "hidden xl:table-cell" } satisfies ColumnMeta,
      cell: ({ row }) => (
        <span className="text-caption whitespace-nowrap text-ink-subtle">
          {row.original.actorName}
        </span>
      ),
    });

    return defs;
  }, [withCost]);

  return (
    <DataTable
      tableId="inventory-adjustments"
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
      href={(row) => `/inventory/adjustments/${row.id}`}
      noun={["adjustment", "adjustments"]}
      empty={
        <EmptyState
          icon={ClipboardPen}
          title={filtered ? "No adjustments match" : "No adjustments yet"}
          description={
            filtered
              ? "Nothing was adjusted in that warehouse for that reason."
              : "Record damage, losses, samples and cycle-count differences here. Each one needs a reason and lands in the ledger and the audit log."
          }
          action={
            canCreate && !filtered ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/inventory/adjustments/new">New adjustment</Link>
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
