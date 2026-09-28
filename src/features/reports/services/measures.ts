import { Prisma, type OrderStatus, type PrismaClient } from "@prisma/client";

import { REALISED_STATUSES } from "@/features/orders/services/order-rules";
import { vatFromGross } from "@/lib/vat";

/**
 * The one definition of revenue (decision D-44).
 *
 * Every figure the dashboard and the reports show about sales is computed from
 * the order rows this module selects, with the arithmetic this module states.
 * That is what makes the dashboard's revenue equal the sales report's revenue,
 * the P&L's gross profit equal the gross profit report's, and the VAT summary's
 * output VAT agree with both: there is no second definition to drift.
 *
 *   Which orders   Realised ones (Paid, Packed, Shipped, Delivered, Completed),
 *                  the same set customer lifetime value counts. Drafts, pending,
 *                  cancelled and fully refunded orders are not sales. Warranty
 *                  replacement orders are excluded too: they are free, and
 *                  their cost is a warranty expense, not cost of sales (D-20).
 *   When           The Manila calendar day the order was placed. A later
 *                  refund or return is netted against the order it belongs to.
 *   Revenue        Total less refunds, VAT inclusive, shipping included. What
 *                  customers paid and kept.
 *   Output VAT     The order's VAT less the VAT inside its refunds.
 *   Net sales      Revenue less output VAT: the VAT-exclusive figure margin
 *                  and the P&L are measured on.
 *   COGS           The order's cost snapshot less the cost of units that came
 *                  back to the shelf. A unit returned and written off stays in
 *                  COGS, because the goods are gone.
 */

export type OrderMeasureInput = {
  totalCentavos: number;
  shippingCentavos: number;
  vatCentavos: number;
  amountRefundedCentavos: number;
  costTotalCentavos: number;
  /** Cost of the units a return put back on the shelf. */
  restockedCostCentavos: number;
};

export type OrderMeasures = {
  revenueCentavos: number;
  merchandiseCentavos: number;
  shippingCentavos: number;
  refundsCentavos: number;
  outputVatCentavos: number;
  netSalesCentavos: number;
  cogsCentavos: number;
  grossProfitCentavos: number;
};

/** The definition above, for one order. The SQL below computes exactly this. */
export function orderMeasures(order: OrderMeasureInput): OrderMeasures {
  const revenue = order.totalCentavos - order.amountRefundedCentavos;
  const outputVat = order.vatCentavos - vatFromGross(order.amountRefundedCentavos);
  const netSales = revenue - outputVat;
  const cogs = order.costTotalCentavos - order.restockedCostCentavos;
  return {
    revenueCentavos: revenue,
    merchandiseCentavos: order.totalCentavos - order.shippingCentavos,
    shippingCentavos: order.shippingCentavos,
    refundsCentavos: order.amountRefundedCentavos,
    outputVatCentavos: outputVat,
    netSalesCentavos: netSales,
    cogsCentavos: cogs,
    grossProfitCentavos: netSales - cogs,
  };
}

/** Gross margin in basis points of net sales, or null with no sales to measure. */
export function marginBps(grossProfitCentavos: number, netSalesCentavos: number): number | null {
  if (netSalesCentavos <= 0) return null;
  return Math.round((grossProfitCentavos / netSalesCentavos) * 10_000);
}

/** Average order value, rounded to the centavo. Zero with no orders. */
export function averageOrderValue(revenueCentavos: number, orders: number): number {
  return orders > 0 ? Math.round(revenueCentavos / orders) : 0;
}

// --------------------------------------------------------------------- SQL

export type Client = PrismaClient | Prisma.TransactionClient;

/**
 * An instant as the UTC wall-clock string the `timestamp` columns hold.
 * Binding a JS Date would send a timestamptz, which the Asia/Manila session
 * shifts by eight hours (see CLAUDE.md, Stock ledger).
 */
export function utc(instant: Date): string {
  return instant.toISOString().replace("T", " ").replace("Z", "");
}

/** Bounds as SQL, for a half-open window on any timestamp column. */
export function within(column: Prisma.Sql, window: { from: Date; to: Date }): Prisma.Sql {
  return Prisma.sql`${column} >= ${utc(window.from)}::timestamp AND ${column} < ${utc(window.to)}::timestamp`;
}

/** The Manila calendar day of a timestamp column, as "YYYY-MM-DD" text. */
export function manilaDaySql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`to_char(${column} + interval '8 hours', 'YYYY-MM-DD')`;
}

export function statusList(statuses: readonly OrderStatus[]): Prisma.Sql {
  return Prisma.join(statuses.map((status) => Prisma.sql`${status}::"OrderStatus"`));
}

export const REALISED_SQL = statusList(REALISED_STATUSES);

/** Cost put back on the shelf by returns, per order. */
export const RESTOCKED_CTE = Prisma.sql`
  restocked AS (
    SELECT oi."orderId" AS order_id,
           SUM(m."qtyDelta"::bigint * m."unitCostCentavos")::bigint AS cost
    FROM "StockMovement" m
    JOIN "ReturnItem" ri ON ri.id = m."returnItemId"
    JOIN "OrderItem" oi ON oi.id = ri."orderItemId"
    WHERE m.type = 'RETURN'
    GROUP BY oi."orderId"
  )`;

/** True for the zero-value orders that ship a warranty replacement. */
export const IS_REPLACEMENT = Prisma.sql`EXISTS (
  SELECT 1 FROM "WarrantyClaim" w WHERE w."replacementOrderId" = o.id
)`;

export type SalesScope = {
  /** Limit to one salesperson's orders, for the Sales role's own dashboard. */
  salespersonId?: string | null;
};

/**
 * The sales base: one row per order that counts, with every measure already
 * computed. Callers select from `base` after this WITH clause and add their
 * own columns to the CTE list with a leading comma.
 */
export function salesBase(window: { from: Date; to: Date }, scope: SalesScope = {}): Prisma.Sql {
  const bySalesperson = scope.salespersonId
    ? Prisma.sql`AND o."salespersonId" = ${scope.salespersonId}`
    : Prisma.empty;
  return Prisma.sql`
    WITH ${RESTOCKED_CTE},
    base AS (
      SELECT
        o.id,
        o.channel,
        o."customerId"                                                AS customer_id,
        o."salespersonId"                                             AS salesperson_id,
        ${manilaDaySql(Prisma.sql`o."placedAt"`)}                     AS day,
        (o."totalCentavos" - o."amountRefundedCentavos")::bigint      AS revenue,
        (o."totalCentavos" - o."shippingCentavos")::bigint            AS merchandise,
        o."shippingCentavos"::bigint                                  AS shipping,
        o."amountRefundedCentavos"::bigint                            AS refunds,
        (o."vatCentavos" - ROUND(o."amountRefundedCentavos" * 12 / 112.0))::bigint AS vat,
        (o."costTotalCentavos" - COALESCE(r.cost, 0))::bigint         AS cogs
      FROM "Order" o
      LEFT JOIN restocked r ON r.order_id = o.id
      WHERE o.status IN (${REALISED_SQL})
        AND ${within(Prisma.sql`o."placedAt"`, window)}
        AND NOT ${IS_REPLACEMENT}
        ${bySalesperson}
    )`;
}
