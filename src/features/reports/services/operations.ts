import { Prisma, type CustomerSegment, type SalesChannel } from "@prisma/client";

import { REALISED_ORDER_STATUSES } from "@/features/customers/services/segment-rules";
import {
  agingBucket,
  emptyAging,
  type AgingBucket,
  type AgingTotals,
} from "@/features/purchasing/services/bill-rules";
import { aggregateCentavos } from "@/lib/money";

import { receivableDueDate } from "./aging-rules";
import { bucketKeys, bucketOf, type DateRange, type Window } from "./date-range";
import { manilaDaySql, salesBase, statusList, utc, within, type Client } from "./measures";

/** Purchases, receivables and customer value. */

// -------------------------------------------------------------- purchases

export type SupplierPurchaseRow = {
  supplierId: string;
  supplierName: string;
  code: string;
  posRaised: number;
  orderedCentavos: number;
  receivedCentavos: number;
  receivedUnits: number;
  rejectedUnits: number;
  billedCentavos: number;
  paidCentavos: number;
};

type Bounds = Pick<Window, "from" | "to">;

/**
 * Spend by supplier in a window, four ways, each dated by its own event:
 * ordered (POs raised, VAT exclusive, drafts and cancellations left out),
 * received (accepted units at delivery cost), billed (bills issued, VAT
 * inclusive, voids left out) and paid.
 */
export async function purchasesBySupplier(
  client: Client,
  window: Bounds,
): Promise<SupplierPurchaseRow[]> {
  const rows = await client.$queryRaw<
    {
      id: string;
      name: string;
      code: string;
      pos: bigint | null;
      ordered: bigint | null;
      received: bigint | null;
      received_units: bigint | null;
      rejected_units: bigint | null;
      billed: bigint | null;
      paid: bigint | null;
    }[]
  >`
    WITH ordered AS (
      SELECT "supplierId" AS id, COUNT(*)::bigint AS pos,
             SUM("subtotalCentavos" + "shippingCentavos")::bigint AS ordered
      FROM "PurchaseOrder"
      WHERE status NOT IN ('DRAFT', 'CANCELLED') AND ${within(Prisma.sql`"orderDate"`, window)}
      GROUP BY 1
    ),
    received AS (
      SELECT po."supplierId" AS id,
             SUM(pri."qtyReceived"::bigint * pri."unitCostCentavos")::bigint AS received,
             SUM(pri."qtyReceived")::bigint AS received_units,
             SUM(pri."qtyRejected")::bigint AS rejected_units
      FROM "PurchaseReceiptItem" pri
      JOIN "PurchaseReceipt" pr ON pr.id = pri."receiptId"
      JOIN "PurchaseOrder" po ON po.id = pr."purchaseOrderId"
      WHERE ${within(Prisma.sql`pr."receivedAt"`, window)}
      GROUP BY 1
    ),
    billed AS (
      SELECT "supplierId" AS id, SUM("totalCentavos")::bigint AS billed
      FROM "SupplierBill"
      WHERE status NOT IN ('DRAFT', 'VOID') AND ${within(Prisma.sql`"issueDate"`, window)}
      GROUP BY 1
    ),
    paid AS (
      SELECT b."supplierId" AS id, SUM(sp."amountCentavos")::bigint AS paid
      FROM "SupplierPayment" sp JOIN "SupplierBill" b ON b.id = sp."billId"
      WHERE ${within(Prisma.sql`sp."paidAt"`, window)}
      GROUP BY 1
    )
    SELECT s.id, s.name, s.code, o.pos, o.ordered, r.received, r.received_units,
           r.rejected_units, b.billed, p.paid
    FROM "Supplier" s
    LEFT JOIN ordered o ON o.id = s.id
    LEFT JOIN received r ON r.id = s.id
    LEFT JOIN billed b ON b.id = s.id
    LEFT JOIN paid p ON p.id = s.id
    WHERE o.id IS NOT NULL OR r.id IS NOT NULL OR b.id IS NOT NULL OR p.id IS NOT NULL
    ORDER BY COALESCE(r.received, 0) + COALESCE(o.ordered, 0) DESC, s.name
  `;
  return rows.map((row) => ({
    supplierId: row.id,
    supplierName: row.name,
    code: row.code,
    posRaised: Number(row.pos ?? 0),
    orderedCentavos: aggregateCentavos(row.ordered),
    receivedCentavos: aggregateCentavos(row.received),
    receivedUnits: Number(row.received_units ?? 0),
    rejectedUnits: Number(row.rejected_units ?? 0),
    billedCentavos: aggregateCentavos(row.billed),
    paidCentavos: aggregateCentavos(row.paid),
  }));
}

/** Goods received at cost, per bucket, for the purchases chart. */
export async function receivedSeries(client: Client, range: DateRange) {
  const rows = await client.$queryRaw<{ day: string; value: bigint | null }[]>`
    SELECT ${manilaDaySql(Prisma.sql`pr."receivedAt"`)} AS day,
           SUM(pri."qtyReceived"::bigint * pri."unitCostCentavos")::bigint AS value
    FROM "PurchaseReceiptItem" pri
    JOIN "PurchaseReceipt" pr ON pr.id = pri."receiptId"
    WHERE ${within(Prisma.sql`pr."receivedAt"`, range)}
    GROUP BY 1
  `;
  const buckets = new Map<string, { key: string; value: number }>(
    bucketKeys(range, range.granularity).map((key) => [key, { key, value: 0 }]),
  );
  for (const row of rows) {
    const bucket = buckets.get(bucketOf(row.day, range.granularity));
    if (bucket) bucket.value += aggregateCentavos(row.value);
  }
  return [...buckets.values()];
}

// ------------------------------------------------------------ receivables

export type ReceivableRow = {
  orderId: string;
  orderNumber: string;
  channel: SalesChannel;
  customerName: string | null;
  placedAt: Date;
  dueDate: Date;
  balanceCentavos: number;
  bucket: AgingBucket;
};

/**
 * Money customers owe: orders placed and not yet paid in full. Drafts are
 * quotes, not debts, and cancelled orders owe nothing.
 */
export async function receivablesAging(
  client: Client,
  now: Date,
): Promise<{ rows: ReceivableRow[]; totals: AgingTotals }> {
  const orders = await client.order.findMany({
    where: { status: "PENDING" },
    orderBy: { placedAt: "asc" },
    select: {
      id: true,
      orderNumber: true,
      channel: true,
      placedAt: true,
      totalCentavos: true,
      amountPaidCentavos: true,
      customer: { select: { displayName: true } },
    },
  });

  const totals = emptyAging();
  const rows: ReceivableRow[] = [];
  for (const order of orders) {
    const balance = order.totalCentavos - order.amountPaidCentavos;
    if (balance <= 0) continue;
    const dueDate = receivableDueDate(order.placedAt, order.channel);
    const bucket = agingBucket(dueDate, now);
    totals[bucket] += balance;
    totals.total += balance;
    rows.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      channel: order.channel,
      customerName: order.customer?.displayName ?? null,
      placedAt: order.placedAt,
      dueDate,
      balanceCentavos: balance,
      bucket,
    });
  }
  return { rows, totals };
}

// --------------------------------------------------------- customer value

export type SegmentRow = {
  segment: CustomerSegment;
  customers: number;
  lifetimeValueCentavos: number;
};

export type CustomerValueRow = {
  customerId: string;
  code: string;
  name: string;
  segment: CustomerSegment;
  lifetimeOrders: number;
  lifetimeValueCentavos: number;
  lastOrderAt: Date | null;
  periodOrders: number;
  periodRevenueCentavos: number;
};

/**
 * Lifetime value comes from the customer rollup, which `refreshCustomerRollup`
 * keeps with the same realised-order rule as the sales base, so a customer's
 * lifetime value is the sum of their revenue in every period.
 */
export async function customerValue(
  client: Client,
  window: Bounds,
  options: { limit?: number } = {},
) {
  const limit = options.limit ? Prisma.sql`LIMIT ${options.limit}::int` : Prisma.empty;
  const [segments, customers, period] = await Promise.all([
    client.$queryRaw<{ segment: CustomerSegment; customers: bigint; ltv: bigint | null }[]>`
      SELECT segment, COUNT(*)::bigint AS customers, SUM("lifetimeValueCentavos")::bigint AS ltv
      FROM "Customer" WHERE "deletedAt" IS NULL
      GROUP BY segment
    `,
    client.$queryRaw<
      {
        id: string;
        code: string;
        name: string;
        segment: CustomerSegment;
        orders: number;
        ltv: number;
        last_order_at: Date | null;
        period_orders: bigint | null;
        period_revenue: bigint | null;
      }[]
    >`
      ${salesBase(window)},
      period AS (
        SELECT customer_id, COUNT(*)::bigint AS orders, SUM(revenue)::bigint AS revenue
        FROM base WHERE customer_id IS NOT NULL GROUP BY customer_id
      )
      SELECT c.id, c.code, c."displayName" AS name, c.segment, c."orderCount" AS orders,
             c."lifetimeValueCentavos" AS ltv, c."lastOrderAt" AS last_order_at,
             p.orders AS period_orders, p.revenue AS period_revenue
      FROM "Customer" c
      LEFT JOIN period p ON p.customer_id = c.id
      WHERE c."deletedAt" IS NULL AND c."orderCount" > 0
      ORDER BY c."lifetimeValueCentavos" DESC, c."displayName"
      ${limit}
    `,
    client.$queryRaw<
      { buyers: bigint; repeat_buyers: bigint; new_buyers: bigint; revenue: bigint | null }[]
    >`
      ${salesBase(window)},
      firsts AS (
        SELECT "customerId" AS customer_id, MIN("placedAt") AS first_at
        FROM "Order"
        WHERE "customerId" IS NOT NULL AND status IN (${statusList(REALISED_ORDER_STATUSES)})
        GROUP BY 1
      ),
      buyers AS (
        SELECT customer_id, COUNT(*) AS orders FROM base
        WHERE customer_id IS NOT NULL GROUP BY customer_id
      )
      SELECT COUNT(*)::bigint AS buyers,
             COUNT(*) FILTER (WHERE b.orders > 1)::bigint AS repeat_buyers,
             COUNT(*) FILTER (WHERE f.first_at >= ${utc(window.from)}::timestamp)::bigint AS new_buyers,
             (SELECT SUM(revenue) FROM base WHERE customer_id IS NOT NULL)::bigint AS revenue
      FROM buyers b JOIN firsts f ON f.customer_id = b.customer_id
    `,
  ]);

  const summary = period[0];
  return {
    segments: segments.map((row) => ({
      segment: row.segment,
      customers: Number(row.customers),
      lifetimeValueCentavos: aggregateCentavos(row.ltv),
    })),
    customers: customers.map((row): CustomerValueRow => ({
      customerId: row.id,
      code: row.code,
      name: row.name,
      segment: row.segment,
      lifetimeOrders: row.orders,
      lifetimeValueCentavos: row.ltv,
      lastOrderAt: row.last_order_at,
      periodOrders: Number(row.period_orders ?? 0),
      periodRevenueCentavos: aggregateCentavos(row.period_revenue),
    })),
    buyers: Number(summary?.buyers ?? 0),
    repeatBuyers: Number(summary?.repeat_buyers ?? 0),
    newBuyers: Number(summary?.new_buyers ?? 0),
    buyerRevenueCentavos: aggregateCentavos(summary?.revenue),
  };
}
