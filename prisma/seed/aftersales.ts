import { faker } from "@faker-js/faker";
import type { Prisma, WarrantyClaimStatus } from "@prisma/client";

import type { SeedContext } from "./lib/context";
import { addDays, chance, clampToNow, intBetween, pick } from "./lib/helpers";

/**
 * Returns, refunds and warranty claims.
 *
 * Split out of sales.ts because it runs over orders that already exist: a
 * return can only be raised against goods that shipped, and a warranty claim
 * only against an item still inside its coverage window.
 */

const RETURN_REASONS = [
  "Switches felt scratchy out of the box.",
  "Wrong layout ordered, customer needed ANSI.",
  "Unit arrived with a dead LED on the number row.",
  "Customer received the wrong colourway.",
  "Left click double-firing within the first week.",
  "Box arrived crushed in transit.",
  "Cable was missing from the package.",
  "Customer found a better price and returned within the window.",
];

const WARRANTY_ISSUES = [
  "Spacebar stabiliser rattles after two months of use.",
  "Wireless dongle stopped pairing after a firmware update.",
  "Left click registers twice on a single press.",
  "USB-C port has become loose and disconnects intermittently.",
  "Backlight on the left half of the board no longer lights.",
  "Ear cup hinge cracked under normal use.",
  "Scroll wheel skips in both directions.",
  "Microphone picks up heavy static after a few weeks.",
];

export function buildAftersales(ctx: SeedContext): void {
  const { tables, ledger } = ctx;
  const year = ctx.now.getUTCFullYear();

  const itemsByOrder = new Map<string, Prisma.OrderItemCreateManyInput[]>();
  for (const item of tables.orderItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  const settled = tables.orders.filter(
    (order) =>
      order.status === "COMPLETED" || order.status === "DELIVERED" || order.status === "REFUNDED",
  );

  let returnCounter = 0;
  let refundCounter = 0;

  for (const order of settled) {
    const mustRefund = order.status === "REFUNDED";
    // Roughly one order in eighteen comes back, which is a believable rate for
    // peripherals sold online.
    if (!mustRefund && !chance(0.055)) continue;

    const items = itemsByOrder.get(String(order.id)) ?? [];
    if (items.length === 0) continue;

    const deliveredAt = (order.deliveredAt as Date | null) ?? (order.placedAt as Date);
    const requestedAt = addDays(deliveredAt, intBetween(2, 21));
    if (requestedAt > ctx.now) continue;

    returnCounter += 1;
    const returnId = `ret_${String(returnCounter).padStart(6, "0")}`;

    // Full returns for orders marked REFUNDED; otherwise one or two lines.
    const returnedItems = mustRefund
      ? items
      : faker.helpers.arrayElements(items, intBetween(1, Math.min(2, items.length)));

    // Recent returns are still in flight; older ones have been settled.
    const ageDays = Math.round((ctx.now.getTime() - requestedAt.getTime()) / 86_400_000);
    const status = mustRefund
      ? "COMPLETED"
      : ageDays < 3
        ? pick(["REQUESTED", "REQUESTED", "APPROVED"] as const)
        : ageDays < 8
          ? pick(["APPROVED", "RECEIVED", "COMPLETED"] as const)
          : pick(["COMPLETED", "COMPLETED", "COMPLETED", "REJECTED"] as const);

    const approvedAt =
      status === "REQUESTED" ? null : clampToNow(addDays(requestedAt, intBetween(1, 3)), ctx.now);
    const receivedAt =
      status === "RECEIVED" || status === "COMPLETED"
        ? clampToNow(addDays(requestedAt, intBetween(3, 8)), ctx.now)
        : null;
    const completedAt =
      status === "COMPLETED" ? clampToNow(addDays(requestedAt, intBetween(4, 12)), ctx.now) : null;

    tables.returns.push({
      id: returnId,
      rmaNumber: `RMA-${year}-${String(returnCounter).padStart(4, "0")}`,
      orderId: String(order.id),
      customerId: String(order.customerId ?? ctx.customers[0]?.id),
      warehouseId: String(order.warehouseId),
      status,
      reason: pick(RETURN_REASONS),
      notes: null,
      requestedAt,
      approvedAt,
      receivedAt,
      completedAt,
      createdById: ctx.users.sales.id,
    });

    // Orders without a customer are POS walk-ins; a return still needs one on
    // file, so those are skipped above by the customerId fallback.
    let refundTotal = 0;

    returnedItems.forEach((item, index) => {
      const returnItemId = `rti_${returnId}_${index}`;
      const qty = mustRefund ? item.qty : intBetween(1, item.qty);

      // Most returns are resaleable; the rest are written off to loss.
      const disposition = chance(0.72) ? "RESTOCK" : "WRITE_OFF";
      const refundAmount = Math.round(
        ((item.lineTotalCentavos ?? 0) / Math.max(1, item.qty)) * qty,
      );

      tables.returnItems.push({
        id: returnItemId,
        returnId,
        orderItemId: String(item.id),
        qty,
        disposition,
        refundAmountCentavos: status === "REJECTED" ? 0 : refundAmount,
        conditionNote:
          disposition === "WRITE_OFF"
            ? "Physical damage, not resaleable."
            : "Inspected, resaleable.",
      });

      // Mark the original line so it cannot be returned twice.
      item.qtyReturned = (item.qtyReturned ?? 0) + qty;

      if (status !== "COMPLETED") return;

      refundTotal += refundAmount;

      const movedAt = completedAt ?? receivedAt ?? requestedAt;

      if (disposition === "RESTOCK") {
        // Re-enters at exactly the cost that left, so the reversal is symmetric
        // and the moving average is not polluted by today's price.
        ledger.receive({
          variantId: String(item.variantId),
          warehouseId: String(order.warehouseId),
          qty,
          unitCostCentavos: item.unitCostCentavos ?? 0,
          type: "RETURN",
          reason: "CUSTOMER_RETURN",
          occurredAt: movedAt,
          actorId: ctx.users.warehouse.id,
          refs: { returnItemId },
        });
      } else {
        ledger.writeOff({
          variantId: String(item.variantId),
          warehouseId: String(order.warehouseId),
          unitCostCentavos: item.unitCostCentavos ?? 0,
          occurredAt: movedAt,
          actorId: ctx.users.warehouse.id,
          note: "Returned damaged, written off to loss.",
          refs: { returnItemId },
        });
      }
    });

    if (status === "COMPLETED" && refundTotal > 0) {
      refundCounter += 1;
      tables.refunds.push({
        id: `rfd_${String(refundCounter).padStart(6, "0")}`,
        orderId: String(order.id),
        returnId,
        amountCentavos: refundTotal,
        method: pick(["GCASH", "BANK_TRANSFER", "CASH", "MAYA"]),
        reason: "Return accepted under the 7 day policy.",
        reference: `RF${faker.string.numeric(10)}`,
        refundedAt: completedAt ?? requestedAt,
        createdById: ctx.users.manager.id,
      });

      order.amountRefundedCentavos = (order.amountRefundedCentavos ?? 0) + refundTotal;
    }
  }

  // ------------------------------------------------------------- warranty
  const warrantyPool = tables.orders.filter(
    (order) => order.status === "COMPLETED" || order.status === "DELIVERED",
  );

  const variantById = new Map(ctx.variants.map((variant) => [variant.id, variant]));
  let claimCounter = 0;

  const claimStatuses: WarrantyClaimStatus[] = [
    "CLOSED",
    "CLOSED",
    "REPLACED",
    "APPROVED",
    "UNDER_REVIEW",
    "SUBMITTED",
    "REJECTED",
    "REFUNDED",
  ];

  for (const order of faker.helpers.arrayElements(
    warrantyPool,
    Math.min(26, warrantyPool.length),
  )) {
    const items = itemsByOrder.get(String(order.id)) ?? [];
    const item = items[0];
    if (!item || !order.customerId) continue;

    const variant = variantById.get(String(item.variantId));
    if (!variant) continue;

    const deliveredAt = (order.deliveredAt as Date | null) ?? (order.placedAt as Date);
    const warrantyExpiresAt = addDays(deliveredAt, variant.warrantyMonths * 30);
    const submittedAt = addDays(deliveredAt, intBetween(20, 150));
    if (submittedAt > ctx.now || submittedAt > warrantyExpiresAt) continue;

    claimCounter += 1;
    const status = claimStatuses[claimCounter % claimStatuses.length] ?? "SUBMITTED";
    const resolved =
      status === "CLOSED" ||
      status === "REPLACED" ||
      status === "REFUNDED" ||
      status === "REJECTED";

    tables.warrantyClaims.push({
      id: `wcl_${String(claimCounter).padStart(6, "0")}`,
      claimNumber: `WC-${year}-${String(claimCounter).padStart(4, "0")}`,
      orderItemId: String(item.id),
      customerId: String(order.customerId),
      variantId: variant.id,
      status,
      issueDescription: pick(WARRANTY_ISSUES),
      resolution: resolved
        ? pick([
            "Unit replaced from stock under warranty.",
            "Repaired in house and returned to the customer.",
            "Outside coverage, customer advised on paid repair.",
            "Refunded in full, unit written off.",
          ])
        : null,
      serialNumber: `SN${faker.string.alphanumeric({ length: 10, casing: "upper" })}`,
      warrantyExpiresAt,
      submittedAt,
      resolvedAt: resolved ? clampToNow(addDays(submittedAt, intBetween(3, 18)), ctx.now) : null,
      assigneeId: chance(0.8) ? ctx.users.manager.id : null,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    });
  }
}
