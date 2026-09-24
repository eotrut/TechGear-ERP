"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardList } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ActivityItem } from "../queries";
import { ActivityIcon } from "./activity-icon";

/** Everybody's activities, for the people who manage the team's follow-through. */
export function ActivitiesTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  filtered,
}: {
  rows: ActivityItem[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  filtered: boolean;
}) {
  const columns = useMemo<ColumnDef<ActivityItem, unknown>[]>(
    () => [
      {
        id: "subject",
        header: "Activity",
        meta: { label: "Activity", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-start gap-2.5">
            <ActivityIcon type={row.original.type} />
            <div className="min-w-0">
              <span
                className={cn(
                  "block max-w-[26rem] truncate text-ink",
                  row.original.status !== "OPEN" && "text-ink-subtle",
                )}
              >
                {row.original.subject}
              </span>
              {row.original.note ? (
                <span className="block max-w-[26rem] truncate text-caption text-ink-subtle">
                  {row.original.note}
                </span>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: "related",
        header: "Related to",
        meta: { label: "Related to", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.related ? (
            <Link
              href={row.original.related.href}
              className="block max-w-[16rem] truncate text-body-sm text-ink-muted hover:text-accent-strong"
            >
              {row.original.related.label}
            </Link>
          ) : (
            <span className="text-caption text-ink-subtle">none</span>
          ),
      },
      {
        id: "owner",
        header: "Owner",
        meta: { label: "Owner", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-body-sm whitespace-nowrap text-ink-muted">
            {row.original.ownerName}
          </span>
        ),
      },
      {
        id: "due",
        header: "Due",
        meta: { label: "Due" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.dueAt ? (
            <span
              data-numeric
              className={cn(
                "font-mono text-[12px] whitespace-nowrap",
                row.original.overdue ? "font-medium text-danger" : "text-ink-muted",
              )}
            >
              {formatDateTime(row.original.dueAt)}
            </span>
          ) : (
            <span className="text-caption text-ink-subtle">no date</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.overdue ? (
            <StatusBadge tone="critical">overdue</StatusBadge>
          ) : row.original.status === "DONE" ? (
            <StatusBadge tone="success">done</StatusBadge>
          ) : row.original.status === "CANCELLED" ? (
            <StatusBadge>cancelled</StatusBadge>
          ) : (
            <StatusBadge tone="info">open</StatusBadge>
          ),
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="activities"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="due"
      dir="asc"
      toolbar={toolbar}
      noun={["activity", "activities"]}
      empty={
        <EmptyState
          icon={ClipboardList}
          title={filtered ? "No activities match" : "No activities yet"}
          description={
            filtered
              ? "Nothing fits every filter at once. Clear one to widen the list."
              : "Activities logged against customers, leads and tickets appear here for the whole team."
          }
        />
      }
    />
  );
}
