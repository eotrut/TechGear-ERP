import { faker } from "@faker-js/faker";

import { vatOnNet } from "../../src/lib/vat";
import type { SeedContext } from "./lib/context";
import { addDays, atBusinessHour, chance, intBetween, pick } from "./lib/helpers";

/**
 * Opening stock plus a year of purchasing.
 *
 * Runs before sales so every variant has inventory before anything is sold,
 * which is what keeps the ledger from ever going negative.
 */

/**
 * Units to stock at launch, by price tier, scaled by how well the SKU sells.
 *
 * Sized so that a year of demand turns the inventory roughly three to four
 * times, which is what peripherals retail actually looks like. Stocking a year
 * of cover would make the inventory valuation report larger than annual
 * revenue, which reads as invented.
 */
function openingQtyFor(priceCentavos: number, popularity: number): number {
  const pesos = priceCentavos / 100;
  const base = pesos < 600 ? 150 : pesos < 2000 ? 75 : pesos < 6000 ? 36 : 18;
  return Math.max(8, Math.round(base * Math.min(popularity, 1.8)));
}

export function buildOpeningStock(ctx: SeedContext): void {
  const { ledger, warehouses, variants } = ctx;
  const openedAt = addDays(ctx.windowStart, -30);
  const main = warehouses[0];
  const hub = warehouses[1];
  if (!main || !hub) throw new Error("Expected two seeded warehouses");

  for (const variant of variants) {
    const total = openingQtyFor(variant.priceCentavos, variant.popularity);
    // The Manila warehouse carries the bulk; Cebu is a smaller satellite.
    const cebuQty = Math.max(4, Math.round(total * 0.3));
    const manilaQty = total - cebuQty;

    ledger.receive({
      variantId: variant.id,
      warehouseId: main.id,
      qty: manilaQty,
      unitCostCentavos: variant.baseCostCentavos,
      type: "RECEIPT",
      reason: "OPENING_BALANCE",
      occurredAt: openedAt,
      actorId: ctx.users.warehouse.id,
      note: "Opening balance at go-live",
    });

    ledger.receive({
      variantId: variant.id,
      warehouseId: hub.id,
      qty: cebuQty,
      unitCostCentavos: variant.baseCostCentavos,
      type: "RECEIPT",
      reason: "OPENING_BALANCE",
      occurredAt: openedAt,
      actorId: ctx.users.warehouse.id,
      note: "Opening balance at go-live",
    });
  }
}

/** 15 purchase orders across the window, in every status the flow allows. */
const PO_STATUS_PLAN = [
  "RECEIVED",
  "RECEIVED",
  "CLOSED",
  "RECEIVED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "SENT",
  "RECEIVED",
  "PARTIALLY_RECEIVED",
  "SENT",
  "CANCELLED",
  "SENT",
  "DRAFT",
  "DRAFT",
] as const;

export function buildPurchasing(ctx: SeedContext): void {
  const { tables, variants, warehouses } = ctx;
  const main = warehouses[0];
  if (!main) throw new Error("Expected a default warehouse");

  const year = ctx.now.getUTCFullYear();
  let receiptCounter = 0;
  let billCounter = 0;

  PO_STATUS_PLAN.forEach((status, index) => {
    const poNumber = `PO-${year}-${String(index + 1).padStart(4, "0")}`;
    const poId = `po_${String(index + 1).padStart(6, "0")}`;
    const supplierId = ctx.supplierIds[index % ctx.supplierIds.length];
    if (!supplierId) throw new Error("Expected seeded suppliers");

    // Spread across the window, newest statuses last.
    const dayOffset = Math.round((index / PO_STATUS_PLAN.length) * 330) + intBetween(0, 12);
    const orderDate = atBusinessHour(addDays(ctx.windowStart, dayOffset));
    const expectedDate = addDays(orderDate, intBetween(5, 24));

    const lineCount = intBetween(9, 20);
    const chosen = faker.helpers.arrayElements(variants, lineCount);

    let subtotal = 0;
    const items = chosen.map((variant, lineIndex) => {
      const itemId = `poi_${poId}_${lineIndex}`;
      const qty = orderQtyFor(variant.priceCentavos);
      // Supplier pricing drifts, which is what makes the moving average move.
      const unitCost = Math.round(
        variant.baseCostCentavos * faker.number.float({ min: 0.92, max: 1.09 }),
      );
      const lineTotal = qty * unitCost;
      subtotal += lineTotal;
      return { itemId, variant, qty, unitCost, lineTotal };
    });

    const shipping = intBetween(0, 3) === 0 ? 0 : intBetween(45000, 320000);
    const vat = vatOnNet(subtotal);
    const total = subtotal + shipping + vat;

    const isCancelled = status === "CANCELLED";
    const isDraft = status === "DRAFT";
    const receives =
      status === "RECEIVED" || status === "CLOSED" || status === "PARTIALLY_RECEIVED";

    tables.purchaseOrders.push({
      id: poId,
      poNumber,
      supplierId,
      warehouseId: main.id,
      status,
      orderDate,
      expectedDate,
      sentAt: isDraft ? null : orderDate,
      closedAt: status === "CLOSED" ? addDays(expectedDate, intBetween(1, 9)) : null,
      cancelledAt: isCancelled ? addDays(orderDate, intBetween(2, 11)) : null,
      subtotalCentavos: subtotal,
      discountCentavos: 0,
      shippingCentavos: shipping,
      vatCentavos: vat,
      totalCentavos: total,
      notes: isCancelled ? "Cancelled: supplier could not commit to the delivery window." : null,
      createdById: ctx.users.manager.id,
      approvedById: isDraft ? null : ctx.users.admin.id,
      createdAt: orderDate,
      updatedAt: orderDate,
    });

    // A partially received PO gets stock for only some of its lines.
    const receivedLineCount =
      status === "PARTIALLY_RECEIVED" ? Math.max(1, Math.floor(items.length / 2)) : items.length;

    const receivedAt = addDays(expectedDate, intBetween(-2, 6));
    let receiptId: string | null = null;

    if (receives) {
      receiptCounter += 1;
      receiptId = `rcp_${String(receiptCounter).padStart(6, "0")}`;
      tables.purchaseReceipts.push({
        id: receiptId,
        reference: `GRN-${year}-${String(receiptCounter).padStart(4, "0")}`,
        purchaseOrderId: poId,
        receivedById: ctx.users.warehouse.id,
        receivedAt,
        note: status === "PARTIALLY_RECEIVED" ? "Balance of the order still in transit." : null,
      });
    }

    items.forEach((item, lineIndex) => {
      const isReceivedLine = receives && lineIndex < receivedLineCount;
      const qtyReceived = isReceivedLine ? item.qty : 0;

      tables.purchaseOrderItems.push({
        id: item.itemId,
        purchaseOrderId: poId,
        variantId: item.variant.id,
        qtyOrdered: item.qty,
        qtyReceived,
        unitCostCentavos: item.unitCost,
        discountCentavos: 0,
        lineTotalCentavos: item.lineTotal,
      });

      if (!isReceivedLine || !receiptId) return;

      const receiptItemId = `rci_${item.itemId}`;
      const rejected = chance(0.08) ? intBetween(1, Math.max(1, Math.floor(item.qty * 0.05))) : 0;
      const goodQty = item.qty - rejected;

      tables.purchaseReceiptItems.push({
        id: receiptItemId,
        receiptId,
        purchaseOrderItemId: item.itemId,
        qtyReceived: goodQty,
        unitCostCentavos: item.unitCost,
        qtyRejected: rejected,
      });

      if (goodQty > 0) {
        // Queued, not applied. Stock cannot be sold before it lands, so the
        // sales builder drains this by date as it walks through the year.
        ctx.pendingReceipts.push({
          occurredAt: receivedAt,
          variantId: item.variant.id,
          warehouseId: main.id,
          qty: goodQty,
          unitCostCentavos: item.unitCost,
          receiptItemId,
          actorId: ctx.users.warehouse.id,
        });
      }
    });

    // --------------------------------------------------------- bill and payment
    if (!receives) return;

    billCounter += 1;
    const billId = `bil_${String(billCounter).padStart(6, "0")}`;
    const issueDate = addDays(receivedAt, intBetween(0, 4));
    const termsDays = pick([15, 30, 30, 60]);
    const dueDate = addDays(issueDate, termsDays);

    // Older bills are settled; recent ones are still open, which is what makes
    // the payables aging report have something to show.
    const ageDays = Math.round((ctx.now.getTime() - dueDate.getTime()) / 86_400_000);
    const fullyPaid = ageDays > 20 || chance(0.35);
    const partiallyPaid = !fullyPaid && chance(0.4);

    const amountPaid = fullyPaid ? total : partiallyPaid ? Math.round(total * 0.5) : 0;
    const billStatus = fullyPaid ? "PAID" : partiallyPaid ? "PARTIALLY_PAID" : "OPEN";

    tables.supplierBills.push({
      id: billId,
      billNumber: `SB-${year}-${String(billCounter).padStart(4, "0")}`,
      supplierId,
      purchaseOrderId: poId,
      status: billStatus,
      issueDate,
      dueDate,
      subtotalCentavos: subtotal + shipping,
      vatCentavos: vat,
      totalCentavos: total,
      amountPaidCentavos: amountPaid,
      notes: null,
      createdAt: issueDate,
      updatedAt: issueDate,
    });

    if (amountPaid > 0) {
      tables.supplierPayments.push({
        id: `spm_${billId}`,
        billId,
        amountCentavos: amountPaid,
        method: pick(["BANK_TRANSFER", "BANK_TRANSFER", "CASH", "GCASH"]),
        reference: `REF${faker.string.numeric(9)}`,
        paidAt: addDays(issueDate, intBetween(3, Math.max(4, termsDays))),
        createdById: ctx.users.manager.id,
      });
    }
  });
}

function orderQtyFor(priceCentavos: number): number {
  const pesos = priceCentavos / 100;
  if (pesos < 600) return intBetween(70, 190);
  if (pesos < 2000) return intBetween(35, 95);
  if (pesos < 6000) return intBetween(16, 44);
  return intBetween(7, 20);
}
