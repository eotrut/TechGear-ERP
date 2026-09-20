import { faker } from "@faker-js/faker";
import type { OrderStatus, PaymentMethod, SalesChannel } from "@prisma/client";

import { allocateCentavos, applyBps, pesosToCentavos } from "../../src/lib/money";
import { vatFromGross } from "../../src/lib/vat";
import type { SeedContext, VariantRef } from "./lib/context";
import {
  addDays,
  addHours,
  atBusinessHour,
  chance,
  clampToNow,
  intBetween,
  pick,
  startOfDay,
  weightedPick,
} from "./lib/helpers";

/**
 * Twelve months of orders across every channel.
 *
 * Volume follows a real Philippine e-commerce calendar: the 11.11 and 12.12
 * double-day sales dominate, 9.9 and 10.10 are smaller spikes, Christmas lifts
 * the second half of December, and the 15th and 30th are paydays. Without that
 * shape the revenue chart is a flat band of noise and the dashboard says nothing.
 */

const CHANNEL_WEIGHTS: Record<SalesChannel, number> = {
  POS: 22,
  SHOPEE: 24,
  LAZADA: 17,
  TIKTOK: 12,
  FACEBOOK: 10,
  DIRECT: 9,
  B2B: 6,
};

/**
 * Tuned so the 11.11 and 12.12 peaks are visible on a monthly chart rather than
 * lost in daily noise, and so stock turns at a believable rate.
 */
const BASE_ORDERS_PER_DAY = 2.45;

function seasonalWeight(date: Date): number {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const weekday = date.getUTCDay();

  let weight = 1;

  // Double-day sales, the two biggest retail events of the PH calendar.
  if (month === 11 && day === 11) weight *= 5.2;
  else if (month === 11 && day >= 9 && day <= 12) weight *= 2.3;
  else if (month === 12 && day === 12) weight *= 4.6;
  else if (month === 12 && day >= 10 && day <= 13) weight *= 2.1;
  else if (month === 9 && day === 9) weight *= 2.5;
  else if (month === 10 && day === 10) weight *= 2.4;
  else if (month === 8 && day === 8) weight *= 1.8;

  // Christmas shopping.
  if (month === 12 && day >= 14 && day <= 24) weight *= 1.9;
  // The post-holiday lull is real and makes January look honest.
  if (month === 1 && day <= 20) weight *= 0.72;

  // Philippine paydays.
  if (day === 15 || day === 30) weight *= 1.35;
  if (day === 16 || day === 31 || day === 1) weight *= 1.15;

  // Weekends skew to walk-in and social selling.
  if (weekday === 6 || weekday === 0) weight *= 1.12;

  return weight;
}

/** Gentle growth across the year so the trend line rises. */
function growthFactor(dayIndex: number, totalDays: number): number {
  return 0.78 + (dayIndex / totalDays) * 0.5;
}

function pickWeightedVariant(variants: VariantRef[]): VariantRef {
  const total = variants.reduce((sum, variant) => sum + variant.popularity, 0);
  let roll = faker.number.float({ min: 0, max: total });
  for (const variant of variants) {
    roll -= variant.popularity;
    if (roll <= 0) return variant;
  }
  const last = variants[variants.length - 1];
  if (!last) throw new Error("No variants available");
  return last;
}

function qtyFor(variant: VariantRef, isBusiness: boolean): number {
  const pesos = variant.priceCentavos / 100;
  if (isBusiness) {
    if (pesos < 1000) return intBetween(10, 40);
    if (pesos < 4000) return intBetween(4, 15);
    return intBetween(2, 8);
  }
  if (pesos < 800) return intBetween(1, 4);
  if (pesos < 3000) return intBetween(1, 2);
  return 1;
}

/**
 * Where an order lands in the lifecycle, given how long ago it was placed.
 * Recent orders are still moving; old ones have settled.
 */
function statusForAge(ageDays: number, channel: SalesChannel): OrderStatus {
  if (channel === "POS") return chance(0.02) ? "REFUNDED" : "COMPLETED";

  if (ageDays <= 1) return weightedPick({ DRAFT: 12, PENDING: 46, PAID: 34, PACKED: 8 });
  if (ageDays <= 3) return weightedPick({ PENDING: 18, PAID: 30, PACKED: 32, SHIPPED: 20 });
  if (ageDays <= 7)
    return weightedPick({ PAID: 8, PACKED: 14, SHIPPED: 48, DELIVERED: 26, CANCELLED: 4 });
  if (ageDays <= 16)
    return weightedPick({ SHIPPED: 12, DELIVERED: 46, COMPLETED: 34, CANCELLED: 5, REFUNDED: 3 });
  return weightedPick({ COMPLETED: 84, DELIVERED: 5, CANCELLED: 7, REFUNDED: 4 });
}

const STATUS_LADDER: OrderStatus[] = [
  "DRAFT",
  "PENDING",
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
];

function ladderUpTo(status: OrderStatus): OrderStatus[] {
  const index = STATUS_LADDER.indexOf(status);
  if (index >= 0) return STATUS_LADDER.slice(0, index + 1);
  // Cancelled orders die early; refunded ones ran the full course first.
  if (status === "CANCELLED") return ["DRAFT", "PENDING", "CANCELLED"];
  return [...STATUS_LADDER, "REFUNDED"];
}

/** Has the order been paid, so stock should actually have left the building? */
function isRealised(status: OrderStatus): boolean {
  return (
    status === "PAID" ||
    status === "PACKED" ||
    status === "SHIPPED" ||
    status === "DELIVERED" ||
    status === "COMPLETED" ||
    status === "REFUNDED"
  );
}

const PAYMENT_BY_CHANNEL: Record<SalesChannel, PaymentMethod[]> = {
  POS: ["CASH", "CASH", "GCASH", "CARD", "MAYA"],
  SHOPEE: ["GCASH", "COD", "CARD", "MAYA"],
  LAZADA: ["GCASH", "COD", "CARD"],
  TIKTOK: ["GCASH", "COD", "MAYA"],
  FACEBOOK: ["GCASH", "GCASH", "MAYA", "BANK_TRANSFER"],
  DIRECT: ["BANK_TRANSFER", "GCASH", "CARD"],
  B2B: ["BANK_TRANSFER", "BANK_TRANSFER", "CARD"],
};

export function buildPromos(ctx: SeedContext): string[] {
  const { tables } = ctx;
  const year = ctx.now.getUTCFullYear();

  const promos = [
    {
      code: "TECHGEAR10",
      description: "10 percent off, launch promo",
      type: "PERCENT",
      percentBps: 1000,
      amountCentavos: null,
      min: 150000,
      limit: 500,
    },
    {
      code: "SINGLES1111",
      description: "11.11 double day, 15 percent off",
      type: "PERCENT",
      percentBps: 1500,
      amountCentavos: null,
      min: 200000,
      limit: 800,
    },
    {
      code: "DOUBLE1212",
      description: "12.12 double day, 12 percent off",
      type: "PERCENT",
      percentBps: 1200,
      amountCentavos: null,
      min: 200000,
      limit: 800,
    },
    {
      code: "PASKO500",
      description: "PHP 500 off Christmas orders",
      type: "FIXED",
      percentBps: null,
      amountCentavos: 50000,
      min: 300000,
      limit: 300,
    },
    {
      code: "FREESHIP",
      description: "PHP 150 shipping rebate",
      type: "FIXED",
      percentBps: null,
      amountCentavos: 15000,
      min: 100000,
      limit: null,
    },
    {
      code: "BULK5",
      description: "5 percent off B2B fitout orders",
      type: "PERCENT",
      percentBps: 500,
      amountCentavos: null,
      min: 2000000,
      limit: null,
    },
  ] as const;

  const ids: string[] = [];
  promos.forEach((promo, index) => {
    const id = `pro_${String(index + 1).padStart(6, "0")}`;
    ids.push(id);
    tables.promos.push({
      id,
      code: promo.code,
      description: promo.description,
      type: promo.type,
      percentBps: promo.percentBps,
      amountCentavos: promo.amountCentavos,
      minSubtotalCentavos: promo.min,
      startsAt: ctx.windowStart,
      endsAt: addDays(ctx.now, 45),
      usageLimit: promo.limit,
      usageCount: 0,
      perCustomerLimit: promo.code === "BULK5" ? null : 3,
      isActive: true,
      createdAt: ctx.windowStart,
      updatedAt: ctx.windowStart,
    });
  });

  // Keep the id list in sync with the summary label used in orders.
  void year;
  return ids;
}

export function buildSales(ctx: SeedContext): void {
  const { tables, ledger, variants, customers, warehouses } = ctx;
  const main = warehouses[0];
  const hub = warehouses[1];
  if (!main || !hub) throw new Error("Expected two seeded warehouses");

  const promoIds = buildPromos(ctx);
  const promoRows = tables.promos;

  const totalDays = Math.round((ctx.now.getTime() - ctx.windowStart.getTime()) / 86_400_000);

  // Purchase receipts land on their own dates. Draining them as the year is
  // walked is what makes the ledger chronologically honest: stock cannot be
  // sold on day 40 out of a delivery that arrives on day 200.
  const receipts = [...ctx.pendingReceipts].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  let receiptCursor = 0;

  let orderCounter = 0;
  let paymentCounter = 0;
  let eventCounter = 0;
  const promoUsage = new Map<string, number>();

  const year = ctx.now.getUTCFullYear();

  for (let dayIndex = 0; dayIndex <= totalDays; dayIndex += 1) {
    const day = startOfDay(addDays(ctx.windowStart, dayIndex));

    const endOfDay = addDays(day, 1);
    while (receiptCursor < receipts.length) {
      const receipt = receipts[receiptCursor];
      if (!receipt || receipt.occurredAt >= endOfDay) break;
      ledger.receive({
        variantId: receipt.variantId,
        warehouseId: receipt.warehouseId,
        qty: receipt.qty,
        unitCostCentavos: receipt.unitCostCentavos,
        type: "RECEIPT",
        reason: "PURCHASE_RECEIPT",
        occurredAt: receipt.occurredAt,
        actorId: receipt.actorId,
        refs: { purchaseReceiptItemId: receipt.receiptItemId },
      });
      receiptCursor += 1;
    }

    const expected = BASE_ORDERS_PER_DAY * seasonalWeight(day) * growthFactor(dayIndex, totalDays);

    const whole = Math.floor(expected);
    const count = whole + (chance(expected - whole) ? 1 : 0);

    for (let n = 0; n < count; n += 1) {
      orderCounter += 1;
      const orderId = `ord_${String(orderCounter).padStart(6, "0")}`;
      const placedAt = atBusinessHour(day);
      const ageDays = Math.round((ctx.now.getTime() - placedAt.getTime()) / 86_400_000);

      const channel = weightedPick(CHANNEL_WEIGHTS);
      const status = statusForAge(ageDays, channel);

      // B2B always goes to a business account; POS is often a walk-in.
      const activeNow = customers.filter(
        (c) => c.createdAt <= placedAt && placedAt <= c.activeUntil,
      );
      const businessCustomers = activeNow.filter((c) => c.isBusiness);
      const customer =
        channel === "B2B"
          ? businessCustomers[0]
            ? pick(businessCustomers)
            : null
          : channel === "POS" && chance(0.45)
            ? null
            : activeNow.length > 0
              ? pick(activeNow)
              : null;

      const isBusiness = customer?.isBusiness ?? false;
      const warehouseId = channel === "POS" ? main.id : chance(0.25) ? hub.id : main.id;

      // ------------------------------------------------------------- lines
      const lineCount = isBusiness ? intBetween(2, 6) : intBetween(1, 4);
      const chosen = new Map<string, { variant: VariantRef; qty: number }>();

      // Try other SKUs rather than abandoning the line when the first pick is
      // short, and buy what is on the shelf rather than nothing. Skipping the
      // slot outright made basket size shrink through the year as stock thinned,
      // which showed up as a steady fall in average order value.
      let attempts = 0;
      while (chosen.size < lineCount && attempts < lineCount * 8) {
        attempts += 1;
        const variant = pickWeightedVariant(variants);
        if (chosen.has(variant.id)) continue;

        const available = ledger.getAvailable(variant.id, warehouseId);
        if (available <= 0) continue;

        // Never sell stock that is not there. This is what keeps the ledger
        // non-negative without any after-the-fact patching.
        const qty = Math.min(qtyFor(variant, isBusiness), available);
        chosen.set(variant.id, { variant, qty });
      }

      if (chosen.size === 0) {
        orderCounter -= 1;
        continue;
      }

      const lines = [...chosen.values()];

      // ------------------------------------------------------------- money
      const lineSubtotals = lines.map((line) => line.qty * line.variant.priceCentavos);
      const subtotal = lineSubtotals.reduce((sum, value) => sum + value, 0);

      // Promo, mostly on the double-day sales.
      const month = placedAt.getUTCMonth() + 1;
      const dayOfMonth = placedAt.getUTCDate();
      const isDoubleDay =
        (month === 11 && dayOfMonth >= 9 && dayOfMonth <= 12) ||
        (month === 12 && dayOfMonth >= 10 && dayOfMonth <= 13);

      let promoId: string | null = null;
      let promoCode: string | null = null;
      let discount = 0;

      const wantsPromo = isDoubleDay ? chance(0.55) : chance(0.09);
      if (wantsPromo && status !== "DRAFT") {
        const index = isBusiness ? 5 : isDoubleDay ? (month === 11 ? 1 : 2) : intBetween(0, 4);
        const candidateId = promoIds[index];
        const promo = promoRows[index];
        if (candidateId && promo && subtotal >= (promo.minSubtotalCentavos ?? 0)) {
          promoId = candidateId;
          promoCode = promo.code;
          discount =
            promo.type === "PERCENT"
              ? applyBps(subtotal, promo.percentBps ?? 0)
              : Math.min(promo.amountCentavos ?? 0, subtotal);
        }
      }

      const shipping =
        channel === "POS"
          ? 0
          : isBusiness
            ? pesosToCentavos(intBetween(0, 6) * 50)
            : pesosToCentavos(pick([0, 58, 79, 95, 120, 150, 180]));

      const total = subtotal - discount + shipping;
      const orderVat = vatFromGross(total);

      // Discount is spread across lines by value so the lines still sum to the
      // header, and VAT is allocated from the header for the same reason.
      const lineDiscounts = allocateCentavos(discount, lineSubtotals);
      const lineTotals = lineSubtotals.map((value, i) => value - (lineDiscounts[i] ?? 0));
      const goodsVat = vatFromGross(lineTotals.reduce((sum, value) => sum + value, 0));
      const lineVats = allocateCentavos(goodsVat, lineTotals);

      // ------------------------------------------------------- stock effect
      const realised = isRealised(status);
      const reservesStock = status === "PENDING";

      let costTotal = 0;
      const itemRows = lines.map((line, i) => {
        const itemId = `oit_${orderId}_${i}`;
        let unitCost = ledger.getAvgCost(line.variant.id);

        if (realised) {
          const paidAt = clampToNow(addHours(placedAt, intBetween(1, 30)), ctx.now);
          const result = ledger.issue({
            variantId: line.variant.id,
            warehouseId,
            qty: line.qty,
            type: "SALE",
            reason: "CUSTOMER_SALE",
            occurredAt: paidAt,
            actorId: channel === "POS" ? ctx.users.sales.id : ctx.users.warehouse.id,
            refs: { orderItemId: itemId },
          });
          unitCost = result.unitCostCentavos;
        } else if (reservesStock) {
          ledger.reserve(line.variant.id, warehouseId, line.qty);
        }

        costTotal += unitCost * line.qty;

        return {
          id: itemId,
          orderId,
          variantId: line.variant.id,
          skuSnapshot: line.variant.sku,
          nameSnapshot: line.variant.name,
          qty: line.qty,
          qtyReturned: 0,
          unitPriceCentavos: line.variant.priceCentavos,
          discountCentavos: lineDiscounts[i] ?? 0,
          lineSubtotalCentavos: lineSubtotals[i] ?? 0,
          vatCentavos: lineVats[i] ?? 0,
          lineTotalCentavos: lineTotals[i] ?? 0,
          unitCostCentavos: unitCost,
        };
      });

      tables.orderItems.push(...itemRows);

      // ------------------------------------------------------------- dates
      const ladder = ladderUpTo(status);
      const stamps = new Map<OrderStatus, Date>();
      let cursor = placedAt;
      for (const step of ladder) {
        stamps.set(step, cursor);
        cursor = addHours(cursor, step === "DRAFT" ? intBetween(1, 6) : intBetween(4, 40));
        if (cursor > ctx.now) cursor = ctx.now;
      }

      const salesperson =
        channel === "POS" || channel === "DIRECT" || channel === "B2B" ? ctx.users.sales.id : null;

      const amountPaid = realised ? total : 0;

      tables.orders.push({
        id: orderId,
        orderNumber: `SO-${year}-${String(orderCounter).padStart(6, "0")}`,
        channel,
        status,
        customerId: customer?.id ?? null,
        salespersonId: salesperson,
        warehouseId,
        billingAddressId: customer?.billingAddressId ?? null,
        shippingAddressId: channel === "POS" ? null : (customer?.shippingAddressId ?? null),
        channelReference:
          channel === "SHOPEE" || channel === "LAZADA" || channel === "TIKTOK"
            ? `${channel.slice(0, 2)}${faker.string.numeric(12)}`
            : null,
        placedAt,
        paidAt: stamps.get("PAID") ?? null,
        packedAt: stamps.get("PACKED") ?? null,
        shippedAt: stamps.get("SHIPPED") ?? null,
        deliveredAt: stamps.get("DELIVERED") ?? null,
        completedAt: stamps.get("COMPLETED") ?? null,
        cancelledAt: stamps.get("CANCELLED") ?? null,
        cancelReason:
          status === "CANCELLED"
            ? pick([
                "Customer changed their mind before dispatch.",
                "Payment not received within the hold window.",
                "Duplicate order raised by the same customer.",
                "Address could not be served by the courier.",
              ])
            : null,
        subtotalCentavos: subtotal,
        discountCentavos: discount,
        shippingCentavos: shipping,
        vatCentavos: orderVat,
        totalCentavos: total,
        amountPaidCentavos: amountPaid,
        amountRefundedCentavos: 0,
        costTotalCentavos: realised ? costTotal : 0,
        promoId,
        promoCodeSnapshot: promoCode,
        notes: null,
        createdById: salesperson ?? ctx.users.sales.id,
        createdAt: placedAt,
        updatedAt: cursor,
      });

      // ------------------------------------------------------ status events
      let previous: OrderStatus | null = null;
      for (const step of ladder) {
        eventCounter += 1;
        tables.orderStatusEvents.push({
          id: `ose_${String(eventCounter).padStart(7, "0")}`,
          orderId,
          fromStatus: previous,
          toStatus: step,
          note: null,
          actorId: salesperson ?? ctx.users.sales.id,
          createdAt: stamps.get(step) ?? placedAt,
        });
        previous = step;
      }

      // ----------------------------------------------------------- payments
      if (realised) {
        const paidAt = stamps.get("PAID") ?? placedAt;
        const methods = PAYMENT_BY_CHANNEL[channel] ?? ["GCASH"];

        // Split payments happen at POS and on large B2B invoices.
        const splits = (channel === "POS" && chance(0.12)) || (isBusiness && chance(0.25)) ? 2 : 1;
        const amounts = splits === 1 ? [total] : allocateCentavos(total, [6, 4]);

        amounts.forEach((amount, i) => {
          if (amount <= 0) return;
          paymentCounter += 1;
          const method = i === 0 ? pick(methods) : pick(methods.filter((m) => m !== "COD"));
          const isCash = method === "CASH";
          // Cash tendered is rounded up to a note the customer would actually hand over.
          const tendered = isCash ? Math.ceil(amount / 10_000) * 10_000 : null;

          tables.payments.push({
            id: `pay_${String(paymentCounter).padStart(7, "0")}`,
            orderId,
            method,
            status: "PAID",
            amountCentavos: amount,
            tenderedCentavos: tendered,
            changeCentavos: tendered === null ? null : tendered - amount,
            reference: isCash ? null : `${method.slice(0, 3)}${faker.string.numeric(10)}`,
            paidAt,
            createdById: salesperson ?? ctx.users.sales.id,
          });
        });
      }

      // ------------------------------------------------------------- promo
      if (promoId && realised) {
        tables.promoRedemptions.push({
          id: `prr_${orderId}`,
          promoId,
          orderId,
          customerId: customer?.id ?? null,
          discountAppliedCentavos: discount,
          createdAt: placedAt,
        });
        promoUsage.set(promoId, (promoUsage.get(promoId) ?? 0) + 1);
      }

      // Pending orders keep their reservation; cancelled ones give it back.
      if (status === "CANCELLED" && reservesStock) {
        for (const line of lines) {
          ledger.release(line.variant.id, warehouseId, line.qty);
        }
      }
    }
  }

  // Any receipt dated after the last simulated day still has to be applied.
  while (receiptCursor < receipts.length) {
    const receipt = receipts[receiptCursor];
    if (!receipt) break;
    ledger.receive({
      variantId: receipt.variantId,
      warehouseId: receipt.warehouseId,
      qty: receipt.qty,
      unitCostCentavos: receipt.unitCostCentavos,
      type: "RECEIPT",
      reason: "PURCHASE_RECEIPT",
      occurredAt: receipt.occurredAt,
      actorId: receipt.actorId,
      refs: { purchaseReceiptItemId: receipt.receiptItemId },
    });
    receiptCursor += 1;
  }

  // Reflect real redemption counts on the promo rows.
  for (const promo of promoRows) {
    if (typeof promo.id === "string") {
      promo.usageCount = promoUsage.get(promo.id) ?? 0;
    }
  }
}
