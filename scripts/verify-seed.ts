import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { recomputeSegments } from "../src/features/customers/services/segments";
import { summariseAging } from "../src/features/purchasing/services/bill-rules";
import { supplierDeliveries } from "../src/features/suppliers/services/performance";
import { supplierPerformance } from "../src/features/suppliers/services/performance-rules";
import { addBusinessHours, SLA_HOURS } from "../src/features/tickets/services/sla";

/**
 * Row counts and integrity checks for the seeded database.
 *
 * Every check here is an invariant the running app must also maintain, so this
 * doubles as a regression harness: docs/PLAN.md section 6.5 lists the stock
 * ledger invariants, and the money checks follow decision D-6 (VAT inclusive).
 *
 * Exits non-zero if anything fails, so it can gate CI.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

let failures = 0;
let checks = 0;

function check(label: string, passed: boolean, detail?: string): void {
  checks += 1;
  if (passed) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function expectAtLeast(label: string, actual: number, minimum: number): void {
  check(`${label}: ${actual} (SPEC wants ${minimum}+)`, actual >= minimum);
}

function heading(title: string): void {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

async function scalar(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ value: bigint | number | null }[]>(sql);
  const value = rows[0]?.value;
  return value === null || value === undefined ? 0 : Number(value);
}

async function sample(sql: string, limit = 3): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  return rows
    .slice(0, limit)
    .map((row) =>
      JSON.stringify(row, (_key, value) => (typeof value === "bigint" ? Number(value) : value)),
    )
    .join("\n        ");
}

async function main(): Promise<void> {
  // ===================================================================== counts
  heading("Row counts");

  const counts = {
    users: await prisma.user.count(),
    categories: await prisma.category.count(),
    brands: await prisma.brand.count(),
    products: await prisma.product.count(),
    variants: await prisma.productVariant.count(),
    productSpecs: await prisma.productSpec.count(),
    warehouses: await prisma.warehouse.count(),
    suppliers: await prisma.supplier.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
    purchaseReceipts: await prisma.purchaseReceipt.count(),
    supplierBills: await prisma.supplierBill.count(),
    customers: await prisma.customer.count(),
    addresses: await prisma.address.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    payments: await prisma.payment.count(),
    returns: await prisma.return.count(),
    refunds: await prisma.refund.count(),
    warrantyClaims: await prisma.warrantyClaim.count(),
    promos: await prisma.promo.count(),
    leads: await prisma.lead.count(),
    activities: await prisma.activity.count(),
    tickets: await prisma.ticket.count(),
    ticketComments: await prisma.ticketComment.count(),
    expenses: await prisma.expense.count(),
    stockLevels: await prisma.stockLevel.count(),
    stockMovements: await prisma.stockMovement.count(),
    stockAdjustments: await prisma.stockAdjustment.count(),
    stockTransfers: await prisma.stockTransfer.count(),
    notifications: await prisma.notification.count(),
    auditLogs: await prisma.auditLog.count(),
  };

  const width = Math.max(...Object.keys(counts).map((key) => key.length));
  for (const [label, value] of Object.entries(counts)) {
    console.log(`  ${label.padEnd(width)}  ${String(value).padStart(6)}`);
  }

  // ============================================================ SPEC section 7
  heading("SPEC section 7 targets");
  check(`4 demo users, one per role: ${counts.users} users seeded`, counts.users >= 4);
  expectAtLeast("Brands", counts.brands, 12);
  expectAtLeast("Categories", counts.categories, 8);
  expectAtLeast("Products", counts.products, 60);
  expectAtLeast("Variants", counts.variants, 150);
  check(`Warehouses: ${counts.warehouses}`, counts.warehouses === 2);
  expectAtLeast("Suppliers", counts.suppliers, 8);
  check(`Purchase orders: ${counts.purchaseOrders}`, counts.purchaseOrders === 15);
  expectAtLeast("Customers", counts.customers, 120);
  expectAtLeast("Orders", counts.orders, 400);
  expectAtLeast("Leads", counts.leads, 30);
  expectAtLeast("Tickets", counts.tickets, 20);
  expectAtLeast(
    "Expense months covered",
    await scalar(
      `SELECT COUNT(DISTINCT date_trunc('month', "incurredAt"))::int AS value FROM "Expense"`,
    ),
    12,
  );
  expectAtLeast("Returns", counts.returns, 1);
  expectAtLeast("Warranty claims", counts.warrantyClaims, 1);

  const roleCount = await scalar(
    `SELECT COUNT(DISTINCT role)::int AS value FROM "User" WHERE "isActive" = true`,
  );
  check(`All four roles present among active users: ${roleCount}`, roleCount === 4);

  const channelCount = await scalar(`SELECT COUNT(DISTINCT channel)::int AS value FROM "Order"`);
  check(`All seven sales channels used: ${channelCount}`, channelCount === 7);

  const statusCount = await scalar(`SELECT COUNT(DISTINCT status)::int AS value FROM "Order"`);
  expectAtLeast("Distinct order statuses", statusCount, 7);

  const poStatusCount = await scalar(
    `SELECT COUNT(DISTINCT status)::int AS value FROM "PurchaseOrder"`,
  );
  expectAtLeast("Distinct purchase order statuses", poStatusCount, 5);

  const monthsCovered = await scalar(
    `SELECT COUNT(DISTINCT date_trunc('month', "placedAt"))::int AS value FROM "Order"`,
  );
  expectAtLeast("Months of order history", monthsCovered, 12);

  // ============================================================ stock integrity
  heading("Stock ledger integrity");

  const negativeStock = await scalar(
    `SELECT COUNT(*)::int AS value FROM "StockLevel" WHERE "onHand" < 0 OR "reserved" < 0 OR "reserved" > "onHand"`,
  );
  check(
    "No negative stock, and reservations never exceed on-hand",
    negativeStock === 0,
    negativeStock > 0
      ? await sample(
          `SELECT "variantId", "warehouseId", "onHand", "reserved" FROM "StockLevel" WHERE "onHand" < 0 OR "reserved" < 0 OR "reserved" > "onHand"`,
        )
      : undefined,
  );

  const ledgerMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT sl."variantId", sl."warehouseId", sl."onHand",
             COALESCE(SUM(sm."qtyDelta"), 0) AS summed
      FROM "StockLevel" sl
      LEFT JOIN "StockMovement" sm
        ON sm."variantId" = sl."variantId" AND sm."warehouseId" = sl."warehouseId"
      GROUP BY sl."variantId", sl."warehouseId", sl."onHand"
      HAVING sl."onHand" <> COALESCE(SUM(sm."qtyDelta"), 0)
    ) mismatched`);
  check(
    "Invariant 1: sum of movements equals StockLevel.onHand for every position",
    ledgerMismatch === 0,
    ledgerMismatch > 0
      ? await sample(`
          SELECT sl."variantId", sl."warehouseId", sl."onHand", COALESCE(SUM(sm."qtyDelta"),0)::int AS summed
          FROM "StockLevel" sl
          LEFT JOIN "StockMovement" sm ON sm."variantId" = sl."variantId" AND sm."warehouseId" = sl."warehouseId"
          GROUP BY sl."variantId", sl."warehouseId", sl."onHand"
          HAVING sl."onHand" <> COALESCE(SUM(sm."qtyDelta"),0)`)
      : undefined,
  );

  const balanceMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT DISTINCT ON (sm."variantId", sm."warehouseId")
             sm."variantId", sm."warehouseId", sm."balanceAfter", sl."onHand"
      FROM "StockMovement" sm
      JOIN "StockLevel" sl
        ON sl."variantId" = sm."variantId" AND sl."warehouseId" = sm."warehouseId"
      ORDER BY sm."variantId", sm."warehouseId", sm."occurredAt" DESC, sm.id DESC
    ) latest WHERE "balanceAfter" <> "onHand"`);
  check(
    "Invariant 2: latest movement balanceAfter equals StockLevel.onHand",
    balanceMismatch === 0,
  );

  const runningBalanceBreaks = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT "balanceAfter",
             SUM("qtyDelta") OVER (
               PARTITION BY "variantId", "warehouseId"
               ORDER BY "occurredAt", id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS running
      FROM "StockMovement"
    ) t WHERE "balanceAfter" <> running`);
  check(
    "Running balance is consistent at every point in the ledger, not just the end",
    runningBalanceBreaks === 0,
  );

  const negativeAtAnyPoint = await scalar(`
    SELECT COUNT(*)::int AS value FROM "StockMovement" WHERE "balanceAfter" < 0`);
  check("Stock never went negative at any point in the 12 month history", negativeAtAnyPoint === 0);

  const soldUnits = await scalar(`
    SELECT COALESCE(SUM(oi.qty), 0)::int AS value
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
    WHERE o.status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED','REFUNDED')
       -- Cancelled after payment: the SALE stands and a RETURN put the goods back.
       OR (o.status = 'CANCELLED' AND o."paidAt" IS NOT NULL)`);
  const saleMovementUnits = await scalar(`
    SELECT COALESCE(-SUM("qtyDelta"), 0)::int AS value FROM "StockMovement" WHERE type = 'SALE'`);
  check(
    `Invariant 4: units sold match SALE movements (${soldUnits} vs ${saleMovementUnits})`,
    soldUnits === saleMovementUnits,
  );

  const avgCostMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT DISTINCT ON (sm."variantId") sm."variantId", sm."avgCostAfterCentavos", v."avgCostCentavos"
      FROM "StockMovement" sm
      JOIN "ProductVariant" v ON v.id = sm."variantId"
      ORDER BY sm."variantId", sm."occurredAt" DESC, sm.id DESC
    ) latest WHERE "avgCostAfterCentavos" <> "avgCostCentavos"`);
  check("Invariant 5: variant moving average matches the latest movement", avgCostMismatch === 0);

  const reservedWithoutPending = await scalar(`
    SELECT COALESCE(SUM(sl."reserved"), 0)::int AS value FROM "StockLevel" sl`);
  const pendingUnits = await scalar(`
    SELECT COALESCE(SUM(oi.qty), 0)::int AS value
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId" WHERE o.status = 'PENDING'`);
  check(
    `Reserved stock matches pending order units (${reservedWithoutPending} vs ${pendingUnits})`,
    reservedWithoutPending === pendingUnits,
  );

  const outOfStock = await scalar(
    `SELECT COUNT(*)::int AS value FROM "StockLevel" WHERE "onHand" = 0`,
  );
  const lowStock = await scalar(`
    SELECT COUNT(*)::int AS value FROM "StockLevel" sl
    JOIN "ProductVariant" v ON v.id = sl."variantId"
    WHERE sl."onHand" > 0 AND sl."onHand" <= v."reorderLevel"`);
  check(`Out-of-stock positions present for the alerts page: ${outOfStock}`, outOfStock > 0);
  check(`Low-stock positions present for the alerts page: ${lowStock}`, lowStock > 0);

  // ======================================================== stock documents
  heading("Adjustments and transfers");

  const adjustmentDrift = await scalar(`
    SELECT COUNT(*)::int AS value FROM "StockAdjustmentItem" ai
    LEFT JOIN "StockMovement" sm ON sm."adjustmentItemId" = ai.id
    GROUP BY ai.id, ai."qtyDelta"
    HAVING COALESCE(SUM(sm."qtyDelta"), 0) <> ai."qtyDelta"
        OR COUNT(sm.id) <> CASE WHEN ai."qtyDelta" = 0 THEN 0 ELSE 1 END`);
  check(
    "Every adjustment line that changed stock has exactly one matching ledger movement",
    adjustmentDrift === 0,
  );

  const transferDrift = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT t.status, ti.qty, ti."qtyReceived",
        COALESCE(SUM(-sm."qtyDelta") FILTER (WHERE sm.type = 'TRANSFER_OUT'), 0) AS sent,
        COALESCE(SUM(sm."qtyDelta") FILTER (WHERE sm.type = 'TRANSFER_IN' AND sm."warehouseId" = t."toWarehouseId"), 0) AS arrived
      FROM "StockTransferItem" ti
      JOIN "StockTransfer" t ON t.id = ti."transferId"
      LEFT JOIN "StockMovement" sm ON sm."transferItemId" = ti.id
      GROUP BY ti.id, t.status, ti.qty, ti."qtyReceived"
    ) lines
    WHERE (status = 'RECEIVED'   AND (sent <> qty OR arrived <> "qtyReceived"))
       OR (status = 'IN_TRANSIT' AND (sent <> qty OR arrived <> 0))
       OR (status = 'DRAFT'      AND (sent <> 0 OR arrived <> 0))`);
  check(
    "Transfers moved exactly what their status says: out on dispatch, in on receipt, nothing as a draft",
    transferDrift === 0,
  );

  const transferStatuses = await scalar(
    `SELECT COUNT(DISTINCT status)::int AS value FROM "StockTransfer"`,
  );
  expectAtLeast("Distinct transfer statuses", transferStatuses, 4);

  const badReferences = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT reference, "createdAt" FROM "StockAdjustment"
      UNION ALL SELECT reference, "createdAt" FROM "StockTransfer"
    ) docs
    WHERE reference !~ '^(ADJ|TRF)-[0-9]{4}-[0-9]{4,}$'
       OR split_part(reference, '-', 2)::int
          <> EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Manila')::int`);
  check("Document numbers carry the Manila year they were raised in", badReferences === 0);

  const oversizedAdjustments = await scalar(
    `SELECT COUNT(*)::int AS value FROM "StockAdjustmentItem" WHERE ABS("qtyDelta") > 25`,
  );
  check(
    "Adjustment lines are shop-sized (no line moves more than 25 units)",
    oversizedAdjustments === 0,
  );

  // =============================================================== order money
  heading("Order and money integrity");

  const subtotalMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT o.id FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
      GROUP BY o.id, o."subtotalCentavos"
      HAVING o."subtotalCentavos" <> SUM(oi."lineSubtotalCentavos")
    ) t`);
  check("Order subtotal equals the sum of its line subtotals", subtotalMismatch === 0);

  const discountMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT o.id FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
      GROUP BY o.id, o."discountCentavos"
      HAVING o."discountCentavos" <> SUM(oi."discountCentavos")
    ) t`);
  check("Order discount equals the sum of its line discounts", discountMismatch === 0);

  const totalMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order"
    WHERE "totalCentavos" <> "subtotalCentavos" - "discountCentavos" + "shippingCentavos"`);
  check("Order total equals subtotal minus discount plus shipping", totalMismatch === 0);

  const lineTotalMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM "OrderItem"
    WHERE "lineTotalCentavos" <> "lineSubtotalCentavos" - "discountCentavos"`);
  check("Every line total equals its subtotal minus its discount", lineTotalMismatch === 0);

  const lineSubtotalMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM "OrderItem"
    WHERE "lineSubtotalCentavos" <> qty * "unitPriceCentavos"`);
  check("Every line subtotal equals quantity times unit price", lineSubtotalMismatch === 0);

  // VAT is inclusive at 12 percent: vat = round(total * 12 / 112). Rounding is
  // half away from zero, which is what ROUND() does in Postgres for numeric.
  const vatMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order"
    WHERE "vatCentavos" <> ROUND("totalCentavos"::numeric * 12 / 112)`);
  check("Order VAT equals 12 percent extracted from the VAT-inclusive total", vatMismatch === 0);

  const lineVatMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT o.id FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
      GROUP BY o.id
      HAVING SUM(oi."vatCentavos") <> ROUND(SUM(oi."lineTotalCentavos")::numeric * 12 / 112)
    ) t`);
  check("Line VAT sums exactly to the VAT on the goods total", lineVatMismatch === 0);

  const paymentMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT o.id, o."amountPaidCentavos", COALESCE(SUM(p."amountCentavos"), 0) AS paid
      FROM "Order" o LEFT JOIN "Payment" p ON p."orderId" = o.id
      GROUP BY o.id, o."amountPaidCentavos"
      HAVING o."amountPaidCentavos" <> COALESCE(SUM(p."amountCentavos"), 0)
    ) t`);
  check("Recorded payments sum to the order's amount paid", paymentMismatch === 0);

  // The settlement rules in order-rules.ts: one cash tender, and COD never split.
  const badSplits = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT "orderId" FROM "Payment" GROUP BY "orderId"
      HAVING COUNT(*) FILTER (WHERE method = 'CASH') > 1
          OR (COUNT(*) > 1 AND bool_or(method = 'COD'))
    ) t`);
  check("Split payments follow the settlement rules", badSplits === 0);

  const unpaidRealised = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order"
    WHERE status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED')
      AND "amountPaidCentavos" <> "totalCentavos"`);
  check("Every realised order is paid in full", unpaidRealised === 0);

  const unpaidDraft = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order"
    WHERE status IN ('DRAFT','PENDING') AND "amountPaidCentavos" <> 0`);
  check("Draft and pending orders carry no payment", unpaidDraft === 0);

  // Cancelling a paid order refunds it in full, so what it keeps is zero.
  const cancelledKeepsMoney = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order"
    WHERE status = 'CANCELLED' AND "amountPaidCentavos" <> "amountRefundedCentavos"`);
  check("Cancelled orders keep no money", cancelledKeepsMoney === 0);

  const overRefunded = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order" WHERE "amountRefundedCentavos" > "amountPaidCentavos"`);
  check("No order is refunded more than was paid", overRefunded === 0);

  const refundMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT o.id FROM "Order" o LEFT JOIN "Refund" r ON r."orderId" = o.id
      GROUP BY o.id, o."amountRefundedCentavos"
      HAVING o."amountRefundedCentavos" <> COALESCE(SUM(r."amountCentavos"), 0)
    ) t`);
  check("Refund rows sum to each order's amount refunded", refundMismatch === 0);

  // Decision D-19: refunded means the money or every unit went back.
  const looseRefunded = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT o.id FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE o.status = 'REFUNDED'
      GROUP BY o.id, o."amountPaidCentavos", o."amountRefundedCentavos"
      HAVING o."amountRefundedCentavos" < o."amountPaidCentavos"
         AND SUM(oi."qtyReturned") < SUM(oi.qty)
    ) t`);
  check("Refunded orders gave back all the money or every unit", looseRefunded === 0);

  const negativeMoney = await scalar(`
    SELECT (
      (SELECT COUNT(*) FROM "Order" WHERE "totalCentavos" < 0 OR "subtotalCentavos" < 0 OR "vatCentavos" < 0) +
      (SELECT COUNT(*) FROM "OrderItem" WHERE "unitPriceCentavos" < 0 OR "lineTotalCentavos" < 0 OR "unitCostCentavos" < 0) +
      (SELECT COUNT(*) FROM "ProductVariant" WHERE "priceCentavos" < 0 OR "avgCostCentavos" < 0)
    )::int AS value`);
  check("No negative money anywhere", negativeMoney === 0);

  const cogsMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT o.id FROM "Order" o JOIN "OrderItem" oi ON oi."orderId" = o.id
      WHERE o.status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED','REFUNDED')
      GROUP BY o.id, o."costTotalCentavos"
      HAVING o."costTotalCentavos" <> SUM(oi.qty * oi."unitCostCentavos")
    ) t`);
  check("Order COGS equals the sum of its line cost snapshots", cogsMismatch === 0);

  const marginBreaches = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order"
    WHERE status = 'COMPLETED' AND "costTotalCentavos" > "totalCentavos"
      -- A warranty replacement is a zero-value order by design (D-20).
      AND id NOT IN (SELECT "replacementOrderId" FROM "WarrantyClaim" WHERE "replacementOrderId" IS NOT NULL)`);
  check(
    `Completed orders are not sold below cost: ${marginBreaches} breaches`,
    marginBreaches === 0,
  );

  const returnOverflow = await scalar(`
    SELECT COUNT(*)::int AS value FROM "OrderItem" WHERE "qtyReturned" > qty`);
  check("No line is returned more times than it was sold", returnOverflow === 0);

  const promoMismatch = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT p.id FROM "Promo" p
      LEFT JOIN "PromoRedemption" r ON r."promoId" = p.id
      GROUP BY p.id, p."usageCount"
      HAVING p."usageCount" <> COUNT(r.id)
    ) t`);
  check("Promo usage counts match actual redemptions", promoMismatch === 0);

  const cancelledRedemptions = await scalar(`
    SELECT COUNT(*)::int AS value FROM "PromoRedemption" r
    JOIN "Order" o ON o.id = r."orderId" WHERE o.status = 'CANCELLED'`);
  check("Cancelled orders have given their promo use back", cancelledRedemptions === 0);

  const outOfWindow = await scalar(`
    SELECT COUNT(*)::int AS value FROM "PromoRedemption" r
    JOIN "Order" o ON o.id = r."orderId" JOIN "Promo" p ON p.id = r."promoId"
    WHERE o."createdAt" < p."startsAt" OR o."createdAt" > p."endsAt"`);
  check("Every promo was redeemed inside its dates", outOfWindow === 0);

  const overPromised = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT oi.id FROM "OrderItem" oi
      JOIN "ReturnItem" ri ON ri."orderItemId" = oi.id
      JOIN "Return" r ON r.id = ri."returnId"
      WHERE r.status IN ('REQUESTED','APPROVED','RECEIVED')
      GROUP BY oi.id, oi.qty, oi."qtyReturned"
      HAVING oi."qtyReturned" + SUM(ri.qty) > oi.qty
    ) t`);
  check("Open returns never hold more units than are still out", overPromised === 0);

  const unmovedReturns = await scalar(`
    SELECT COUNT(*)::int AS value FROM "ReturnItem" ri
    JOIN "Return" r ON r.id = ri."returnId"
    WHERE r.status = 'COMPLETED'
      AND NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."returnItemId" = ri.id)`);
  check("Every completed return line moved stock or booked a loss", unmovedReturns === 0);

  // SO, RMA and WC numbers restart each Manila year, from the day they were raised.
  const wrongYear = await scalar(`
    SELECT (
      (SELECT COUNT(*) FROM "Order"
        WHERE split_part("orderNumber", '-', 2)::int
          <> EXTRACT(YEAR FROM ("createdAt" + interval '8 hours'))) +
      (SELECT COUNT(*) FROM "Return"
        WHERE split_part("rmaNumber", '-', 2)::int
          <> EXTRACT(YEAR FROM ("requestedAt" + interval '8 hours'))) +
      (SELECT COUNT(*) FROM "WarrantyClaim"
        WHERE split_part("claimNumber", '-', 2)::int
          <> EXTRACT(YEAR FROM ("submittedAt" + interval '8 hours')))
    )::int AS value`);
  check("Sales document numbers carry the year they were raised in", wrongYear === 0);

  // ================================================================== content
  heading("Content quality");

  const dashes = await scalar(`
    SELECT (
      (SELECT COUNT(*) FROM "Product" WHERE name ~ '[\\u2013\\u2014]' OR description ~ '[\\u2013\\u2014]') +
      (SELECT COUNT(*) FROM "Customer" WHERE "displayName" ~ '[\\u2013\\u2014]') +
      (SELECT COUNT(*) FROM "Ticket" WHERE subject ~ '[\\u2013\\u2014]' OR description ~ '[\\u2013\\u2014]') +
      (SELECT COUNT(*) FROM "TicketComment" WHERE body ~ '[\\u2013\\u2014]') +
      (SELECT COUNT(*) FROM "Lead" WHERE title ~ '[\\u2013\\u2014]') +
      (SELECT COUNT(*) FROM "Expense" WHERE description ~ '[\\u2013\\u2014]') +
      (SELECT COUNT(*) FROM "Return" WHERE reason ~ '[\\u2013\\u2014]')
    )::int AS value`);
  check("No em-dash or en-dash in any seeded user-visible string", dashes === 0);

  const genericNames = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Customer"
    WHERE "displayName" ILIKE '%john doe%' OR "displayName" ILIKE '%jane doe%' OR "displayName" ILIKE '%acme%'`);
  check("No placeholder customer names", genericNames === 0);

  const missingAddress = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Customer" c
    WHERE NOT ('from-lead' = ANY(c.tags))
      AND NOT EXISTS (SELECT 1 FROM "Address" a WHERE a."customerId" = c.id)`);
  // A lead converted in the moment may not have an address yet; Customer 360
  // asks for one. Every other customer was created through the address form.
  check("Every customer has a Philippine address", missingAddress === 0);

  const badPhones = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Customer" WHERE phone IS NOT NULL AND phone NOT LIKE '+63%'`);
  check("Every phone number is in Philippine format", badPhones === 0);

  const specCoverage = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Product" p
    WHERE NOT EXISTS (SELECT 1 FROM "ProductSpec" s WHERE s."productId" = p.id)`);
  check("Every product has key-value specs", specCoverage === 0);

  // ============================================================ chart material
  heading("Chart material (SPEC: charts must be meaningful right after seeding)");

  const monthly = await prisma.$queryRawUnsafe<
    { month: Date; orders: bigint; revenue: bigint | null }[]
  >(`
    SELECT date_trunc('month', "placedAt") AS month,
           COUNT(*) AS orders,
           SUM("totalCentavos") AS revenue
    FROM "Order"
    WHERE status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED')
    GROUP BY 1 ORDER BY 1`);

  console.log("  month      orders    revenue (PHP)");
  for (const row of monthly) {
    const label = row.month.toISOString().slice(0, 7);
    const revenue = (Number(row.revenue ?? 0) / 100).toLocaleString("en-PH", {
      maximumFractionDigits: 0,
    });
    console.log(`  ${label}    ${String(row.orders).padStart(4)}    ${revenue.padStart(12)}`);
  }

  const peakDays = await prisma.$queryRawUnsafe<{ day: Date; orders: bigint }[]>(`
    SELECT date_trunc('day', "placedAt") AS day, COUNT(*) AS orders
    FROM "Order" GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
  console.log("\n  Busiest days:");
  for (const row of peakDays) {
    console.log(`    ${row.day.toISOString().slice(0, 10)}  ${row.orders} orders`);
  }

  const doubleDayOrders = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Order"
    WHERE (EXTRACT(MONTH FROM "placedAt") = 11 AND EXTRACT(DAY FROM "placedAt") = 11)
       OR (EXTRACT(MONTH FROM "placedAt") = 12 AND EXTRACT(DAY FROM "placedAt") = 12)`);
  const averageDaily = counts.orders / 365;
  check(
    `11.11 and 12.12 spikes are visible: ${doubleDayOrders} orders on those two days vs ${averageDaily.toFixed(1)} on an average day`,
    doubleDayOrders > averageDaily * 3,
  );

  const channels = await prisma.$queryRawUnsafe<
    { channel: string; orders: bigint; revenue: bigint | null }[]
  >(`
    SELECT channel, COUNT(*) AS orders, SUM("totalCentavos") AS revenue
    FROM "Order" WHERE status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED')
    GROUP BY 1 ORDER BY 2 DESC`);
  console.log("\n  Sales by channel:");
  for (const row of channels) {
    const revenue = (Number(row.revenue ?? 0) / 100).toLocaleString("en-PH", {
      maximumFractionDigits: 0,
    });
    console.log(
      `    ${row.channel.padEnd(9)} ${String(row.orders).padStart(4)} orders  PHP ${revenue.padStart(11)}`,
    );
  }

  const segments = await prisma.$queryRawUnsafe<{ segment: string; count: bigint }[]>(
    `SELECT segment, COUNT(*) AS count FROM "Customer" GROUP BY 1 ORDER BY 2 DESC`,
  );
  console.log("\n  Customer segments:");
  for (const row of segments) {
    console.log(`    ${row.segment.padEnd(8)} ${row.count}`);
  }
  check("All four customer segments are represented", segments.length === 4);

  const revenue = await scalar(`
    SELECT COALESCE(SUM("totalCentavos"), 0)::bigint AS value FROM "Order"
    WHERE status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED')`);
  const cogs = await scalar(`
    SELECT COALESCE(SUM("costTotalCentavos"), 0)::bigint AS value FROM "Order"
    WHERE status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED')`);
  const netRevenue = Math.round((revenue * 100) / 112);
  const marginPct = netRevenue > 0 ? ((netRevenue - cogs) / netRevenue) * 100 : 0;

  console.log(
    `\n  Gross revenue (VAT inclusive): PHP ${(revenue / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  Net of VAT:                    PHP ${(netRevenue / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`,
  );
  console.log(
    `  COGS:                          PHP ${(cogs / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`,
  );
  console.log(`  Gross margin:                  ${marginPct.toFixed(1)} percent`);

  check(
    `Gross margin is plausible for peripherals retail: ${marginPct.toFixed(1)} percent`,
    marginPct > 20 && marginPct < 55,
  );

  const inventoryValue = await scalar(`
    SELECT COALESCE(SUM(sl."onHand"::bigint * v."avgCostCentavos"), 0)::bigint AS value
    FROM "StockLevel" sl JOIN "ProductVariant" v ON v.id = sl."variantId"`);
  console.log(
    `  Inventory at cost:             PHP ${(inventoryValue / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`,
  );
  check("Inventory has value", inventoryValue > 0);

  // ============================================================== purchasing
  heading("Purchasing and payables");

  const receivedDrift = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT poi.id FROM "PurchaseOrderItem" poi
      LEFT JOIN "PurchaseReceiptItem" pri ON pri."purchaseOrderItemId" = poi.id
      GROUP BY poi.id, poi."qtyReceived"
      HAVING poi."qtyReceived" <> COALESCE(SUM(pri."qtyReceived"), 0)
    ) drift`);
  check("Each PO line's received quantity equals the sum of its receipts", receivedDrift === 0);

  const overReceived = await scalar(
    `SELECT COUNT(*)::int AS value FROM "PurchaseOrderItem" WHERE "qtyReceived" > "qtyOrdered"`,
  );
  check("No PO line is received past what was ordered", overReceived === 0);

  // Status is computed from the lines, never chosen (docs/PLAN.md 5.2).
  const statusDrift = await sample(`
    SELECT po."poNumber", po.status,
           SUM(poi."qtyReceived")::int AS received, SUM(poi."qtyOrdered")::int AS ordered
    FROM "PurchaseOrder" po JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
    GROUP BY po.id
    HAVING (po.status = 'RECEIVED' AND NOT BOOL_AND(poi."qtyReceived" >= poi."qtyOrdered"))
        OR (po.status = 'PARTIALLY_RECEIVED'
            AND (SUM(poi."qtyReceived") = 0 OR BOOL_AND(poi."qtyReceived" >= poi."qtyOrdered")))
        OR (po.status IN ('DRAFT', 'SENT', 'CANCELLED') AND SUM(poi."qtyReceived") > 0)
        OR (po.status = 'CLOSED' AND SUM(poi."qtyReceived") = 0)`);
  check("PO statuses match what arrived", statusDrift === "", statusDrift);

  const receiptsOnUnsent = await scalar(`
    SELECT COUNT(*)::int AS value FROM "PurchaseReceipt" pr
    JOIN "PurchaseOrder" po ON po.id = pr."purchaseOrderId"
    WHERE po.status IN ('DRAFT', 'CANCELLED')`);
  check("No delivery is booked against a draft or cancelled PO", receiptsOnUnsent === 0);

  const poMath = await sample(`
    SELECT po."poNumber" FROM "PurchaseOrder" po
    JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
    GROUP BY po.id
    HAVING po."subtotalCentavos" <> SUM(poi."lineTotalCentavos")
        OR BOOL_OR(poi."lineTotalCentavos" <> poi."qtyOrdered" * poi."unitCostCentavos")
        OR po."vatCentavos" <> ROUND((po."subtotalCentavos" + po."shippingCentavos") * 12 / 100.0)
        OR po."totalCentavos" <> po."subtotalCentavos" + po."shippingCentavos" + po."vatCentavos"`);
  check(
    "PO totals: lines, VAT on goods and freight, and total all reconcile",
    poMath === "",
    poMath,
  );

  const movementMismatch = await sample(`
    SELECT pri.id, pri."qtyReceived", COUNT(sm.id)::int AS movements
    FROM "PurchaseReceiptItem" pri
    LEFT JOIN "StockMovement" sm ON sm."purchaseReceiptItemId" = pri.id
    GROUP BY pri.id
    HAVING (pri."qtyReceived" > 0 AND (COUNT(sm.id) <> 1 OR SUM(sm."qtyDelta") <> pri."qtyReceived"
             OR BOOL_OR(sm.type <> 'RECEIPT')
             OR BOOL_OR(sm."unitCostCentavos" <> pri."unitCostCentavos")))
        OR (pri."qtyReceived" = 0 AND COUNT(sm.id) > 0)`);
  check(
    "Every accepted receipt line is one RECEIPT movement at its cost; rejects move nothing",
    movementMismatch === "",
    movementMismatch,
  );

  expectAtLeast(
    "POs received in more than one delivery",
    await scalar(`
      SELECT COUNT(*)::int AS value FROM (
        SELECT "purchaseOrderId" FROM "PurchaseReceipt" GROUP BY "purchaseOrderId" HAVING COUNT(*) > 1
      ) t`),
    1,
  );
  expectAtLeast(
    "Receipt lines with units rejected at the dock",
    await scalar(
      `SELECT COUNT(*)::int AS value FROM "PurchaseReceiptItem" WHERE "qtyRejected" > 0`,
    ),
    1,
  );

  const billMath = await sample(`
    SELECT b."billNumber", b.status, b."amountPaidCentavos",
           COALESCE(SUM(p."amountCentavos"), 0)::int AS paid
    FROM "SupplierBill" b LEFT JOIN "SupplierPayment" p ON p."billId" = b.id
    GROUP BY b.id
    HAVING b."amountPaidCentavos" <> COALESCE(SUM(p."amountCentavos"), 0)
        OR b."totalCentavos" <> b."subtotalCentavos" + b."vatCentavos"
        OR b."vatCentavos" <> ROUND(b."subtotalCentavos" * 12 / 100.0)
        OR (b.status = 'PAID' AND b."amountPaidCentavos" <> b."totalCentavos")
        OR (b.status = 'PARTIALLY_PAID'
            AND NOT (b."amountPaidCentavos" > 0 AND b."amountPaidCentavos" < b."totalCentavos"))
        OR (b.status = 'OPEN' AND b."amountPaidCentavos" <> 0)`);
  check(
    "Bills: payments sum to amount paid, VAT is 12% on top, status matches",
    billMath === "",
    billMath,
  );

  const overBilled = await sample(`
    SELECT po."poNumber" FROM "PurchaseOrder" po
    JOIN (SELECT "purchaseOrderId", SUM("subtotalCentavos")::bigint AS subtotal
          FROM "SupplierBill" WHERE status <> 'VOID' AND "purchaseOrderId" IS NOT NULL
          GROUP BY "purchaseOrderId") billed ON billed."purchaseOrderId" = po.id
    JOIN (SELECT poi."purchaseOrderId", SUM(pri."qtyReceived"::bigint * pri."unitCostCentavos") AS value
          FROM "PurchaseReceiptItem" pri
          JOIN "PurchaseOrderItem" poi ON poi.id = pri."purchaseOrderItemId"
          GROUP BY poi."purchaseOrderId") received ON received."purchaseOrderId" = po.id
    WHERE billed.subtotal > received.value + po."shippingCentavos"`);
  check("No PO is billed for more than arrived plus freight", overBilled === "", overBilled);

  const earlyPayments = await scalar(`
    SELECT COUNT(*)::int AS value FROM "SupplierPayment" p JOIN "SupplierBill" b ON b.id = p."billId"
    WHERE p."paidAt" < b."issueDate"`);
  check("No supplier payment predates its invoice", earlyPayments === 0);

  const futurePurchasing = await scalar(`
    SELECT (
      (SELECT COUNT(*) FROM "PurchaseReceipt" WHERE "receivedAt" > (now() AT TIME ZONE 'UTC')) +
      (SELECT COUNT(*) FROM "SupplierPayment" WHERE "paidAt" > (now() AT TIME ZONE 'UTC')) +
      (SELECT COUNT(*) FROM "SupplierBill" WHERE "issueDate" > (now() AT TIME ZONE 'UTC'))
    )::int AS value`);
  check("No receipt, bill or supplier payment is dated in the future", futurePurchasing === 0);

  // PO, GRN and SB numbers carry the Manila year of the date they were raised.
  const wrongPurchasingYear = await sample(`
    SELECT "poNumber" AS ref FROM "PurchaseOrder"
      WHERE split_part("poNumber", '-', 2)::int <> EXTRACT(YEAR FROM "orderDate" + interval '8 hours')
    UNION ALL SELECT reference FROM "PurchaseReceipt"
      WHERE split_part(reference, '-', 2)::int <> EXTRACT(YEAR FROM "receivedAt" + interval '8 hours')
    UNION ALL SELECT "billNumber" FROM "SupplierBill"
      WHERE split_part("billNumber", '-', 2)::int <> EXTRACT(YEAR FROM "issueDate" + interval '8 hours')`);
  check(
    "PO, GRN and SB numbers carry the Manila year they were raised in",
    wrongPurchasingYear === "",
    wrongPurchasingYear,
  );

  // Rates are measured, so the stored ones must equal a fresh measurement.
  const suppliers = await prisma.supplier.findMany({
    select: { id: true, name: true, onTimeRateBps: true, defectRateBps: true },
  });
  const rateDrift: string[] = [];
  for (const supplier of suppliers) {
    const measured = supplierPerformance(await supplierDeliveries(prisma, supplier.id));
    if (
      (measured.onTimeRateBps ?? 0) !== supplier.onTimeRateBps ||
      (measured.defectRateBps ?? 0) !== supplier.defectRateBps
    ) {
      rateDrift.push(supplier.name);
    }
  }
  check(
    "Supplier on-time and defect rates match their deliveries",
    rateDrift.length === 0,
    rateDrift.join(", "),
  );

  const aging = summariseAging(
    await prisma.supplierBill.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_PAID"] } },
      select: { status: true, dueDate: true, totalCentavos: true, amountPaidCentavos: true },
    }),
    new Date(),
  );
  check(
    `Payables aging has something to show: ${(aging.total / 100).toFixed(2)} owed, ${(
      (aging.total - aging.current) /
      100
    ).toFixed(2)} of it past due`,
    aging.total > 0 && aging.total > aging.current,
  );

  // ======================================================================= CRM
  heading("CRM");

  const wonUnlinked = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Lead" WHERE stage = 'WON' AND ("customerId" IS NULL OR "wonAt" IS NULL)`);
  check("Every won lead is linked to the customer it became", wonUnlinked === 0);

  const lostUnexplained = await scalar(`
    SELECT COUNT(*)::int AS value FROM "Lead"
    WHERE stage = 'LOST' AND ("lostReason" IS NULL OR "lostAt" IS NULL)`);
  check("Every lost lead records when and why", lostUnexplained === 0);

  const positionClashes = await scalar(`
    SELECT COUNT(*)::int AS value FROM (
      SELECT stage, position FROM "Lead" GROUP BY 1, 2 HAVING COUNT(*) > 1
    ) t`);
  check("Kanban positions are unique within each stage", positionClashes === 0);

  // Stored as UTC wall-clock; the session runs in Manila, so compare in UTC.
  const futureCrm = await scalar(`
    WITH now_utc AS (SELECT now() AT TIME ZONE 'UTC' AS t)
    SELECT (
      (SELECT COUNT(*) FROM "Lead", now_utc WHERE "createdAt" > t OR "wonAt" > t OR "lostAt" > t) +
      (SELECT COUNT(*) FROM "Activity", now_utc WHERE "createdAt" > t OR "completedAt" > t) +
      (SELECT COUNT(*) FROM "Ticket", now_utc
        WHERE "createdAt" > t OR "firstResponseAt" > t OR "resolvedAt" > t OR "closedAt" > t) +
      (SELECT COUNT(*) FROM "TicketComment", now_utc WHERE "createdAt" > t)
    )::int AS value`);
  check("No CRM event is dated in the future", futureCrm === 0);

  const tickets = await prisma.ticket.findMany({
    select: {
      ticketNumber: true,
      priority: true,
      status: true,
      createdAt: true,
      slaDueAt: true,
      firstResponseAt: true,
      resolvedAt: true,
      closedAt: true,
      customerId: true,
      order: { select: { customerId: true } },
      comments: {
        where: { isInternal: false },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const slaWrong = tickets.filter(
    (ticket) =>
      addBusinessHours(ticket.createdAt, SLA_HOURS[ticket.priority]).getTime() !==
      ticket.slaDueAt.getTime(),
  );
  check(
    "Ticket SLA targets are the priority's business hours from creation",
    slaWrong.length === 0,
    slaWrong.map((t) => t.ticketNumber).join(", "),
  );
  const responseWrong = tickets.filter(
    (ticket) =>
      (ticket.firstResponseAt?.getTime() ?? null) !==
      (ticket.comments[0]?.createdAt.getTime() ?? null),
  );
  check(
    "First response is the first reply the customer could see",
    responseWrong.length === 0,
    responseWrong.map((t) => t.ticketNumber).join(", "),
  );
  const lifecycleWrong = tickets.filter((ticket) => {
    const finished = ticket.status === "RESOLVED" || ticket.status === "CLOSED";
    if (finished !== (ticket.resolvedAt !== null)) return true;
    if ((ticket.status === "CLOSED") !== (ticket.closedAt !== null)) return true;
    return (
      ticket.closedAt !== null && ticket.resolvedAt !== null && ticket.closedAt < ticket.resolvedAt
    );
  });
  check("Ticket timestamps match their status", lifecycleWrong.length === 0);
  const foreignOrders = tickets.filter(
    (ticket) => ticket.order && ticket.order.customerId !== ticket.customerId,
  );
  check("A ticket's order belongs to the ticket's customer", foreignOrders.length === 0);

  const now = new Date();
  const openTickets = tickets.filter((t) => !t.resolvedAt);
  const breached = openTickets.filter((t) => t.slaDueAt < now).length;
  check(
    `Open tickets span the SLA clock: ${breached} breached, ${openTickets.length - breached} within target`,
    breached > 0 && openTickets.length - breached > 0,
  );

  const openActivities = await prisma.activity.count({ where: { status: "OPEN" } });
  const overdue = await prisma.activity.count({ where: { status: "OPEN", dueAt: { lt: now } } });
  check(
    `Overdue work is the exception: ${overdue} of ${openActivities} open activities`,
    overdue > 0 && overdue * 4 < openActivities,
  );

  // Recompute every segment inside a transaction that is always rolled back:
  // if the rules would move anybody, the stored segments are stale.
  let segmentDrift = -1;
  await prisma
    .$transaction(async (tx) => {
      segmentDrift = (await recomputeSegments(tx, now)).changed;
      throw new Error("rollback");
    })
    .catch(() => undefined);
  check(
    "Stored segments match the segment rules",
    segmentDrift === 0,
    `${segmentDrift} would move`,
  );

  // ==================================================================== summary
  heading("Summary");
  if (failures === 0) {
    console.log(`  All ${checks} checks passed.`);
  } else {
    console.log(`  ${failures} of ${checks} checks FAILED.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
