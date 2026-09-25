import type { Role } from "@prisma/client";

import { DomainError } from "@/lib/errors";
import { parsePesoInput } from "@/lib/money";
import { scopeFor } from "@/lib/rbac/can";
import { emptyToNull } from "@/lib/validation";

import type { OrderFormValues, TenderValues } from "../schemas";
import type { Tender } from "./order-rules";
import type { OrderDraft } from "./orders";
import { percentToBps, type ManualDiscount } from "./pricing";

/**
 * From what a person typed to what the service takes. Pure, so the create
 * and edit actions convert identically and the conversion is testable.
 */

/** Manual discount ceiling for Sales, docs/PLAN.md section 3. */
export const SALES_DISCOUNT_CAP_BPS = 1000;

/**
 * How deep a role may discount by hand. The matrix says who may discount at
 * all (`pos.discount`), and "own" scope is the capped kind; the cap applies
 * to manual discounts on any order, at the register or keyed in.
 */
export function discountCapFor(role: Role): number | null {
  const scope = scopeFor(role, "pos.discount");
  if (scope === "all") return null;
  if (scope === "own") return SALES_DISCOUNT_CAP_BPS;
  return 0;
}

function pesos(value: string, what: string): number {
  if (value.trim() === "") return 0;
  const centavos = parsePesoInput(value);
  if (centavos === null || centavos < 0) throw new DomainError(`${what} is not a valid amount.`);
  return centavos;
}

export function manualDiscountFrom(
  type: OrderFormValues["manualDiscountType"],
  value: string,
): ManualDiscount | null {
  if (type === "NONE") return null;
  if (type === "PERCENT") {
    const bps = percentToBps(value);
    if (bps === null) throw new DomainError("Enter the order discount as a percentage.");
    return bps === 0 ? null : { type: "PERCENT", bps };
  }
  const centavos = pesos(value, "The order discount");
  return centavos === 0 ? null : { type: "FIXED", centavos };
}

export function draftFromForm(values: OrderFormValues): OrderDraft {
  return {
    channel: values.channel,
    customerId: emptyToNull(values.customerId),
    warehouseId: values.warehouseId,
    shippingAddressId: emptyToNull(values.shippingAddressId),
    channelReference: emptyToNull(values.channelReference),
    shippingCentavos: pesos(values.shipping, "Shipping"),
    promoCode: emptyToNull(values.promoCode)?.toUpperCase() ?? null,
    manualDiscount: manualDiscountFrom(values.manualDiscountType, values.manualDiscountValue),
    notes: emptyToNull(values.notes),
    lines: values.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      discountCentavos: pesos(line.discount, "A line discount"),
    })),
  };
}

export function tendersFrom(values: readonly TenderValues[]): Tender[] {
  return values.map((tender) => ({
    method: tender.method,
    amountCentavos: pesos(tender.amount, "A payment"),
    tenderedCentavos:
      tender.method === "CASH" && tender.tendered.trim() !== ""
        ? pesos(tender.tendered, "Cash tendered")
        : null,
    reference: emptyToNull(tender.reference),
  }));
}
