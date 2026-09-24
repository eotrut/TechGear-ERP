import { Prisma, type CustomerSegment, type PrismaClient } from "@prisma/client";

import { assertCentavos } from "@/lib/money";

import {
  classifySegment,
  REALISED_ORDER_STATUSES,
  vipThreshold,
  type CustomerStats,
} from "./segment-rules";

/**
 * Writing segments. The rules themselves are pure and live in segment-rules.ts
 * so the browser can import the labels without pulling in the database client.
 */

type Client = PrismaClient | Prisma.TransactionClient;

type StatsRow = {
  id: string;
  segment: CustomerSegment;
  order_count: number;
  ltv: bigint;
  last_order_at: Date | null;
};

const REALISED = Prisma.join(
  REALISED_ORDER_STATUSES.map((status) => Prisma.sql`${status}::"OrderStatus"`),
);

/** Realised order history per customer, straight from the orders table. */
async function readStats(client: Client, customerId?: string): Promise<StatsRow[]> {
  const only = customerId ? Prisma.sql`AND c.id = ${customerId}` : Prisma.empty;
  return client.$queryRaw<StatsRow[]>`
    SELECT
      c.id,
      c.segment,
      COALESCE(s.order_count, 0)::int AS order_count,
      COALESCE(s.ltv, 0)::bigint      AS ltv,
      s.last_order_at
    FROM "Customer" c
    LEFT JOIN (
      SELECT
        "customerId",
        COUNT(*)::int                                            AS order_count,
        SUM("totalCentavos" - "amountRefundedCentavos")::bigint AS ltv,
        MAX("placedAt")                                          AS last_order_at
      FROM "Order"
      WHERE "customerId" IS NOT NULL AND status IN (${REALISED})
      GROUP BY "customerId"
    ) s ON s."customerId" = c.id
    WHERE c."deletedAt" IS NULL ${only}
  `;
}

function toStats(row: StatsRow): CustomerStats {
  return {
    orderCount: row.order_count,
    lifetimeValueCentavos: assertCentavos(Number(row.ltv)),
    lastOrderAt: row.last_order_at,
  };
}

export type SegmentRefresh = {
  customers: number;
  changed: number;
  counts: Record<CustomerSegment, number>;
  moves: { id: string; from: CustomerSegment; to: CustomerSegment }[];
};

/**
 * Recompute lifetime value, order count, last order and segment for every
 * customer from the orders table, and write back only the rows that changed.
 */
export async function recomputeSegments(client: Client, now: Date): Promise<SegmentRefresh> {
  const rows = await readStats(client);
  const stats = rows.map((row) => ({ row, stats: toStats(row) }));
  const threshold = vipThreshold(stats.map((entry) => entry.stats.lifetimeValueCentavos));

  const counts: Record<CustomerSegment, number> = { VIP: 0, REPEAT: 0, NEW: 0, DORMANT: 0 };
  const moves: SegmentRefresh["moves"] = [];

  const ids: string[] = [];
  const segments: CustomerSegment[] = [];
  const ltvs: number[] = [];
  const orderCounts: number[] = [];
  const lastOrders: (string | null)[] = [];

  for (const { row, stats: s } of stats) {
    const segment = classifySegment(s, { now, vipThresholdCentavos: threshold });
    counts[segment] += 1;
    if (segment !== row.segment) moves.push({ id: row.id, from: row.segment, to: segment });

    ids.push(row.id);
    segments.push(segment);
    ltvs.push(s.lifetimeValueCentavos);
    orderCounts.push(s.orderCount);
    // A UTC string cast to timestamp, never a bound JS Date: the session runs
    // in Asia/Manila and a timestamptz parameter would shift by eight hours.
    lastOrders.push(s.lastOrderAt ? s.lastOrderAt.toISOString().replace("Z", "") : null);
  }

  if (ids.length > 0) {
    await client.$executeRaw`
      UPDATE "Customer" AS c
      SET segment                 = u.segment::"CustomerSegment",
          "lifetimeValueCentavos" = u.ltv,
          "orderCount"            = u.order_count,
          "lastOrderAt"           = u.last_order_at::timestamp
      FROM unnest(
        ${ids}::text[],
        ${segments}::text[],
        ${ltvs}::int[],
        ${orderCounts}::int[],
        ${lastOrders}::text[]
      ) AS u(id, segment, ltv, order_count, last_order_at)
      WHERE c.id = u.id
        AND (
          c.segment::text <> u.segment
          OR c."lifetimeValueCentavos" <> u.ltv
          OR c."orderCount" <> u.order_count
          OR c."lastOrderAt" IS DISTINCT FROM u.last_order_at::timestamp
        )
    `;
  }

  return { customers: ids.length, changed: moves.length, counts, moves };
}

/**
 * Refresh one customer after something changed their history, such as an
 * order completing or being refunded. The VIP bar comes from everyone else's
 * stored lifetime value, so this stays a single-row update.
 */
export async function refreshCustomerRollup(
  client: Client,
  customerId: string,
  now: Date,
): Promise<CustomerSegment | null> {
  const [row] = await readStats(client, customerId);
  if (!row) return null;
  const stats = toStats(row);

  const others = await client.customer.findMany({
    where: { deletedAt: null, lifetimeValueCentavos: { gt: 0 }, id: { not: customerId } },
    select: { lifetimeValueCentavos: true },
  });
  const threshold = vipThreshold([
    ...others.map((other) => other.lifetimeValueCentavos),
    stats.lifetimeValueCentavos,
  ]);
  const segment = classifySegment(stats, { now, vipThresholdCentavos: threshold });

  await client.customer.update({
    where: { id: customerId },
    data: {
      segment,
      lifetimeValueCentavos: stats.lifetimeValueCentavos,
      orderCount: stats.orderCount,
      lastOrderAt: stats.lastOrderAt,
    },
    select: { id: true },
  });
  return segment;
}
