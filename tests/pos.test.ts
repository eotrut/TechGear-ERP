import { describe, expect, it } from "vitest";

import { posSaleSchema } from "@/features/pos/schemas";
import { previewSale, quickCashAmounts, saleDraft } from "@/features/pos/services/sale";

/** The register's pure rules: quick cash, the cart preview, and the draft it sends. */

const base = {
  warehouseId: "wh_1",
  customerId: "",
  lines: [{ variantId: "v1", qty: 2 }],
  discountType: "NONE" as const,
  discountValue: "",
  promoCode: "",
  tenders: [],
};

describe("quickCashAmounts", () => {
  it("offers the exact amount, then the notes a customer is likely to hand over", () => {
    // PHP 1,234.50
    expect(quickCashAmounts(123_450)).toEqual([123_450, 130_000, 150_000, 200_000]);
  });

  it("does not repeat an amount that is already round", () => {
    expect(quickCashAmounts(100_000)).toEqual([100_000, 200_000]);
    expect(quickCashAmounts(50_000)).toEqual([50_000, 100_000, 200_000]);
  });

  it("offers nothing when nothing is due", () => {
    expect(quickCashAmounts(0)).toEqual([]);
  });
});

describe("previewSale", () => {
  const lines = [
    { unitPriceCentavos: 250_000, qty: 2 },
    { unitPriceCentavos: 89_900, qty: 1 },
  ];

  it("prices the cart with the order service's rules, VAT included", () => {
    const preview = previewSale({
      lines,
      discountType: "NONE",
      discountValue: "",
      promo: null,
      capBps: null,
    });
    expect(preview.pricing?.totalCentavos).toBe(589_900);
    expect(preview.pricing?.vatCentavos).toBe(Math.round((589_900 * 12) / 112));
    expect(preview.error).toBeNull();
  });

  it("flags a manual discount past the cashier's cap", () => {
    const preview = previewSale({
      lines,
      discountType: "PERCENT",
      discountValue: "12",
      promo: null,
      capBps: 1000,
    });
    expect(preview.overCap).toBe(true);
    expect(preview.manualBps).toBe(1200);
  });

  it("leaves a promo out of the total until its minimum spend is met", () => {
    const promo = {
      code: "PASKO500",
      type: "FIXED" as const,
      percentBps: null,
      amountCentavos: 50_000,
      minSubtotalCentavos: 1_000_000,
    };
    const preview = previewSale({
      lines,
      discountType: "NONE",
      discountValue: "",
      promo,
      capBps: null,
    });
    expect(preview.promoShortCentavos).toBe(1_000_000 - 589_900);
    expect(preview.pricing?.promoDiscountCentavos).toBe(0);
    expect(preview.pricing?.totalCentavos).toBe(589_900);
  });

  it("explains a peso discount larger than the goods instead of throwing", () => {
    const preview = previewSale({
      lines,
      discountType: "FIXED",
      discountValue: "10000",
      promo: null,
      capBps: null,
    });
    expect(preview.pricing).toBeNull();
    expect(preview.error).toMatch(/larger than what is left/);
  });
});

describe("register sale conversion", () => {
  it("builds a POS order draft with no shipping, address or line discounts", () => {
    const draft = saleDraft({
      ...base,
      customerId: "cus_1",
      discountType: "PERCENT",
      discountValue: "5",
      promoCode: " techgear10 ",
    });
    expect(draft).toMatchObject({
      channel: "POS",
      customerId: "cus_1",
      shippingCentavos: 0,
      shippingAddressId: null,
      promoCode: "TECHGEAR10",
      manualDiscount: { type: "PERCENT", bps: 500 },
      lines: [{ variantId: "v1", qty: 2, discountCentavos: 0 }],
    });
  });

  it("refuses duplicate lines and a malformed discount", () => {
    const duplicate = posSaleSchema.safeParse({
      ...base,
      lines: [
        { variantId: "v1", qty: 1 },
        { variantId: "v1", qty: 1 },
      ],
    });
    expect(duplicate.success).toBe(false);

    const badPercent = posSaleSchema.safeParse({
      ...base,
      discountType: "PERCENT",
      discountValue: "150",
    });
    expect(badPercent.success).toBe(false);
  });

  it("needs at least one line", () => {
    const empty = posSaleSchema.safeParse({ ...base, lines: [] });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe("Scan or tap an item first.");
  });
});
