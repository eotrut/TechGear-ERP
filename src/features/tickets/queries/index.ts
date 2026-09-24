import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { can } from "@/lib/rbac/can";

import type { TicketFilters, TicketView } from "../schemas";

/**
 * Ticket reads. The queue is sorted by SLA target by default, because the
 * ticket that breaches next is the one to pick up next, whatever order they
 * arrived in.
 */

export const TICKET_PAGE_SIZE = 25;

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] as const;

function viewWhere(view: TicketView, userId: string, now: Date): Prisma.TicketWhereInput {
  switch (view) {
    case "open":
      return { status: { in: [...OPEN_STATUSES] } };
    case "breached":
      return { status: { in: [...OPEN_STATUSES] }, slaDueAt: { lt: now } };
    case "mine":
      return { status: { in: [...OPEN_STATUSES] }, assigneeId: userId };
    case "unassigned":
      return { status: { in: [...OPEN_STATUSES] }, assigneeId: null };
    case "resolved":
      return { status: { in: ["RESOLVED", "CLOSED"] } };
    case "all":
    default:
      return {};
  }
}

function filterWhere(filters: TicketFilters): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {};
  if (filters.priority) where.priority = filters.priority;
  if (filters.assignee) where.assigneeId = filters.assignee;
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { ticketNumber: { equals: term.toUpperCase() } },
      { subject: { contains: term, mode: "insensitive" } },
      { customer: { displayName: { contains: term, mode: "insensitive" } } },
      { order: { orderNumber: { equals: term.toUpperCase() } } },
    ];
  }
  return where;
}

function orderFor(view: TicketView): Prisma.TicketOrderByWithRelationInput[] {
  if (view === "resolved") return [{ resolvedAt: { sort: "desc", nulls: "last" } }];
  if (view === "all") return [{ createdAt: "desc" }];
  return [{ slaDueAt: "asc" }, { createdAt: "asc" }];
}

export async function listTickets(filters: TicketFilters, userId: string, now: Date = new Date()) {
  const where: Prisma.TicketWhereInput = {
    AND: [viewWhere(filters.view, userId, now), filterWhere(filters)],
  };

  const [total, rows] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({
      where,
      orderBy: orderFor(filters.view),
      skip: (filters.page - 1) * TICKET_PAGE_SIZE,
      take: TICKET_PAGE_SIZE,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        slaDueAt: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        firstResponseAt: true,
        customer: { select: { id: true, displayName: true, segment: true } },
        assignee: { select: { id: true, name: true } },
        order: { select: { orderNumber: true } },
        _count: { select: { comments: true } },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / TICKET_PAGE_SIZE));
  return { total, page: Math.min(filters.page, pageCount), pageCount, rows };
}

export type TicketListRow = Awaited<ReturnType<typeof listTickets>>["rows"][number];

/** Tab counts, with the priority, assignee and search filters applied. */
export async function ticketViewCounts(
  filters: TicketFilters,
  userId: string,
  now: Date = new Date(),
): Promise<Record<TicketView, number>> {
  const base = filterWhere(filters);
  const views: TicketView[] = ["open", "breached", "mine", "unassigned", "resolved", "all"];
  const counts = await Promise.all(
    views.map((view) => db.ticket.count({ where: { AND: [viewWhere(view, userId, now), base] } })),
  );
  return Object.fromEntries(views.map((view, index) => [view, counts[index] ?? 0])) as Record<
    TicketView,
    number
  >;
}

/** People who can hold a ticket: active and working the queue. */
export async function ticketAssignees() {
  const users = await db.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return users
    .filter((user) => can(user.role, "tickets.view"))
    .map((user) => ({ id: user.id, name: user.name }));
}

// ------------------------------------------------------------------- detail

export async function getTicket(ticketId: string) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      description: true,
      status: true,
      priority: true,
      slaDueAt: true,
      firstResponseAt: true,
      resolvedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
      customer: {
        select: {
          id: true,
          code: true,
          displayName: true,
          type: true,
          segment: true,
          email: true,
          phone: true,
          lifetimeValueCentavos: true,
          orderCount: true,
          _count: {
            select: { tickets: { where: { status: { in: [...OPEN_STATUSES] } } } },
          },
        },
      },
      order: {
        select: {
          id: true,
          orderNumber: true,
          placedAt: true,
          status: true,
          channel: true,
          totalCentavos: true,
          _count: { select: { items: true } },
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          optionSummary: true,
          product: { select: { id: true, name: true } },
        },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          isInternal: true,
          createdAt: true,
          author: { select: { id: true, name: true, role: true } },
        },
      },
      activities: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        select: {
          id: true,
          type: true,
          status: true,
          subject: true,
          dueAt: true,
          completedAt: true,
          ownerId: true,
          owner: { select: { name: true } },
        },
      },
    },
  });
  return ticket;
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

export type VariantOption = { id: string; label: string; detail: string };

/** Product lookup for linking a ticket to what the customer bought. */
export async function searchProductVariants(query: string): Promise<VariantOption[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const rows = await db.productVariant.findMany({
    where: {
      deletedAt: null,
      OR: [
        { sku: { contains: term, mode: "insensitive" } },
        { barcode: term },
        { product: { name: { contains: term, mode: "insensitive" } } },
      ],
    },
    orderBy: { sku: "asc" },
    take: 8,
    select: { id: true, sku: true, optionSummary: true, product: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.product.name,
    detail: `${row.optionSummary} · ${row.sku}`,
  }));
}
