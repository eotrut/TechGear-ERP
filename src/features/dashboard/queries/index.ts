import type { TicketPriority } from "@prisma/client";

import { alertCounts, listAlerts } from "@/features/inventory/queries";
import { alertFiltersSchema } from "@/features/inventory/schemas";
import { OPEN_STAGES } from "@/features/leads/services/pipeline";
import { hasComparison } from "@/features/reports/queries";
import { resolveRange, type DateRange } from "@/features/reports/services/date-range";
import { inventoryValueNow } from "@/features/reports/services/inventory";
import type { SalesScope } from "@/features/reports/services/measures";
import {
  salesByCategory,
  salesByChannel,
  salesByCustomer,
  salesByProduct,
  salesPeriod,
  type SalesPeriod,
} from "@/features/reports/services/sales";
import { slaState } from "@/features/tickets/services/sla";
import { db } from "@/lib/db";
import { startOfManilaDay } from "@/lib/format";
import { aggregateCentavos } from "@/lib/money";

/**
 * Dashboard read paths. Every sales figure comes from the report services
 * (D-44), called with the same range the linked report will resolve, so the
 * revenue on a tile is the revenue on the report it opens. The operational
 * counts are small, targeted queries: a count, never a list loaded to be
 * counted in JavaScript.
 */

const OPEN_TICKET = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] as const;
const DAY_MS = 86_400_000;

export type RevenueTile = { key: "today" | "wtd" | "mtd"; range: DateRange; period: SalesPeriod };

/** Today, this week and this month, each against the same elapsed time before. */
export async function revenueTiles(scope: SalesScope, now: Date): Promise<RevenueTile[]> {
  const keys = ["today", "wtd", "mtd"] as const;
  return Promise.all(
    keys.map(async (key) => {
      const range = resolveRange({ range: key }, now);
      return { key, range, period: await salesPeriod(db, range, scope) };
    }),
  );
}

/** Everything the range-scoped half of the dashboard draws, in parallel. */
export async function performance(range: DateRange, scope: SalesScope) {
  const [period, channels, categories, products, customers, comparable] = await Promise.all([
    salesPeriod(db, range, scope),
    salesByChannel(db, range, scope),
    salesByCategory(db, range, scope),
    salesByProduct(db, range, { limit: 5, scope }),
    salesByCustomer(db, range, { limit: 5, scope }),
    hasComparison(range),
  ]);
  return { period, channels, categories, products, customers, comparable };
}

// ---------------------------------------------------------------- counts

export async function inventoryValue() {
  return inventoryValueNow(db);
}

export async function stockAlerts() {
  const [counts, list] = await Promise.all([
    alertCounts(undefined),
    listAlerts(alertFiltersSchema.parse({ view: "alerts" })),
  ]);
  return { ...counts, rows: list.rows.slice(0, 6) };
}

export async function ticketQueue(assigneeId: string | null, now: Date) {
  const where = {
    status: { in: [...OPEN_TICKET] },
    ...(assigneeId ? { assigneeId } : {}),
  };
  const [open, breached, rows] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.count({ where: { ...where, slaDueAt: { lt: now } } }),
    db.ticket.findMany({
      where,
      orderBy: { slaDueAt: "asc" },
      take: 5,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        priority: true,
        slaDueAt: true,
        createdAt: true,
        resolvedAt: true,
        customer: { select: { displayName: true } },
      },
    }),
  ]);
  return {
    open,
    breached,
    rows: rows.map((row) => ({
      id: row.id,
      ticketNumber: row.ticketNumber,
      subject: row.subject,
      priority: row.priority as TicketPriority,
      customerName: row.customer.displayName,
      /** Computed on the server: rendering from "now" in the browser would hydrate a minute off. */
      sla: slaState(row, now),
    })),
  };
}

/** Open pipeline: face value, and value weighted by each lead's win probability. */
export async function pipeline(ownerId: string | null) {
  const owner = ownerId ?? null;
  const [row] = await db.$queryRaw<
    { leads: bigint; value: bigint | null; weighted: bigint | null }[]
  >`
    SELECT COUNT(*)::bigint AS leads,
           SUM("valueCentavos")::bigint AS value,
           SUM(ROUND("valueCentavos"::numeric * "probabilityBps" / 10000))::bigint AS weighted
    FROM "Lead"
    WHERE stage::text = ANY(${[...OPEN_STAGES]}::text[])
      AND (${owner}::text IS NULL OR "ownerId" = ${owner}::text)
  `;
  return {
    leads: Number(row?.leads ?? 0),
    value: aggregateCentavos(row?.value),
    weighted: aggregateCentavos(row?.weighted),
  };
}

export async function tasksDue(ownerId: string, now: Date) {
  const endOfToday = new Date(startOfManilaDay(now).getTime() + DAY_MS);
  const where = { ownerId, status: "OPEN" as const };
  const [overdue, dueToday, rows] = await Promise.all([
    db.activity.count({ where: { ...where, dueAt: { lt: now } } }),
    db.activity.count({ where: { ...where, dueAt: { gte: now, lt: endOfToday } } }),
    db.activity.findMany({
      where: { ...where, dueAt: { not: null } },
      orderBy: { dueAt: "asc" },
      take: 5,
      select: {
        id: true,
        type: true,
        subject: true,
        dueAt: true,
        customer: { select: { displayName: true } },
        lead: { select: { title: true } },
      },
    }),
  ]);
  return {
    overdue,
    dueToday,
    rows: rows.map((row) => ({
      id: row.id,
      type: row.type,
      subject: row.subject,
      dueAt: row.dueAt,
      overdue: row.dueAt !== null && row.dueAt.getTime() < now.getTime(),
      about: row.customer?.displayName ?? row.lead?.title ?? null,
    })),
  };
}

/** The warehouse's day: what to pack, what is arriving, what is on the road. */
export async function warehouseQueue(now: Date) {
  const [toPack, toShip, inTransit, incoming, incomingCount, lateCount, packRows] =
    await Promise.all([
      db.order.count({ where: { status: "PAID" } }),
      db.order.count({ where: { status: "PACKED" } }),
      db.stockTransfer.count({ where: { status: "IN_TRANSIT" } }),
      db.purchaseOrder.findMany({
        where: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] } },
        orderBy: [{ expectedDate: { sort: "asc", nulls: "last" } }],
        take: 5,
        select: {
          id: true,
          poNumber: true,
          status: true,
          expectedDate: true,
          supplier: { select: { name: true } },
          warehouse: { select: { code: true } },
        },
      }),
      db.purchaseOrder.count({ where: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] } } }),
      db.purchaseOrder.count({
        where: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, expectedDate: { lt: now } },
      }),
      db.order.findMany({
        where: { status: "PAID" },
        orderBy: { paidAt: "asc" },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          channel: true,
          paidAt: true,
          warehouse: { select: { code: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
  return {
    toPack,
    toShip,
    inTransit,
    incomingCount,
    lateCount,
    incoming: incoming.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      partial: po.status === "PARTIALLY_RECEIVED",
      expectedDate: po.expectedDate,
      late: po.expectedDate !== null && po.expectedDate.getTime() < now.getTime(),
      supplierName: po.supplier.name,
      warehouseCode: po.warehouse.code,
    })),
    packRows: packRows.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      channel: order.channel,
      paidAt: order.paidAt,
      warehouseCode: order.warehouse.code,
      lines: order._count.items,
    })),
  };
}
