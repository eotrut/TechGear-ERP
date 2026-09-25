import type { PromoType } from "@prisma/client";

import { DomainError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/money";

/**
 * Whether a promo code may be used on an order right now. Pure: the caller
 * reads the promo (under a row lock, when it is about to redeem it) and the
 * customer's past redemptions, and this decides. The discount itself is
 * computed by the order pricing, so a promo is priced one way everywhere.
 */

export type PromoRecord = {
  code: string;
  type: PromoType;
  percentBps: number | null;
  amountCentavos: number | null;
  minSubtotalCentavos: number;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  isActive: boolean;
  deletedAt: Date | null;
};

export type PromoContext = {
  now: Date;
  /** Merchandise after line discounts, which is what the minimum spend is measured on. */
  merchandiseCentavos: number;
  /** Null for a walk-in with no customer on file. */
  customerId: string | null;
  /** How many times this customer has already redeemed it. */
  customerRedemptions: number;
};

export type PromoCheck = { ok: true } | { ok: false; reason: string };

export function checkPromo(promo: PromoRecord, context: PromoContext): PromoCheck {
  const { code } = promo;
  if (promo.deletedAt || !promo.isActive) {
    return { ok: false, reason: `${code} is no longer active.` };
  }
  if (context.now < promo.startsAt) {
    return { ok: false, reason: `${code} starts on ${formatDate(promo.startsAt)}.` };
  }
  if (context.now > promo.endsAt) {
    return { ok: false, reason: `${code} ended on ${formatDate(promo.endsAt)}.` };
  }
  if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) {
    return { ok: false, reason: `${code} has been used all ${promo.usageLimit} times it allows.` };
  }
  if (
    promo.perCustomerLimit !== null &&
    context.customerId !== null &&
    context.customerRedemptions >= promo.perCustomerLimit
  ) {
    return {
      ok: false,
      reason: `This customer has already used ${code} ${context.customerRedemptions} time${
        context.customerRedemptions === 1 ? "" : "s"
      }, the most it allows.`,
    };
  }
  if (context.merchandiseCentavos < promo.minSubtotalCentavos) {
    return {
      ok: false,
      reason: `${code} needs a spend of at least ${formatPeso(promo.minSubtotalCentavos)} on goods.`,
    };
  }
  return { ok: true };
}

export function assertPromoUsable(promo: PromoRecord, context: PromoContext): void {
  const result = checkPromo(promo, context);
  if (!result.ok) throw new DomainError(result.reason);
}

/** "15% off" or "PHP 500.00 off", for tables and the order summary. */
export function describePromoValue(promo: {
  type: PromoType;
  percentBps: number | null;
  amountCentavos: number | null;
}): string {
  if (promo.type === "PERCENT") {
    const pct = (promo.percentBps ?? 0) / 100;
    return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}% off`;
  }
  return `${formatPeso(promo.amountCentavos ?? 0)} off`;
}

export type PromoState = "active" | "scheduled" | "expired" | "used up" | "inactive";

export function promoState(promo: PromoRecord, now: Date): PromoState {
  if (promo.deletedAt || !promo.isActive) return "inactive";
  if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) return "used up";
  if (now < promo.startsAt) return "scheduled";
  if (now > promo.endsAt) return "expired";
  return "active";
}
