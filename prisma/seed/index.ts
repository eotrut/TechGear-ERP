import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { AuditAction, NotificationType, Role } from "@prisma/client";
import { faker } from "@faker-js/faker";

import { buildAftersales } from "./aftersales";
import { buildCatalogue, DEMO_PASSWORD } from "./catalogue";
import { buildCrm } from "./crm";
import { buildCustomers } from "./customers";
import { buildFinance } from "./finance";
import { buildOpeningStock, buildPurchasing } from "./purchasing";
import { buildSales } from "./sales";
import { emptyTables, type SeedContext } from "./lib/context";
import { SeedLedger } from "./lib/ledger";
import { addDays, atBusinessHour, chance, intBetween, pick, resetFaker } from "./lib/helpers";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const startedAt = Date.now();
  resetFaker();

  const now = new Date();
  const windowStart = addDays(now, -365);

  const ctx: SeedContext = {
    now,
    windowStart,
    tables: emptyTables(),
    ledger: new SeedLedger(),
    // Replaced by buildCatalogue; typed as non-optional for every later module.
    users: undefined as unknown as SeedContext["users"],
    warehouses: [],
    variants: [],
    customers: [],
    supplierIds: [],
    pendingReceipts: [],
  };

  console.log("Building catalogue and users ...");
  await buildCatalogue(ctx);

  console.log("Opening stock ...");
  buildOpeningStock(ctx);

  console.log("Purchase orders and receipts ...");
  buildPurchasing(ctx);

  console.log("Customers ...");
  buildCustomers(ctx);

  console.log("Orders across the last 12 months ...");
  buildSales(ctx);

  console.log("Returns and warranty claims ...");
  buildAftersales(ctx);

  console.log("Leads, activities and tickets ...");
  buildCrm(ctx);

  console.log("Expenses ...");
  buildFinance(ctx);

  console.log("Stock corrections and transfers ...");
  buildStockCorrections(ctx);

  console.log("Replaying the ledger in date order ...");
  replayLedger(ctx);

  console.log("Rollups and notifications ...");
  applyCustomerRollups(ctx);
  applyVariantCosts(ctx);
  buildOperationalRecords(ctx);

  console.log("Writing to the database ...");
  await writeAll(ctx);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nSeed complete in ${seconds}s.`);
  console.log(`Demo logins, password "${DEMO_PASSWORD}":`);
  console.log("  admin@techgear.ph      Admin");
  console.log("  manager@techgear.ph    Manager");
  console.log("  sales@techgear.ph      Sales");
  console.log("  warehouse@techgear.ph  Warehouse");
}

/**
 * A handful of deliberate low and out-of-stock positions, plus one inter-branch
 * transfer, so the alerts page and the ledger have something real to show.
 * SPEC section 7 asks for "a few low and out-of-stock items".
 */
function buildStockCorrections(ctx: SeedContext): void {
  const { ledger, tables, warehouses } = ctx;
  const main = warehouses[0];
  const hub = warehouses[1];
  if (!main || !hub) return;

  const year = ctx.now.getUTCFullYear();
  const adjustmentId = "adj_000001";
  // Dated today so it is the last event in the ledger. The quantities below are
  // derived from the final position, so anything happening after it would push
  // the replay negative.
  const adjustedAt = ctx.now;

  tables.stockAdjustments.push({
    id: adjustmentId,
    reference: `ADJ-${year}-0001`,
    warehouseId: main.id,
    reason: "COUNT_CORRECTION",
    note: "Quarterly cycle count, Manila main aisles A to D.",
    actorId: ctx.users.warehouse.id,
    createdAt: adjustedAt,
  });

  // Six SKUs driven to zero, ten driven under their reorder level.
  const candidates = ctx.variants.filter((v) => ledger.getOnHand(v.id, main.id) > 0);
  const outOfStock = faker.helpers.arrayElements(candidates, 6);
  const remaining = candidates.filter((v) => !outOfStock.includes(v));
  const lowStock = faker.helpers.arrayElements(remaining, 10);

  let itemIndex = 0;

  for (const variant of outOfStock) {
    const onHand = ledger.getOnHand(variant.id, main.id);
    const reserved = ledger.getReserved(variant.id, main.id);
    // Never cut into stock already promised to a pending order.
    const delta = -(onHand - reserved);
    if (delta >= 0) continue;

    const itemId = `adi_${adjustmentId}_${itemIndex}`;
    itemIndex += 1;

    tables.stockAdjustmentItems.push({
      id: itemId,
      adjustmentId,
      variantId: variant.id,
      qtyDelta: delta,
      countedQty: reserved,
      note: "Count came up short, shrinkage written off.",
    });

    ledger.adjust({
      variantId: variant.id,
      warehouseId: main.id,
      qtyDelta: delta,
      reason: "COUNT_CORRECTION",
      occurredAt: adjustedAt,
      actorId: ctx.users.warehouse.id,
      refs: { adjustmentItemId: itemId },
    });
  }

  for (const variant of lowStock) {
    const onHand = ledger.getOnHand(variant.id, main.id);
    const reserved = ledger.getReserved(variant.id, main.id);
    const target = Math.max(reserved, Math.max(1, Math.floor(variant.reorderLevel * 0.5)));
    const delta = target - onHand;
    if (delta >= 0) continue;

    const itemId = `adi_${adjustmentId}_${itemIndex}`;
    itemIndex += 1;

    tables.stockAdjustmentItems.push({
      id: itemId,
      adjustmentId,
      variantId: variant.id,
      qtyDelta: delta,
      countedQty: target,
      note: "Damaged units removed from saleable stock.",
    });

    ledger.adjust({
      variantId: variant.id,
      warehouseId: main.id,
      qtyDelta: delta,
      reason: "DAMAGE",
      occurredAt: adjustedAt,
      actorId: ctx.users.warehouse.id,
      refs: { adjustmentItemId: itemId },
    });
  }

  // A completed transfer from Manila to Cebu, placed early in the window while
  // opening stock is deep. Dating it recently would mean issuing units that
  // later orders have already consumed, which the replay would reject.
  const transferId = "trf_000001";
  const transferredAt = atBusinessHour(addDays(ctx.windowStart, 24));
  const transferVariants = faker.helpers
    .arrayElements(ctx.variants, 5)
    .filter((v) => ledger.getAvailable(v.id, main.id) > 10);

  if (transferVariants.length > 0) {
    tables.stockTransfers.push({
      id: transferId,
      reference: `TRF-${year}-0001`,
      fromWarehouseId: main.id,
      toWarehouseId: hub.id,
      status: "RECEIVED",
      note: "Rebalancing fast movers ahead of the Cebu weekend rush.",
      actorId: ctx.users.warehouse.id,
      shippedAt: transferredAt,
      receivedAt: addDays(transferredAt, 2),
      createdAt: transferredAt,
      updatedAt: addDays(transferredAt, 2),
    });

    transferVariants.forEach((variant, index) => {
      // Small and fixed, so it is comfortably covered by opening stock at the
      // date the transfer actually happened.
      const qty = Math.min(6, Math.floor(ledger.getAvailable(variant.id, main.id) / 8));
      if (qty <= 0) return;

      const itemId = `tri_${transferId}_${index}`;
      tables.stockTransferItems.push({
        id: itemId,
        transferId,
        variantId: variant.id,
        qty,
        qtyReceived: qty,
      });

      // Transfers are cost neutral: stock moves, the average does not.
      ledger.issue({
        variantId: variant.id,
        warehouseId: main.id,
        qty,
        type: "TRANSFER_OUT",
        reason: "TRANSFER",
        occurredAt: transferredAt,
        actorId: ctx.users.warehouse.id,
        refs: { transferItemId: itemId },
      });

      ledger.receive({
        variantId: variant.id,
        warehouseId: hub.id,
        qty,
        unitCostCentavos: ledger.getAvgCost(variant.id),
        type: "TRANSFER_IN",
        reason: "TRANSFER",
        occurredAt: addDays(transferredAt, 2),
        actorId: ctx.users.warehouse.id,
        recomputeAverage: false,
        refs: { transferItemId: itemId },
      });
    });
  }
}

/**
 * Recompute every running balance and COGS snapshot in true date order, then
 * push the corrected costs back onto the order lines. See
 * SeedLedger.replayChronologically for why this pass has to exist.
 */
function replayLedger(ctx: SeedContext): void {
  const { tables, ledger } = ctx;

  const returnItemToOrderItem = new Map<string, string>();
  for (const returnItem of tables.returnItems) {
    returnItemToOrderItem.set(String(returnItem.id), String(returnItem.orderItemId));
  }

  const { costByOrderItem } = ledger.replayChronologically(returnItemToOrderItem);

  // Back-fill the COGS each line actually carried at the time it sold.
  const costByOrder = new Map<string, number>();
  for (const item of tables.orderItems) {
    const replayed = costByOrderItem.get(String(item.id));
    if (replayed === undefined) continue;
    item.unitCostCentavos = replayed;
    const orderId = String(item.orderId);
    costByOrder.set(orderId, (costByOrder.get(orderId) ?? 0) + replayed * item.qty);
  }

  for (const order of tables.orders) {
    const cost = costByOrder.get(String(order.id));
    order.costTotalCentavos = cost ?? 0;
  }
}

/**
 * Lifetime value, order count and segment, computed from the orders actually
 * seeded rather than invented. Segment rules are decision D-9.
 */
function applyCustomerRollups(ctx: SeedContext): void {
  const { tables } = ctx;

  const stats = new Map<string, { total: number; count: number; last: Date }>();

  for (const order of tables.orders) {
    if (!order.customerId) continue;
    const realised =
      order.status === "PAID" ||
      order.status === "PACKED" ||
      order.status === "SHIPPED" ||
      order.status === "DELIVERED" ||
      order.status === "COMPLETED";
    if (!realised) continue;

    const id = String(order.customerId);
    const placedAt = order.placedAt as Date;
    const net = (order.totalCentavos ?? 0) - (order.amountRefundedCentavos ?? 0);
    const existing = stats.get(id);

    if (existing) {
      existing.total += net;
      existing.count += 1;
      if (placedAt > existing.last) existing.last = placedAt;
    } else {
      stats.set(id, { total: net, count: 1, last: placedAt });
    }
  }

  const totals = [...stats.values()].map((s) => s.total).sort((a, b) => b - a);
  const vipThreshold = totals[Math.floor(totals.length * 0.1)] ?? Number.MAX_SAFE_INTEGER;

  for (const customer of tables.customers) {
    const entry = stats.get(String(customer.id));
    if (!entry) {
      customer.segment = "NEW";
      continue;
    }

    const daysSinceLast = Math.round((ctx.now.getTime() - entry.last.getTime()) / 86_400_000);

    customer.lifetimeValueCentavos = entry.total;
    customer.orderCount = entry.count;
    customer.lastOrderAt = entry.last;
    customer.segment =
      daysSinceLast > 180
        ? "DORMANT"
        : entry.count >= 10 || entry.total >= vipThreshold
          ? "VIP"
          : entry.count >= 2
            ? "REPEAT"
            : "NEW";
  }
}

/** Copy the ledger's final moving average onto each variant. */
function applyVariantCosts(ctx: SeedContext): void {
  const costs = new Map(
    ctx.ledger.variantAvgCosts().map((row) => [row.variantId, row.avgCostCentavos]),
  );

  for (const variant of ctx.tables.variants) {
    const avg = costs.get(String(variant.id));
    if (avg !== undefined) variant.avgCostCentavos = avg;
  }
}

/** Notifications, audit trail and login attempts. */
function buildOperationalRecords(ctx: SeedContext): void {
  const { tables, ledger, warehouses } = ctx;
  const main = warehouses[0];
  if (!main) return;

  let notificationCounter = 0;
  const notify = (
    type: NotificationType,
    title: string,
    body: string,
    link: string,
    targetRole: Role | null,
    createdAt: Date,
  ): void => {
    notificationCounter += 1;
    tables.notifications.push({
      id: `ntf_${String(notificationCounter).padStart(6, "0")}`,
      userId: null,
      targetRole,
      type,
      title,
      body,
      link,
      readAt: chance(0.35) ? addDays(createdAt, 1) : null,
      createdAt,
    });
  };

  const variantById = new Map(ctx.variants.map((v) => [v.id, v]));

  // Low and out-of-stock alerts, generated from the real final positions.
  const lowPositions: { onHand: number; variant: (typeof ctx.variants)[number] }[] = [];
  for (const position of ledger.positions()) {
    if (position.warehouseId !== main.id) continue;
    const variant = variantById.get(position.variantId);
    if (!variant) continue;
    if (position.onHand > variant.reorderLevel) continue;
    lowPositions.push({ onHand: position.onHand, variant });
    if (lowPositions.length >= 12) break;
  }

  for (const row of lowPositions) {
    notify(
      row.onHand === 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
      row.onHand === 0 ? `Out of stock: ${row.variant.sku}` : `Low stock: ${row.variant.sku}`,
      `${row.variant.name} is at ${row.onHand} units in ${main.code}, reorder level ${row.variant.reorderLevel}.`,
      `/products/${row.variant.productId}/variants/${row.variant.id}`,
      "WAREHOUSE",
      addDays(ctx.now, -intBetween(0, 4)),
    );
  }

  for (const ticket of tables.tickets.filter((t) => t.status === "OPEN").slice(0, 4)) {
    notify(
      "NEW_TICKET",
      `New ticket: ${ticket.ticketNumber}`,
      String(ticket.subject),
      `/tickets/${ticket.id}`,
      "MANAGER",
      ticket.createdAt as Date,
    );
  }

  for (const receipt of tables.purchaseReceipts.slice(-3)) {
    notify(
      "PO_RECEIVED",
      `Stock received: ${receipt.reference}`,
      "Goods received and added to inventory.",
      `/purchasing/${receipt.purchaseOrderId}`,
      "MANAGER",
      receipt.receivedAt as Date,
    );
  }

  for (const activity of tables.activities
    .filter((a) => a.status === "OPEN" && (a.dueAt as Date) < ctx.now)
    .slice(0, 4)) {
    notify(
      "OVERDUE_TASK",
      "Task is overdue",
      String(activity.subject),
      "/activities/mine",
      null,
      activity.dueAt as Date,
    );
  }

  // ----------------------------------------------------------- audit trail
  let auditCounter = 0;
  const audit = (
    actorId: string,
    actorEmail: string,
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    summary: string,
    createdAt: Date,
  ): void => {
    auditCounter += 1;
    tables.auditLogs.push({
      id: `aud_${String(auditCounter).padStart(6, "0")}`,
      actorId,
      actorEmail,
      action,
      entityType,
      entityId,
      summary,
      changes: undefined,
      ipAddress: `112.198.${intBetween(1, 254)}.${intBetween(1, 254)}`,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      createdAt,
    });
  };

  // Logins over the last fortnight.
  for (let day = 14; day >= 0; day -= 1) {
    for (const user of [ctx.users.admin, ctx.users.manager, ctx.users.sales, ctx.users.warehouse]) {
      if (!chance(0.72)) continue;
      audit(
        user.id,
        user.email,
        "LOGIN",
        "User",
        user.id,
        `${user.name} signed in.`,
        atBusinessHour(addDays(ctx.now, -day)),
      );
    }
  }

  for (const product of tables.products.slice(0, 14)) {
    audit(
      ctx.users.manager.id,
      ctx.users.manager.email,
      "CREATE",
      "Product",
      String(product.id),
      `Created product ${product.name}.`,
      product.createdAt as Date,
    );
  }

  for (const adjustment of tables.stockAdjustments) {
    audit(
      ctx.users.warehouse.id,
      ctx.users.warehouse.email,
      "STOCK_ADJUST",
      "StockAdjustment",
      String(adjustment.id),
      `Recorded stock adjustment ${adjustment.reference}.`,
      adjustment.createdAt as Date,
    );
  }

  for (const order of tables.orders.filter((o) => o.status === "REFUNDED").slice(0, 8)) {
    audit(
      ctx.users.manager.id,
      ctx.users.manager.email,
      "STATUS_CHANGE",
      "Order",
      String(order.id),
      `Refunded order ${order.orderNumber}.`,
      (order.updatedAt as Date) ?? ctx.now,
    );
  }

  for (const variant of tables.variants.slice(0, 10)) {
    audit(
      ctx.users.admin.id,
      ctx.users.admin.email,
      "PRICE_CHANGE",
      "ProductVariant",
      String(variant.id),
      `Updated price for ${variant.sku}.`,
      addDays(ctx.now, -intBetween(20, 200)),
    );
  }

  // --------------------------------------------------------- login attempts
  let attemptCounter = 0;
  for (let day = 6; day >= 0; day -= 1) {
    for (const user of [ctx.users.admin, ctx.users.manager, ctx.users.sales, ctx.users.warehouse]) {
      attemptCounter += 1;
      tables.loginAttempts.push({
        id: `lat_${String(attemptCounter).padStart(6, "0")}`,
        email: user.email,
        ipAddress: `112.198.${intBetween(1, 254)}.${intBetween(1, 254)}`,
        success: true,
        createdAt: atBusinessHour(addDays(ctx.now, -day)),
      });
    }
  }

  // A short burst of failures, which is what the rate limiter exists for.
  for (let i = 0; i < 6; i += 1) {
    attemptCounter += 1;
    tables.loginAttempts.push({
      id: `lat_${String(attemptCounter).padStart(6, "0")}`,
      email: pick(["admin@techgear.ph", "manager@techgear.ph", "unknown@example.com"]),
      ipAddress: "203.177.42.19",
      success: false,
      createdAt: atBusinessHour(addDays(ctx.now, -1)),
    });
  }
}

async function writeAll(ctx: SeedContext): Promise<void> {
  const { tables, ledger } = ctx;

  // Clear everything except the migration history.
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
  `;
  const quoted = rows.map((row) => `"${row.tablename}"`).join(", ");
  if (quoted.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  }

  const stockLevels = ledger.positions().map((position) => ({
    id: `stl_${position.variantId}_${position.warehouseId}`,
    variantId: position.variantId,
    warehouseId: position.warehouseId,
    onHand: position.onHand,
    reserved: position.reserved,
    updatedAt: ctx.now,
  }));

  // Movements are written in chronological order so the ledger page reads as a
  // running balance without any sorting surprises. `recomputeAverage` and
  // `sequence` exist only for the replay pass and are not columns.
  const movements = [...ledger.movements]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.sequence - b.sequence)
    .map(({ recomputeAverage: _recomputeAverage, sequence: _sequence, ...row }) => row);

  // Insert order follows the foreign keys.
  const steps: [string, () => Promise<unknown>][] = [
    ["users", () => prisma.user.createMany({ data: tables.users })],
    ["appSettings", () => prisma.appSetting.createMany({ data: tables.appSettings })],
    ["categories", () => prisma.category.createMany({ data: tables.categories })],
    ["brands", () => prisma.brand.createMany({ data: tables.brands })],
    ["warehouses", () => prisma.warehouse.createMany({ data: tables.warehouses })],
    ["suppliers", () => prisma.supplier.createMany({ data: tables.suppliers })],
    ["customers", () => prisma.customer.createMany({ data: tables.customers })],
    ["addresses", () => prisma.address.createMany({ data: tables.addresses })],
    ["products", () => prisma.product.createMany({ data: tables.products })],
    ["productSpecs", () => prisma.productSpec.createMany({ data: tables.productSpecs })],
    ["productImages", () => prisma.productImage.createMany({ data: tables.productImages })],
    ["variants", () => prisma.productVariant.createMany({ data: tables.variants })],
    [
      "variantAttributes",
      () => prisma.productVariantAttribute.createMany({ data: tables.variantAttributes }),
    ],
    ["purchaseOrders", () => prisma.purchaseOrder.createMany({ data: tables.purchaseOrders })],
    [
      "purchaseOrderItems",
      () => prisma.purchaseOrderItem.createMany({ data: tables.purchaseOrderItems }),
    ],
    [
      "purchaseReceipts",
      () => prisma.purchaseReceipt.createMany({ data: tables.purchaseReceipts }),
    ],
    [
      "purchaseReceiptItems",
      () => prisma.purchaseReceiptItem.createMany({ data: tables.purchaseReceiptItems }),
    ],
    ["supplierBills", () => prisma.supplierBill.createMany({ data: tables.supplierBills })],
    [
      "supplierPayments",
      () => prisma.supplierPayment.createMany({ data: tables.supplierPayments }),
    ],
    ["promos", () => prisma.promo.createMany({ data: tables.promos })],
    ["orders", () => prisma.order.createMany({ data: tables.orders })],
    ["orderItems", () => prisma.orderItem.createMany({ data: tables.orderItems })],
    [
      "orderStatusEvents",
      () => prisma.orderStatusEvent.createMany({ data: tables.orderStatusEvents }),
    ],
    ["payments", () => prisma.payment.createMany({ data: tables.payments })],
    [
      "promoRedemptions",
      () => prisma.promoRedemption.createMany({ data: tables.promoRedemptions }),
    ],
    ["returns", () => prisma.return.createMany({ data: tables.returns })],
    ["returnItems", () => prisma.returnItem.createMany({ data: tables.returnItems })],
    ["refunds", () => prisma.refund.createMany({ data: tables.refunds })],
    ["warrantyClaims", () => prisma.warrantyClaim.createMany({ data: tables.warrantyClaims })],
    ["leads", () => prisma.lead.createMany({ data: tables.leads })],
    ["tickets", () => prisma.ticket.createMany({ data: tables.tickets })],
    ["ticketComments", () => prisma.ticketComment.createMany({ data: tables.ticketComments })],
    ["activities", () => prisma.activity.createMany({ data: tables.activities })],
    [
      "stockAdjustments",
      () => prisma.stockAdjustment.createMany({ data: tables.stockAdjustments }),
    ],
    [
      "stockAdjustmentItems",
      () => prisma.stockAdjustmentItem.createMany({ data: tables.stockAdjustmentItems }),
    ],
    ["stockTransfers", () => prisma.stockTransfer.createMany({ data: tables.stockTransfers })],
    [
      "stockTransferItems",
      () => prisma.stockTransferItem.createMany({ data: tables.stockTransferItems }),
    ],
    ["stockLevels", () => prisma.stockLevel.createMany({ data: stockLevels })],
    ["stockMovements", () => prisma.stockMovement.createMany({ data: movements })],
    ["expenses", () => prisma.expense.createMany({ data: tables.expenses })],
    ["notifications", () => prisma.notification.createMany({ data: tables.notifications })],
    ["auditLogs", () => prisma.auditLog.createMany({ data: tables.auditLogs })],
    ["loginAttempts", () => prisma.loginAttempt.createMany({ data: tables.loginAttempts })],
  ];

  for (const [label, run] of steps) {
    await run();
    process.stdout.write(`  ${label}\n`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("\nSeed failed:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
