import { Prisma, type CustomerSegment, type SalesChannel } from "@prisma/client";

import { aggregateCentavos } from "@/lib/money";

import { bucketKeys, bucketOf, type DateRange, type Granularity, type Window } from "./date-range";
import { salesBase, type Client, type SalesScope } from "./measures";

/**
 * Sales figures. Everything here reads the sales base from measures.ts, and
 * every total is the sum of the same daily rows its chart is drawn from, so a
 * chart and the number above it can never disagree.
 */

export type SalesFigures = {
  orders: number;
  revenue: number;
  merchandise: number;
  shipping: number;
  refunds: number;
  vat: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
};

export type SalesDay = SalesFigures & { day: string };

export function emptyFigures(): SalesFigures {
  return {
    orders: 0,
    revenue: 0,
    merchandise: 0,
    shipping: 0,
    refunds: 0,
    vat: 0,
    netSales: 0,
    cogs: 0,
    grossProfit: 0,
  };
}

export function addFigures(into: SalesFigures, row: SalesFigures): SalesFigures {
  into.orders += row.orders;
  into.revenue += row.revenue;
  into.merchandise += row.merchandise;
  into.shipping += row.shipping;
  into.refunds += row.refunds;
  into.vat += row.vat;
  into.netSales += row.netSales;
  into.cogs += row.cogs;
  into.grossProfit += row.grossProfit;
  return into;
}

type FigureRow = {
  orders: bigint;
  revenue: bigint | null;
  merchandise: bigint | null;
  shipping: bigint | null;
  refunds: bigint | null;
  vat: bigint | null;
  cogs: bigint | null;
};

const FIGURE_COLUMNS = Prisma.sql`
  COUNT(*)::bigint                AS orders,
  SUM(revenue)::bigint            AS revenue,
  SUM(merchandise)::bigint        AS merchandise,
  SUM(shipping)::bigint           AS shipping,
  SUM(refunds)::bigint            AS refunds,
  SUM(vat)::bigint                AS vat,
  SUM(cogs)::bigint               AS cogs`;

function toFigures(row: FigureRow): SalesFigures {
  const revenue = aggregateCentavos(row.revenue);
  const vat = aggregateCentavos(row.vat);
  const cogs = aggregateCentavos(row.cogs);
  const netSales = revenue - vat;
  return {
    orders: Number(row.orders),
    revenue,
    merchandise: aggregateCentavos(row.merchandise),
    shipping: aggregateCentavos(row.shipping),
    refunds: aggregateCentavos(row.refunds),
    vat,
    netSales,
    cogs,
    grossProfit: netSales - cogs,
  };
}

/** One row per Manila day that had a sale. */
export async function salesDaily(
  client: Client,
  window: Pick<Window, "from" | "to">,
  scope: SalesScope = {},
): Promise<SalesDay[]> {
  const rows = await client.$queryRaw<(FigureRow & { day: string })[]>`
    ${salesBase(window, scope)}
    SELECT day, ${FIGURE_COLUMNS}
    FROM base GROUP BY day ORDER BY day
  `;
  return rows.map((row) => ({ day: row.day, ...toFigures(row) }));
}

export function totalOf(days: readonly SalesFigures[]): SalesFigures {
  return days.reduce((sum, day) => addFigures(sum, day), emptyFigures());
}

export type SalesBucket = SalesFigures & { key: string };

/** Daily rows folded into the range's buckets, with a zero for every quiet one. */
export function bucketise(
  days: readonly SalesDay[],
  window: Window,
  granularity: Granularity,
): SalesBucket[] {
  const buckets = new Map<string, SalesBucket>(
    bucketKeys(window, granularity).map((key) => [key, { key, ...emptyFigures() }]),
  );
  for (const day of days) {
    const bucket = buckets.get(bucketOf(day.day, granularity));
    if (bucket) addFigures(bucket, day);
  }
  return [...buckets.values()];
}

export type SalesPeriod = {
  totals: SalesFigures;
  previous: SalesFigures;
  series: SalesBucket[];
  previousSeries: SalesBucket[];
};

/** A range and its comparison period, totals and buckets, in two queries. */
export async function salesPeriod(
  client: Client,
  range: DateRange,
  scope: SalesScope = {},
): Promise<SalesPeriod> {
  const [current, previous] = await Promise.all([
    salesDaily(client, range, scope),
    salesDaily(client, range.previous, scope),
  ]);
  return {
    totals: totalOf(current),
    previous: totalOf(previous),
    series: bucketise(current, range, range.granularity),
    previousSeries: bucketise(previous, range.previous, range.granularity),
  };
}

/** Units sold on the orders in the base. */
export async function unitsSold(
  client: Client,
  window: Pick<Window, "from" | "to">,
  scope: SalesScope = {},
): Promise<{ units: number; returned: number }> {
  const [row] = await client.$queryRaw<{ units: bigint | null; returned: bigint | null }[]>`
    ${salesBase(window, scope)}
    SELECT SUM(oi.qty)::bigint AS units, SUM(oi."qtyReturned")::bigint AS returned
    FROM "OrderItem" oi JOIN base b ON b.id = oi."orderId"
  `;
  return { units: Number(row?.units ?? 0), returned: Number(row?.returned ?? 0) };
}

// ---------------------------------------------------------------- breakdowns

export type ChannelRow = SalesFigures & { channel: SalesChannel };

export async function salesByChannel(
  client: Client,
  window: Pick<Window, "from" | "to">,
  scope: SalesScope = {},
): Promise<ChannelRow[]> {
  const rows = await client.$queryRaw<(FigureRow & { channel: SalesChannel })[]>`
    ${salesBase(window, scope)}
    SELECT channel, ${FIGURE_COLUMNS}
    FROM base GROUP BY channel ORDER BY SUM(revenue) DESC
  `;
  return rows.map((row) => ({ channel: row.channel, ...toFigures(row) }));
}

export type SalespersonRow = SalesFigures & { userId: string | null; name: string };

/** Orders nobody sold (marketplace orders placed by the platform) group as unassigned. */
export async function salesBySalesperson(
  client: Client,
  window: Pick<Window, "from" | "to">,
  scope: SalesScope = {},
): Promise<SalespersonRow[]> {
  const rows = await client.$queryRaw<
    (FigureRow & { user_id: string | null; name: string | null })[]
  >`
    ${salesBase(window, scope)}
    SELECT b.salesperson_id AS user_id, u.name, ${FIGURE_COLUMNS}
    FROM base b LEFT JOIN "User" u ON u.id = b.salesperson_id
    GROUP BY b.salesperson_id, u.name
    ORDER BY SUM(revenue) DESC
  `;
  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name ?? "Unassigned",
    ...toFigures(row),
  }));
}

/**
 * Merchandise by product or category. Line totals are the goods part of an
 * order before refunds; the report shows them with a bridge (merchandise plus
 * shipping less refunds equals revenue) rather than guessing which product a
 * goodwill refund belonged to.
 */
export type LineGroupRow = {
  id: string;
  name: string;
  detail: string | null;
  orders: number;
  units: number;
  returned: number;
  merchandise: number;
  cost: number;
};

type LineGroupSql = {
  id: string;
  name: string;
  detail: string | null;
  orders: bigint;
  units: bigint;
  returned: bigint;
  merchandise: bigint | null;
  cost: bigint | null;
};

function toLineGroup(row: LineGroupSql): LineGroupRow {
  return {
    id: row.id,
    name: row.name,
    detail: row.detail,
    orders: Number(row.orders),
    units: Number(row.units),
    returned: Number(row.returned),
    merchandise: aggregateCentavos(row.merchandise),
    cost: aggregateCentavos(row.cost),
  };
}

const LINE_COLUMNS = Prisma.sql`
  COUNT(DISTINCT oi."orderId")::bigint                         AS orders,
  SUM(oi.qty)::bigint                                          AS units,
  SUM(oi."qtyReturned")::bigint                                AS returned,
  SUM(oi."lineTotalCentavos")::bigint                          AS merchandise,
  SUM(oi.qty::bigint * oi."unitCostCentavos")::bigint          AS cost`;

export async function salesByProduct(
  client: Client,
  window: Pick<Window, "from" | "to">,
  options: { limit?: number; scope?: SalesScope } = {},
): Promise<LineGroupRow[]> {
  const limit = options.limit ? Prisma.sql`LIMIT ${options.limit}::int` : Prisma.empty;
  const rows = await client.$queryRaw<LineGroupSql[]>`
    ${salesBase(window, options.scope)}
    SELECT p.id, p.name, br.name AS detail, ${LINE_COLUMNS}
    FROM "OrderItem" oi
    JOIN base b ON b.id = oi."orderId"
    JOIN "ProductVariant" v ON v.id = oi."variantId"
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "Brand" br ON br.id = p."brandId"
    GROUP BY p.id, p.name, br.name
    ORDER BY SUM(oi."lineTotalCentavos") DESC, p.name
    ${limit}
  `;
  return rows.map(toLineGroup);
}

export async function salesByCategory(
  client: Client,
  window: Pick<Window, "from" | "to">,
  scope: SalesScope = {},
): Promise<LineGroupRow[]> {
  const rows = await client.$queryRaw<LineGroupSql[]>`
    ${salesBase(window, scope)}
    SELECT c.id, c.name, NULL::text AS detail, ${LINE_COLUMNS}
    FROM "OrderItem" oi
    JOIN base b ON b.id = oi."orderId"
    JOIN "ProductVariant" v ON v.id = oi."variantId"
    JOIN "Product" p ON p.id = v."productId"
    JOIN "Category" c ON c.id = p."categoryId"
    GROUP BY c.id, c.name
    ORDER BY SUM(oi."lineTotalCentavos") DESC, c.name
  `;
  return rows.map(toLineGroup);
}

export type CustomerSalesRow = SalesFigures & {
  customerId: string;
  name: string;
  code: string;
  segment: CustomerSegment;
};

/** Customers by revenue in the window. Walk-in sales have no customer and are left out. */
export async function salesByCustomer(
  client: Client,
  window: Pick<Window, "from" | "to">,
  options: { limit?: number; scope?: SalesScope } = {},
): Promise<CustomerSalesRow[]> {
  const limit = options.limit ? Prisma.sql`LIMIT ${options.limit}::int` : Prisma.empty;
  const rows = await client.$queryRaw<
    (FigureRow & { customer_id: string; name: string; code: string; segment: CustomerSegment })[]
  >`
    ${salesBase(window, options.scope)}
    SELECT b.customer_id, c."displayName" AS name, c.code, c.segment, ${FIGURE_COLUMNS}
    FROM base b JOIN "Customer" c ON c.id = b.customer_id
    GROUP BY b.customer_id, c."displayName", c.code, c.segment
    ORDER BY SUM(revenue) DESC, c."displayName"
    ${limit}
  `;
  return rows.map((row) => ({
    customerId: row.customer_id,
    name: row.name,
    code: row.code,
    segment: row.segment,
    ...toFigures(row),
  }));
}
