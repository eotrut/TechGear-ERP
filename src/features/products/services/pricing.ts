import { assertCentavos, applyBps, roundHalfAwayFromZero } from "@/lib/money";

import type { BulkPriceMode, BulkPriceRounding } from "../schemas";

/**
 * Bulk price arithmetic. Pure, so it is unit tested directly and the preview
 * the dialog shows is computed by exactly the code that writes the new prices.
 *
 * Retail rounding is part of the operation rather than a cosmetic afterthought:
 * "+7 percent" on a price list produces values like 4484.30, and nobody prices
 * a keyboard at that.
 */

export type BulkPriceRule = {
  mode: BulkPriceMode;
  /** Basis points for "percent", centavos for "amount" and "set". */
  amount: number;
  rounding: BulkPriceRounding;
};

/** Price floor. A bulk change may not take anything to zero or below. */
export const MIN_PRICE_CENTAVOS = 1;

function round(centavos: number, rounding: BulkPriceRounding): number {
  switch (rounding) {
    case "peso":
      return roundHalfAwayFromZero(centavos / 100) * 100;
    case "nearest5":
      return roundHalfAwayFromZero(centavos / 500) * 500;
    case "charm": {
      // Nearest whole peso, then shade to the .95 ending PH retail uses.
      const pesos = Math.max(1, roundHalfAwayFromZero(centavos / 100));
      return pesos * 100 - 5;
    }
    case "none":
    default:
      return centavos;
  }
}

/**
 * The new price for one variant. Never returns a value below
 * MIN_PRICE_CENTAVOS: a rounding rule that would zero a cheap item clamps
 * instead, which is visible in the preview rather than silent.
 */
export function nextPrice(currentCentavos: number, rule: BulkPriceRule): number {
  const base =
    rule.mode === "set"
      ? rule.amount
      : rule.mode === "amount"
        ? currentCentavos + rule.amount
        : currentCentavos + applyBps(currentCentavos, rule.amount);

  const rounded = round(base, rule.rounding);
  return assertCentavos(Math.max(MIN_PRICE_CENTAVOS, rounded));
}

export type PriceChange<T> = {
  variant: T;
  from: number;
  to: number;
};

/** Everything the rule actually moves. Unchanged rows are dropped. */
export function planPriceChanges<T extends { id: string; priceCentavos: number }>(
  variants: readonly T[],
  rule: BulkPriceRule,
): PriceChange<T>[] {
  const changes: PriceChange<T>[] = [];
  for (const variant of variants) {
    const to = nextPrice(variant.priceCentavos, rule);
    if (to !== variant.priceCentavos) changes.push({ variant, from: variant.priceCentavos, to });
  }
  return changes;
}

/** Percentage typed by a person ("-7.5") to the basis points the rule uses. */
export function percentToBps(percent: number): number {
  return roundHalfAwayFromZero(percent * 100);
}
