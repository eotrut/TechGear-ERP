import { faker } from "@faker-js/faker";
import type { OrderStatus, PaymentMethod, SalesChannel } from "@prisma/client";

import { priceOrder } from "../../src/features/orders/services/pricing";
import { manilaYear } from "../../src/lib/format";
import { allocateCentavos, pesosToCentavos } from "../../src/lib/money";
import { formatReference } from "../../src/lib/numbering";
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

/** Midnight Manila on a calendar day, as an instant. */
function manilaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 8 * 3_600_000);
}

/**
 * The year a seasonal event falls in inside the seeded window: the most recent
 * occurrence, which is where the sales calendar puts its spike.
 */
function eventYear(ctx: SeedContext, month: number, day: number): number {
  const thisYear = ctx.now.getUTCFullYear();
  return manilaMidnight(thisYear, month, day) <= ctx.now ? thisYear : thisYear - 1;
}

export type PromoWindow = { startsAt: Date; endsAt: Date };

export function buildPromos(ctx: SeedContext): string[] {
  const { tables } = ctx;
  const always: PromoWindow = { startsAt: ctx.windowStart, endsAt: addDays(ctx.now, 45) };
  // Event codes run around their event and then expire, so the promo list
  // shows a real mix of live and finished campaigns.
  const y11 = eventYear(ctx, 11, 11);
  const y12 = eventYear(ctx, 12, 12);
  const singles: PromoWindow = {
    startsAt: manilaMidnight(y11, 11, 1),
    endsAt: new Date(manilaMidnight(y11, 11, 16).getTime() - 1),
  };
  const double: PromoWindow = {
    startsAt: manilaMidnight(y12, 12, 1),
    endsAt: new Date(manilaMidnight(y12, 12, 16).getTime() - 1),
  };
  const pasko: PromoWindow = {
    startsAt: manilaMidnight(y12, 11, 15),
    endsAt: new Date(manilaMidnight(y12 + 1, 1, 1).getTime() - 1),
  };

  const promos = [
    {
      code: "TECHGEAR10",
      description: "10 percent off, launch promo",
      type: "PERCENT",
      percentBps: 1000,
      amountCentavos: null,
      min: 150000,
      limit: 500,
      window: always,
    },
    {
      code: "SINGLES1111",
      description: "11.11 double day, 15 percent off",
      type: "PERCENT",
      percentBps: 1500,
      amountCentavos: null,
      min: 200000,
      limit: 800,
      window: singles,
    },
    {
      code: "DOUBLE1212",
      description: "12.12 double day, 12 percent off",
      type: "PERCENT",
      percentBps: 1200,
      amountCentavos: null,
      min: 200000,
      limit: 800,
      window: double,
    },
    {
      code: "PASKO500",
      description: "PHP 500 off Christmas orders",
      type: "FIXED",
      percentBps: null,
      amountCentavos: 50000,
      min: 300000,
      limit: 300,
      window: pasko,
    },
    {
      code: "FREESHIP",
      description: "PHP 150 shipping rebate",
      type: "FIXED",
      percentBps: null,
      amountCentavos: 15000,
      min: 100000,
      limit: null,
      window: always,
    },
    {
      code: "BULK5",
      description: "5 percent off B2B fitout orders",
      type: "PERCENT",
      percentBps: 500,
      amountCentavos: null,
      min: 2000000,
      limit: null,
      window: always,
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
      startsAt: promo.window.startsAt,
      endsAt: promo.window.endsAt,
      usageLimit: promo.limit,
      usageCount: 0,
      perCustomerLimit: promo.code === "BULK5" ? null : 3,
      isActive: true,
      createdAt: ctx.windowStart,
      updatedAt: ctx.windowStart,
    });
  });

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
  const promoByCustomer = new Map<string, number>();
  // Order numbers run per Manila calendar year, as the live numbering does.
  const numberByYear = new Map<number, number>();

  for (let dayIndex = 0; dayIndex <= totalDays; dayIndex += 1) {
    const day = startOfDay(addDays(ctx.windowStart, dayIndex));

    // Only deliveries from before today count: today's orders are stamped at
    // random business hours, and a truck that lands at three cannot supply a
    // sale rung up at ten. It stocks tomorrow's orders instead.
    while (receiptCursor < receipts.length) {
      const receipt = receipts[receiptCursor];
      if (!receipt || receipt.occurredAt >= day) break;
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
      const drawn = statusForAge(ageDays, channel);
      // Marketplaces have already taken the order, so it never sits as a draft
      // here (initialStatusFor in the order rules says the same).
      const status =
        drawn === "DRAFT" && (channel === "SHOPEE" || channel === "LAZADA" || channel === "TIKTOK")
          ? "PENDING"
          : drawn;

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
      let promoTerms: Parameters<typeof priceOrder>[0]["promo"] = null;

      const wantsPromo = isDoubleDay ? chance(0.55) : chance(0.09);
      if (wantsPromo && status !== "DRAFT") {
        const index = isBusiness ? 5 : isDoubleDay ? (month === 11 ? 1 : 2) : intBetween(0, 4);
        const candidateId = promoIds[index];
        const promo = promoRows[index];
        // The same rules the order service applies: inside its dates, over its
        // minimum spend, and within its per-customer limit.
        const usedByCustomer = customer
          ? (promoByCustomer.get(`${candidateId}:${customer.id}`) ?? 0)
          : 0;
        if (
          candidateId &&
          promo &&
          subtotal >= (promo.minSubtotalCentavos ?? 0) &&
          placedAt >= new Date(promo.startsAt) &&
          placedAt <= new Date(promo.endsAt) &&
          (promo.perCustomerLimit == null || usedByCustomer < promo.perCustomerLimit)
        ) {
          promoId = candidateId;
          promoCode = promo.code;
          promoTerms = {
            type: promo.type,
            percentBps: promo.percentBps ?? null,
            amountCentavos: promo.amountCentavos ?? null,
          };
        }
      }

      const shipping =
        channel === "POS"
          ? 0
          : isBusiness
            ? pesosToCentavos(intBetween(0, 6) * 50)
            : pesosToCentavos(pick([0, 58, 79, 95, 120, 150, 180]));

      // Priced by the function the order service uses, so seeded orders obey
      // exactly the totals, discount and VAT rules a live order does.
      const pricing = priceOrder({
        lines: lines.map((line) => ({
          unitPriceCentavos: line.variant.priceCentavos,
          qty: line.qty,
        })),
        promo: promoTerms,
        shippingCentavos: shipping,
      });
      const discount = pricing.discountCentavos;
      const total = pricing.totalCentavos;

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

        const priced = pricing.lines[i];
        return {
          id: itemId,
          orderId,
          variantId: line.variant.id,
          skuSnapshot: line.variant.sku,
          nameSnapshot: line.variant.name,
          qty: line.qty,
          qtyReturned: 0,
          unitPriceCentavos: line.variant.priceCentavos,
          discountCentavos: priced?.discountCentavos ?? 0,
          lineSubtotalCentavos: priced?.lineSubtotalCentavos ?? 0,
          vatCentavos: priced?.vatCentavos ?? 0,
          lineTotalCentavos: priced?.lineTotalCentavos ?? 0,
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
        orderNumber: (() => {
          const year = manilaYear(placedAt);
          const next = (numberByYear.get(year) ?? 0) + 1;
          numberByYear.set(year, next);
          return formatReference("SO", year, next);
        })(),
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
        vatCentavos: pricing.vatCentavos,
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

        let firstMethod: PaymentMethod | null = null;
        amounts.forEach((amount, i) => {
          if (amount <= 0) return;
          paymentCounter += 1;
          // The live settlement rules: cash on delivery settles a whole order on
          // its own, and cash is a single tender, so a split uses two methods.
          const allowed =
            amounts.length > 1 ? methods.filter((m) => m !== "COD" && m !== firstMethod) : methods;
          const method = pick(allowed.length > 0 ? allowed : (["BANK_TRANSFER"] as const));
          if (i === 0) firstMethod = method;
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
      // A use is counted when the order is saved and given back on cancel,
      // exactly as the order service does it.
      if (promoId && status !== "CANCELLED") {
        tables.promoRedemptions.push({
          id: `prr_${orderId}`,
          promoId,
          orderId,
          customerId: customer?.id ?? null,
          discountAppliedCentavos: pricing.promoDiscountCentavos,
          createdAt: placedAt,
        });
        promoUsage.set(promoId, (promoUsage.get(promoId) ?? 0) + 1);
        if (customer) {
          const key = `${promoId}:${customer.id}`;
          promoByCustomer.set(key, (promoByCustomer.get(key) ?? 0) + 1);
        }
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
