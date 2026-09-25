import { manualDiscountIssue, type MANUAL_DISCOUNT_TYPES } from "@/features/orders/schemas";
import { manualDiscountFrom, tendersFrom } from "@/features/orders/services/form";
import type { Tender } from "@/features/orders/services/order-rules";
import type { OrderDraft } from "@/features/orders/services/orders";
import {
  manualDiscountBps,
  priceOrder,
  type OrderPricing,
  type PromoTerms,
} from "@/features/orders/services/pricing";
import { DomainError } from "@/lib/errors";
import { emptyToNull } from "@/lib/validation";

import type { PosSaleValues } from "../schemas";

/**
 * From what the cashier rang up to what the order service takes. Pure, so the
 * action and the tests convert identically. There is no POS-specific pricing
 * or payment logic anywhere: a register sale is an order on the POS channel,
 * priced by `priceOrder` and settled by `settleTenders` like any other.
 */

export function saleDraft(values: PosSaleValues): OrderDraft {
  return {
    channel: "POS",
    customerId: emptyToNull(values.customerId),
    warehouseId: values.warehouseId,
    shippingAddressId: null,
    channelReference: null,
    shippingCentavos: 0,
    promoCode: emptyToNull(values.promoCode)?.toUpperCase() ?? null,
    manualDiscount: manualDiscountFrom(values.discountType, values.discountValue),
    notes: null,
    lines: values.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      discountCentavos: 0,
    })),
  };
}

export function saleTenders(values: PosSaleValues): Tender[] {
  return tendersFrom(values.tenders);
}

export type AppliedPromo = PromoTerms & { code: string; minSubtotalCentavos: number };

export type SalePreview = {
  pricing: OrderPricing | null;
  /** Why the discount as typed cannot be priced. */
  error: string | null;
  /** Share of the subtotal discounted by hand, in basis points. */
  manualBps: number;
  overCap: boolean;
  /** How far the goods fall short of the promo's minimum spend; 0 when it applies. */
  promoShortCentavos: number;
};

/**
 * What the cart comes to, for the register to show as items are scanned. The
 * same `priceOrder` the order service will run again on catalogue prices
 * under lock, so the total on the screen is the total that gets charged. A
 * promo below its minimum spend is left out of the preview and flagged,
 * because the service would refuse it.
 */
export function previewSale(input: {
  lines: readonly { unitPriceCentavos: number; qty: number }[];
  discountType: (typeof MANUAL_DISCOUNT_TYPES)[number];
  discountValue: string;
  promo: AppliedPromo | null;
  capBps: number | null;
}): SalePreview {
  const empty = { pricing: null, manualBps: 0, overCap: false, promoShortCentavos: 0 };
  if (input.lines.length === 0) return { ...empty, error: null };

  const issue = manualDiscountIssue(input.discountType, input.discountValue);
  if (issue) return { ...empty, error: issue };

  try {
    const manualDiscount = manualDiscountFrom(input.discountType, input.discountValue);
    let pricing = priceOrder({ lines: input.lines, promo: input.promo, manualDiscount });
    let promoShortCentavos = 0;
    if (input.promo && pricing.merchandiseCentavos < input.promo.minSubtotalCentavos) {
      promoShortCentavos = input.promo.minSubtotalCentavos - pricing.merchandiseCentavos;
      pricing = priceOrder({ lines: input.lines, manualDiscount });
    }
    const manualBps = manualDiscountBps(pricing);
    return {
      pricing,
      error: null,
      manualBps,
      overCap: input.capBps !== null && manualBps > input.capBps,
      promoShortCentavos,
    };
  } catch (error) {
    if (error instanceof DomainError) return { ...empty, error: error.message };
    throw error;
  }
}

/**
 * The cash a customer is likely to hand over for an amount due, for the
 * one-tap buttons beside the tendered field: the exact amount, then the next
 * round hundred, five hundred and thousand, then the bills above it. Peso
 * notes are 20, 50, 100, 200, 500 and 1,000, so those are the steps that
 * matter at a counter. Distinct, ascending, at most four.
 */
export function quickCashAmounts(dueCentavos: number): number[] {
  if (dueCentavos <= 0) return [];
  const up = (step: number) => Math.ceil(dueCentavos / step) * step;
  const candidates = [dueCentavos, up(10_000), up(50_000), up(100_000), up(100_000) + 100_000];
  return [...new Set(candidates)].filter((amount) => amount >= dueCentavos).slice(0, 4);
}
