import { Prisma, type ActivityType, type CustomerSegment, type SalesChannel } from "@prisma/client";

import { db } from "@/lib/db";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatPeso, toPesoInput } from "@/lib/money";

import type { CustomerFilters, CustomerFormValues } from "../schemas";
import { REALISED_ORDER_STATUSES } from "../services/segment-rules";

/**
 * Customer reads.
 *
 * The directory is a Prisma query: every column it sorts or filters on is a
 * stored rollup (lifetime value, order count, last order, segment), indexed,
 * and maintained by the segment service, so there is nothing to aggregate on
 * the way out. Customer 360 is where the live aggregation happens, for one
 * customer at a time, straight from the orders table.
 */

export const CUSTOMER_PAGE_SIZE = 25;

const OPEN_TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] as const;

function orderByFor(filters: CustomerFilters): Prisma.CustomerOrderByWithRelationInput[] {
  const dir = filters.dir;
  switch (filters.sort) {
    case "name":
      return [{ displayName: dir }];
    case "orders":
      return [{ orderCount: dir }, { lifetimeValueCentavos: "desc" }];
    case "lastOrder":
      return [{ lastOrderAt: { sort: dir, nulls: "last" } }, { displayName: "asc" }];
    case "created":
      return [{ createdAt: dir }];
    case "ltv":
    default:
      return [{ lifetimeValueCentavos: dir }, { displayName: "asc" }];
  }
}

function whereFor(filters: CustomerFilters, withSegment = true): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = { deletedAt: null };
  if (withSegment && filters.segment) where.segment = filters.segment;
  if (filters.type) where.type = filters.type;
  if (filters.channel) where.sourceChannel = filters.channel;
  if (filters.province) {
    where.addresses = { some: { isDefault: true, province: filters.province } };
  }
  if (filters.search) {
    const term = filters.search;
    // ILIKE on displayName and email is served by the trigram GIN indexes.
    where.OR = [
      { displayName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
      { code: { equals: term.toUpperCase() } },
      { tags: { has: term.toLowerCase() } },
    ];
  }
  return where;
}

export async function listCustomers(filters: CustomerFilters, options: { withMoney: boolean }) {
  const where = whereFor(filters);

  const [total, rows] = await Promise.all([
    db.customer.count({ where }),
    db.customer.findMany({
      where,
      orderBy: orderByFor(filters),
      skip: (filters.page - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
      select: {
        id: true,
        code: true,
        type: true,
        displayName: true,
        email: true,
        phone: true,
        segment: true,
        sourceChannel: true,
        tags: true,
        lifetimeValueCentavos: true,
        orderCount: true,
        lastOrderAt: true,
        createdAt: true,
        addresses: {
          where: { isDefault: true },
          take: 1,
          select: { city: true, province: true },
        },
      },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE));

  return {
    total,
    page: Math.min(filters.page, pageCount),
    pageCount,
    rows: rows.map(({ addresses, lifetimeValueCentavos, orderCount, ...row }) => ({
      ...row,
      city: addresses[0]?.city ?? null,
      province: addresses[0]?.province ?? null,
      // Stripped on the server for roles without Customer 360, not hidden in CSS.
      lifetimeValueCentavos: options.withMoney ? lifetimeValueCentavos : null,
      orderCount: options.withMoney ? orderCount : null,
    })),
  };
}

export type CustomerListRow = Awaited<ReturnType<typeof listCustomers>>["rows"][number];

/** Segment tab counts, honouring every filter except the segment itself. */
export async function customerSegmentCounts(filters: CustomerFilters) {
  const groups = await db.customer.groupBy({
    by: ["segment"],
    where: whereFor(filters, false),
    _count: { _all: true },
  });
  const counts: Record<CustomerSegment, number> = { VIP: 0, REPEAT: 0, NEW: 0, DORMANT: 0 };
  for (const group of groups) counts[group.segment] = group._count._all;
  return counts;
}

export async function customerProvinces(): Promise<string[]> {
  const rows = await db.address.findMany({
    where: { customerId: { not: null }, isDefault: true, customer: { deletedAt: null } },
    distinct: ["province"],
    select: { province: true },
    orderBy: { province: "asc" },
  });
  return rows.map((row) => row.province);
}

// --------------------------------------------------------------- customer 360

type LiveStats = {
  order_count: number;
  ltv: bigint;
  first_order_at: Date | null;
  last_order_at: Date | null;
  refunded: bigint;
  top_channel: SalesChannel | null;
};

const REALISED = Prisma.join(
  REALISED_ORDER_STATUSES.map((status) => Prisma.sql`${status}::"OrderStatus"`),
);

export async function getCustomer360(customerId: string) {
  const customer = await db.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: {
      id: true,
      code: true,
      type: true,
      firstName: true,
      lastName: true,
      companyName: true,
      displayName: true,
      email: true,
      phone: true,
      taxId: true,
      sourceChannel: true,
      segment: true,
      tags: true,
      facebookHandle: true,
      instagramHandle: true,
      notes: true,
      creditLimitCentavos: true,
      createdAt: true,
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          type: true,
          recipient: true,
          phone: true,
          line1: true,
          line2: true,
          barangay: true,
          city: true,
          province: true,
          postalCode: true,
          isDefault: true,
        },
      },
    },
  });
  if (!customer) return null;

  const [statsRows, totalOrders, orders, tickets, claims, returns, leads, activities] =
    await Promise.all([
      db.$queryRaw<LiveStats[]>`
        SELECT
          COUNT(*)::int                                            AS order_count,
          COALESCE(SUM("totalCentavos" - "amountRefundedCentavos"), 0)::bigint AS ltv,
          MIN("placedAt")                                          AS first_order_at,
          MAX("placedAt")                                          AS last_order_at,
          COALESCE(SUM("amountRefundedCentavos"), 0)::bigint       AS refunded,
          MODE() WITHIN GROUP (ORDER BY channel)::text             AS top_channel
        FROM "Order"
        WHERE "customerId" = ${customerId} AND status IN (${REALISED})
      `,
      db.order.count({ where: { customerId } }),
      db.order.findMany({
        where: { customerId },
        orderBy: { placedAt: "desc" },
        take: 10,
        select: {
          id: true,
          orderNumber: true,
          channel: true,
          status: true,
          placedAt: true,
          totalCentavos: true,
          amountRefundedCentavos: true,
          _count: { select: { items: true } },
          items: {
            take: 1,
            orderBy: { lineTotalCentavos: "desc" },
            select: { nameSnapshot: true },
          },
        },
      }),
      db.ticket.findMany({
        where: { customerId },
        orderBy: [{ createdAt: "desc" }],
        take: 20,
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          status: true,
          priority: true,
          slaDueAt: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
      db.warrantyClaim.findMany({
        where: { customerId },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          claimNumber: true,
          status: true,
          submittedAt: true,
          resolvedAt: true,
          issueDescription: true,
          variant: { select: { sku: true, product: { select: { name: true } } } },
        },
      }),
      db.return.findMany({
        where: { customerId },
        orderBy: { requestedAt: "desc" },
        select: { id: true, rmaNumber: true, status: true, requestedAt: true, reason: true },
      }),
      db.lead.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          code: true,
          title: true,
          stage: true,
          valueCentavos: true,
          wonAt: true,
          createdAt: true,
        },
      }),
      db.activity.findMany({
        where: {
          OR: [{ customerId }, { lead: { customerId } }, { ticket: { customerId } }],
          status: { not: "CANCELLED" },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 40,
        select: {
          id: true,
          type: true,
          status: true,
          subject: true,
          note: true,
          dueAt: true,
          completedAt: true,
          createdAt: true,
          owner: { select: { name: true } },
          lead: { select: { id: true, code: true } },
          ticket: { select: { id: true, ticketNumber: true } },
        },
      }),
    ]);

  const stats = statsRows[0];
  const orderCount = stats?.order_count ?? 0;
  const lifetimeValueCentavos = Number(stats?.ltv ?? 0);

  return {
    customer,
    stats: {
      orderCount,
      totalOrders,
      lifetimeValueCentavos,
      averageOrderCentavos: orderCount > 0 ? Math.round(lifetimeValueCentavos / orderCount) : 0,
      refundedCentavos: Number(stats?.refunded ?? 0),
      firstOrderAt: stats?.first_order_at ?? null,
      lastOrderAt: stats?.last_order_at ?? null,
      topChannel: stats?.top_channel ?? null,
      openTickets: tickets.filter((ticket) =>
        (OPEN_TICKET_STATUSES as readonly string[]).includes(ticket.status),
      ).length,
    },
    orders: orders.map(({ _count, items, ...order }) => ({
      ...order,
      itemCount: _count.items,
      leadItem: items[0]?.nameSnapshot ?? null,
    })),
    tickets,
    claims,
    returns,
    leads,
    timeline: buildTimeline({ activities, orders, tickets, claims, returns, leads }),
  };
}

export type Customer360 = NonNullable<Awaited<ReturnType<typeof getCustomer360>>>;

export type TimelineEntry = {
  id: string;
  at: Date;
  kind: "activity" | "order" | "ticket" | "claim" | "return" | "lead";
  title: string;
  detail: string | null;
  href: string | null;
  /** Activities only: open, done, and whether an open one is overdue. */
  state?: "open" | "done" | "overdue";
  activityType?: ActivityType;
  by?: string | null;
};

/**
 * Everything that has happened with this customer, newest first: the work
 * people logged, and the events the other modules recorded. One list, so a
 * person picking up the account reads the story rather than six tabs.
 */
function buildTimeline(input: {
  activities: {
    id: string;
    type: ActivityType;
    status: string;
    subject: string;
    note: string | null;
    dueAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    owner: { name: string };
    lead: { id: string; code: string } | null;
    ticket: { id: string; ticketNumber: string } | null;
  }[];
  orders: {
    id: string;
    orderNumber: string;
    placedAt: Date;
    channel: SalesChannel;
    totalCentavos: number;
  }[];
  tickets: {
    id: string;
    ticketNumber: string;
    subject: string;
    createdAt: Date;
    resolvedAt: Date | null;
  }[];
  claims: {
    id: string;
    claimNumber: string;
    submittedAt: Date;
    variant: { product: { name: string } };
  }[];
  returns: { id: string; rmaNumber: string; requestedAt: Date; reason: string }[];
  leads: { id: string; code: string; title: string; createdAt: Date; wonAt: Date | null }[];
}): TimelineEntry[] {
  const now = Date.now();
  const entries: TimelineEntry[] = [];

  for (const activity of input.activities) {
    const done = activity.status === "DONE";
    const overdue = !done && activity.dueAt !== null && activity.dueAt.getTime() < now;
    entries.push({
      id: `act-${activity.id}`,
      at: done ? (activity.completedAt ?? activity.createdAt) : activity.createdAt,
      kind: "activity",
      title: activity.subject,
      detail: activity.note,
      href: activity.lead
        ? `/leads/${activity.lead.id}`
        : activity.ticket
          ? `/tickets/${activity.ticket.id}`
          : null,
      state: done ? "done" : overdue ? "overdue" : "open",
      activityType: activity.type,
      by: activity.owner.name,
    });
  }

  for (const order of input.orders) {
    entries.push({
      id: `ord-${order.id}`,
      at: order.placedAt,
      kind: "order",
      title: `Placed ${order.orderNumber}`,
      detail: `${formatPeso(order.totalCentavos)} via ${CHANNEL_LABEL[order.channel]}`,
      href: null,
    });
  }

  for (const ticket of input.tickets) {
    entries.push({
      id: `tkt-${ticket.id}`,
      at: ticket.createdAt,
      kind: "ticket",
      title: `Opened ${ticket.ticketNumber}: ${ticket.subject}`,
      detail: null,
      href: `/tickets/${ticket.id}`,
    });
    if (ticket.resolvedAt) {
      entries.push({
        id: `tkr-${ticket.id}`,
        at: ticket.resolvedAt,
        kind: "ticket",
        title: `Resolved ${ticket.ticketNumber}`,
        detail: null,
        href: `/tickets/${ticket.id}`,
      });
    }
  }

  for (const claim of input.claims) {
    entries.push({
      id: `wc-${claim.id}`,
      at: claim.submittedAt,
      kind: "claim",
      title: `Warranty claim ${claim.claimNumber}`,
      detail: claim.variant.product.name,
      href: null,
    });
  }

  for (const rma of input.returns) {
    entries.push({
      id: `rma-${rma.id}`,
      at: rma.requestedAt,
      kind: "return",
      title: `Return ${rma.rmaNumber} requested`,
      detail: rma.reason,
      href: null,
    });
  }

  for (const lead of input.leads) {
    entries.push({
      id: `led-${lead.id}`,
      at: lead.wonAt ?? lead.createdAt,
      kind: "lead",
      title: lead.wonAt ? `Won ${lead.code}: ${lead.title}` : `Lead ${lead.code}: ${lead.title}`,
      detail: null,
      href: `/leads/${lead.id}`,
    });
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 30);
}

// ------------------------------------------------------------------ the form

export async function customerFormDefaults(
  customerId: string,
): Promise<{ code: string; displayName: string; values: CustomerFormValues } | null> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: {
      code: true,
      displayName: true,
      type: true,
      firstName: true,
      lastName: true,
      companyName: true,
      taxId: true,
      email: true,
      phone: true,
      sourceChannel: true,
      tags: true,
      facebookHandle: true,
      instagramHandle: true,
      notes: true,
      creditLimitCentavos: true,
      addresses: {
        where: { isDefault: true },
        take: 1,
        select: {
          line1: true,
          line2: true,
          barangay: true,
          city: true,
          province: true,
          postalCode: true,
        },
      },
    },
  });
  if (!customer) return null;
  const address = customer.addresses[0];

  return {
    code: customer.code,
    displayName: customer.displayName,
    values: {
      type: customer.type,
      firstName: customer.firstName ?? "",
      lastName: customer.lastName ?? "",
      companyName: customer.companyName ?? "",
      taxId: customer.taxId ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      sourceChannel: customer.sourceChannel ?? "",
      tags: customer.tags.join(", "),
      facebookHandle: customer.facebookHandle ?? "",
      instagramHandle: customer.instagramHandle ?? "",
      notes: customer.notes ?? "",
      creditLimit:
        customer.creditLimitCentavos > 0 ? toPesoInput(customer.creditLimitCentavos) : "",
      address: {
        line1: address?.line1 ?? "",
        line2: address?.line2 ?? "",
        barangay: address?.barangay ?? "",
        city: address?.city ?? "",
        province: address?.province ?? "",
        postalCode: address?.postalCode ?? "",
      },
    },
  };
}

export const EMPTY_CUSTOMER: CustomerFormValues = {
  type: "INDIVIDUAL",
  firstName: "",
  lastName: "",
  companyName: "",
  taxId: "",
  email: "",
  phone: "",
  sourceChannel: "",
  tags: "",
  facebookHandle: "",
  instagramHandle: "",
  notes: "",
  creditLimit: "",
  address: { line1: "", line2: "", barangay: "", city: "", province: "", postalCode: "" },
};

// ----------------------------------------------------------------- pickers

export type CustomerPick = {
  id: string;
  code: string;
  displayName: string;
  detail: string | null;
  segment: CustomerSegment;
};

/** Type-ahead for the ticket, lead and activity forms. */
export async function searchCustomers(query: string): Promise<CustomerPick[]> {
  const term = query.trim();
  const rows = await db.customer.findMany({
    where: {
      deletedAt: null,
      ...(term
        ? {
            OR: [
              { displayName: { contains: term, mode: "insensitive" } },
              { email: { contains: term, mode: "insensitive" } },
              { phone: { contains: term } },
              { code: { equals: term.toUpperCase() } },
            ],
          }
        : {}),
    },
    orderBy: term ? [{ displayName: "asc" }] : [{ lastOrderAt: { sort: "desc", nulls: "last" } }],
    take: 8,
    select: { id: true, code: true, displayName: true, email: true, phone: true, segment: true },
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    displayName: row.displayName,
    detail: row.email ?? row.phone,
    segment: row.segment,
  }));
}

/** A customer's recent orders, for linking a ticket to one. */
export async function recentOrdersFor(customerId: string) {
  return db.order.findMany({
    where: { customerId },
    orderBy: { placedAt: "desc" },
    take: 15,
    select: { id: true, orderNumber: true, placedAt: true, status: true, channel: true },
  });
}

/** One customer as a picker value, for forms opened from Customer 360. */
export async function customerPick(customerId: string) {
  return db.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, code: true, displayName: true },
  });
}
