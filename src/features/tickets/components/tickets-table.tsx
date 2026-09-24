"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { LifeBuoy, MessageSquare } from "lucide-react";

import { DataTable, type ColumnMeta } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import type { TicketListRow } from "../queries";
import type { SlaState } from "../services/sla";
import { PriorityBadge, SlaIndicator, TicketStatusBadge } from "./badges";

/**
 * The support queue. SLA state and relative times arrive computed on the
 * server, so the server render and the browser never disagree by a minute.
 */
export type TicketQueueRow = TicketListRow & { sla: SlaState; updatedLabel: string };

export function TicketsTable({
  rows,
  total,
  page,
  pageCount,
  pageSize,
  toolbar,
  filtered,
  canCreate,
}: {
  rows: TicketQueueRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  toolbar: React.ReactNode;
  filtered: boolean;
  canCreate: boolean;
}) {
  const columns = useMemo<ColumnDef<TicketQueueRow, unknown>[]>(
    () => [
      {
        id: "ticket",
        header: "Ticket",
        meta: { label: "Ticket", locked: true } satisfies ColumnMeta,
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={`/tickets/${row.original.id}`}
              className="block max-w-[28rem] truncate font-medium text-ink hover:text-accent-strong"
            >
              {row.original.subject}
            </Link>
            <span className="block max-w-[28rem] truncate text-caption text-ink-subtle">
              <span className="font-mono text-[11px]">{row.original.ticketNumber}</span>
              {" · "}
              {row.original.customer.displayName}
              {row.original.order ? (
                <span className="font-mono text-[11px]"> · {row.original.order.orderNumber}</span>
              ) : null}
            </span>
          </div>
        ),
      },
      {
        id: "priority",
        header: "Priority",
        meta: { label: "Priority" } satisfies ColumnMeta,
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      {
        id: "status",
        header: "Status",
        meta: { label: "Status", className: "hidden sm:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => <TicketStatusBadge status={row.original.status} />,
      },
      {
        id: "sla",
        header: "SLA",
        meta: { label: "SLA", align: "right" } satisfies ColumnMeta,
        cell: ({ row }) => <SlaIndicator state={row.original.sla} compact />,
      },
      {
        id: "assignee",
        header: "Assignee",
        meta: { label: "Assignee", className: "hidden md:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) =>
          row.original.assignee ? (
            <span className="text-body-sm whitespace-nowrap text-ink-muted">
              {row.original.assignee.name}
            </span>
          ) : (
            <span className="text-caption text-warning">unassigned</span>
          ),
      },
      {
        id: "thread",
        header: "Thread",
        meta: {
          label: "Replies",
          align: "right",
          className: "hidden lg:table-cell",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-subtle">
            <MessageSquare className="size-3" aria-hidden />
            {row.original._count.comments}
          </span>
        ),
      },
      {
        id: "updated",
        header: "Updated",
        meta: { label: "Updated", className: "hidden lg:table-cell" } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-subtle">
            {row.original.updatedLabel}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="tickets"
      data={rows}
      columns={columns}
      getRowId={(row) => row.id}
      total={total}
      page={page}
      pageCount={pageCount}
      pageSize={pageSize}
      sort="sla"
      dir="asc"
      toolbar={toolbar}
      href={(row) => `/tickets/${row.id}`}
      noun={["ticket", "tickets"]}
      empty={
        <EmptyState
          icon={LifeBuoy}
          title={filtered ? "Nothing in this view" : "The queue is clear"}
          description={
            filtered
              ? "No tickets match. The other tabs hold the rest of the queue."
              : "No support tickets yet. Open one when a customer calls, messages or emails with a problem."
          }
          action={
            !filtered && canCreate ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/tickets/new">New ticket</Link>
              </Button>
            ) : undefined
          }
        />
      }
    />
  );
}
