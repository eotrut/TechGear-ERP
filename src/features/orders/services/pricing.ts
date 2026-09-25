import type { PromoType } from "@prisma/client";

import { DomainError } from "@/lib/errors";
import { allocateCentavos, applyBps, assertCentavos, sumCentavos } from "@/lib/money";
import { vatFromGross } from "@/lib/vat";

/**
 * Order pricing. Pure: no database, no clock, so the order service, the seed
 * and the tests all price an order with exactly this code.
 *
 * Prices are VAT-inclusive (decision D-6), so every amount here is gross and
 * VAT is extracted from the result rather than added to it. The order a
 * discount is applied in matters, and is fixed:
 *
 *   1. Line subtotal   qty x unit price
 *   2. Line discount   a peso amount a person keyed against one line
 *   3. Promo           on the merchandise left after line discounts, which is
 *                      also what its minimum spend is measured against
 *   4. Order discount  a manual percent or peso amount, on what is left after
 *                      the promo, so it can never discount the promo twice
 *   5. Shipping        added last; it is never discounted by a percentage
 *
 * The promo and the order discount are header amounts, so they are spread
 * across the lines by value with the largest-remainder method. That keeps
 * every line's discount summing to the header exactly, which the margin and
 * VAT reports rely on. VAT on the goods is allocated the same way, and the
 * header VAT is extracted from the full total, shipping included.
 */

export type PricingLine = {
  unitPriceCentavos: number;
  qty: number;
  /** Manual peso discount on this line. */
  discountCentavos?: number;
};

export type PromoTerms = {
  type: PromoType;
  percentBps: number | null;
  amountCentavos: number | null;
};

export type ManualDiscount = { type: "PERCENT"; bps: number } | { type: "FIXED"; centavos: number };

export type PricingInput = {
  lines: readonly PricingLine[];
  promo?: PromoTerms | null;
  manualDiscount?: ManualDiscount | null;
  shippingCentavos?: number;
};

export type PricedLine = {
  qty: number;
  unitPriceCentavos: number;
  lineSubtotalCentavos: number;
  /** Keyed against this line by a person. */
  lineDiscountCentavos: number;
  /** This line's share of the promo and the order discount. */
  allocatedDiscountCentavos: number;
  /** Everything off this line; what OrderItem.discountCentavos stores. */
  discountCentavos: number;
  lineTotalCentavos: number;
  vatCentavos: number;
};

export type OrderPricing = {
  lines: PricedLine[];
  subtotalCentavos: number;
  lineDiscountCentavos: number;
  promoDiscountCentavos: number;
  manualDiscountCentavos: number;
  /** Every discount on the order; equals the sum of the lines' discounts. */
  discountCentavos: number;
  /** What the promo's minimum spend is measured against. */
  merchandiseCentavos: number;
  shippingCentavos: number;
  totalCentavos: number;
  /** VAT inside the total, shipping included. */
  vatCentavos: number;
  /** VAT inside the goods only; the lines' VAT sums to this. */
  goodsVatCentavos: number;
  /** The VAT-exclusive part of the total, "VATable sales" on a BIR invoice. */
  vatableSalesCentavos: number;
};

function assertWhole(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError(`${what} must be a whole, non-negative number, received ${value}.`);
  }
}

/** What a promo takes off a merchandise amount. A fixed promo never exceeds it. */
export function promoDiscount(promo: PromoTerms, merchandiseCentavos: number): number {
  if (merchandiseCentavos <= 0) return 0;
  if (promo.type === "PERCENT") {
    return Math.min(applyBps(merchandiseCentavos, promo.percentBps ?? 0), merchandiseCentavos);
  }
  return Math.min(promo.amountCentavos ?? 0, merchandiseCentavos);
}

export function priceOrder(input: PricingInput): OrderPricing {
  if (input.lines.length === 0) throw new DomainError("An order needs at least one line.");

  const shippingCentavos = input.shippingCentavos ?? 0;
  assertWhole(shippingCentavos, "Shipping");

  const bases = input.lines.map((line, index) => {
    assertWhole(line.unitPriceCentavos, "A unit price");
    if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
      throw new DomainError(`Line ${index + 1} needs a quantity of at least 1.`);
    }
    const lineDiscount = line.discountCentavos ?? 0;
    assertWhole(lineDiscount, "A line discount");

    const lineSubtotal = assertCentavos(line.qty * line.unitPriceCentavos);
    if (lineDiscount > lineSubtotal) {
      throw new DomainError(`The discount on line ${index + 1} is larger than the line itself.`);
    }
    return { line, lineSubtotal, lineDiscount };
  });

  const subtotalCentavos = sumCentavos(bases.map((base) => base.lineSubtotal));
  const lineDiscountCentavos = sumCentavos(bases.map((base) => base.lineDiscount));
  const merchandiseCentavos = subtotalCentavos - lineDiscountCentavos;

  const promoDiscountCentavos = input.promo ? promoDiscount(input.promo, merchandiseCentavos) : 0;

  const afterPromo = merchandiseCentavos - promoDiscountCentavos;
  let manualDiscountCentavos = 0;
  if (input.manualDiscount) {
    const manual = input.manualDiscount;
    if (manual.type === "PERCENT") {
      if (!Number.isSafeInteger(manual.bps) || manual.bps < 0 || manual.bps > 10_000) {
        throw new DomainError("An order discount is a percentage between 0 and 100.");
      }
      manualDiscountCentavos = applyBps(afterPromo, manual.bps);
    } else {
      assertWhole(manual.centavos, "The order discount");
      if (manual.centavos > afterPromo) {
        throw new DomainError(
          "The order discount is larger than what is left to pay for the goods.",
        );
      }
      manualDiscountCentavos = manual.centavos;
    }
  }

  // Spread the header discounts across lines by what each line is still worth.
  const headerDiscount = promoDiscountCentavos + manualDiscountCentavos;
  const allocated = allocateCentavos(
    headerDiscount,
    bases.map((base) => base.lineSubtotal - base.lineDiscount),
  );

  const lineTotals = bases.map(
    (base, index) => base.lineSubtotal - base.lineDiscount - (allocated[index] ?? 0),
  );
  const goodsCentavos = sumCentavos(lineTotals);
  const goodsVatCentavos = vatFromGross(goodsCentavos);
  const lineVats = allocateCentavos(goodsVatCentavos, lineTotals);

  const lines: PricedLine[] = bases.map((base, index) => {
    const allocatedDiscountCentavos = allocated[index] ?? 0;
    return {
      qty: base.line.qty,
      unitPriceCentavos: base.line.unitPriceCentavos,
      lineSubtotalCentavos: base.lineSubtotal,
      lineDiscountCentavos: base.lineDiscount,
      allocatedDiscountCentavos,
      discountCentavos: base.lineDiscount + allocatedDiscountCentavos,
      lineTotalCentavos: lineTotals[index] ?? 0,
      vatCentavos: lineVats[index] ?? 0,
    };
  });

  const discountCentavos = lineDiscountCentavos + headerDiscount;
  const totalCentavos = assertCentavos(subtotalCentavos - discountCentavos + shippingCentavos);
  const vatCentavos = vatFromGross(totalCentavos);

  return {
    lines,
    subtotalCentavos,
    lineDiscountCentavos,
    promoDiscountCentavos,
    manualDiscountCentavos,
    discountCentavos,
    merchandiseCentavos,
    shippingCentavos,
    totalCentavos,
    vatCentavos,
    goodsVatCentavos,
    vatableSalesCentavos: totalCentavos - vatCentavos,
  };
}

/**
 * The share of the subtotal a person discounted by hand, in basis points.
 * Promos are excluded: they are approved in advance, with their own limits.
 */
export function manualDiscountBps(pricing: OrderPricing): number {
  if (pricing.subtotalCentavos === 0) return 0;
  const manual = pricing.lineDiscountCentavos + pricing.manualDiscountCentavos;
  return Math.ceil((manual * 10_000) / pricing.subtotalCentavos);
}

/**
 * Sales staff may discount by hand up to a cap (10 percent, docs/PLAN.md
 * section 3); deeper cuts need a manager. `capBps` is null for roles without
 * a cap. Enforced here, in the service, never only in the form.
 */
export function assertManualDiscountAllowed(pricing: OrderPricing, capBps: number | null): void {
  if (capBps === null) return;
  const used = manualDiscountBps(pricing);
  if (used > capBps) {
    throw new DomainError(
      `Manual discounts come to ${(used / 100).toFixed(2)} percent of this order. ` +
        `Your limit is ${capBps / 100} percent; ask a manager to apply a deeper discount.`,
    );
  }
}

/** Percent text from a form ("12.5") to basis points (1250), exactly. */
export function percentToBps(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps > 10_000 ? null : bps;
}
