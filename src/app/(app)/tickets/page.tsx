import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { TicketsTable } from "@/features/tickets/components/tickets-table";
import {
  listTickets,
  TICKET_PAGE_SIZE,
  ticketAssignees,
  ticketViewCounts,
} from "@/features/tickets/queries";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  ticketFiltersSchema,
  type TicketView,
} from "@/features/tickets/schemas";
import { slaState } from "@/features/tickets/services/sla";
import { formatRelative } from "@/lib/format";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Tickets" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

const VIEW_LABEL: Record<TicketView, string> = {
  open: "Open",
  breached: "Breached",
  mine: "Mine",
  unassigned: "Unassigned",
  resolved: "Resolved",
  all: "All",
};

export default async function TicketsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("tickets.view");
  const params = await searchParams;
  const filters = ticketFiltersSchema.parse({
    view: single(params.view),
    priority: single(params.priority),
    assignee: single(params.assignee),
    search: single(params.search),
    page: single(params.page),
  });

  const [list, counts, assignees] = await Promise.all([
    listTickets(filters, user.id),
    ticketViewCounts(filters, user.id),
    ticketAssignees(),
  ]);
  const canCreate = can(user.role, "tickets.comment");
  const now = new Date();

  const tabHref = (view: TicketView) => {
    const next = new URLSearchParams();
    for (const key of ["priority", "assignee", "search"] as const) {
      const value = single(params[key]);
      if (value) next.set(key, value);
    }
    if (view !== "open") next.set("view", view);
    const query = next.toString();
    return query === "" ? "/tickets" : `/tickets?${query}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Tickets"
        description="Customer problems, oldest deadline first. Targets are counted in Manila business hours, Monday to Saturday, 9 to 6."
        actions={
          canCreate ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/tickets/new">
                <Plus aria-hidden />
                New ticket
              </Link>
            </Button>
          ) : null
        }
      />
      <TicketsTable
        rows={list.rows.map((row) => ({
          ...row,
          sla: slaState(row, now),
          updatedLabel: formatRelative(row.updatedAt),
        }))}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={TICKET_PAGE_SIZE}
        canCreate={canCreate}
        filtered={
          Boolean(filters.priority || filters.assignee || filters.search) || filters.view !== "all"
        }
        toolbar={
          <div key="ticket-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={(Object.keys(VIEW_LABEL) as TicketView[]).map((view) => ({
                label: VIEW_LABEL[view],
                href: tabHref(view),
                active: filters.view === view,
                count: counts[view],
              }))}
            />
            <ListFilters
              keep={["view"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "Ticket or order number, subject, customer",
                },
                {
                  kind: "select",
                  name: "priority",
                  label: "Priority",
                  allLabel: "Any priority",
                  options: TICKET_PRIORITIES.map((priority) => ({
                    value: priority,
                    label: TICKET_PRIORITY_LABEL[priority],
                  })),
                },
                {
                  kind: "select",
                  name: "assignee",
                  label: "Assignee",
                  allLabel: "Anyone",
                  options: assignees.map((assignee) => ({
                    value: assignee.id,
                    label: assignee.name,
                  })),
                },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
