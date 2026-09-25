import { describe, expect, it } from "vitest";

import { salesDocument } from "@/features/orders/services/documents";
import {
  assertRefundable,
  cancelNeedsRefund,
  fulfilmentAxis,
  initialStatusFor,
  isFullyRefunded,
  ORDER_TRANSITIONS,
  paymentAxis,
  refundableBalance,
  refundForUnits,
  settleTenders,
  TRANSITION_PERMISSION,
} from "@/features/orders/services/order-rules";
import {
  assertManualDiscountAllowed,
  manualDiscountBps,
  percentToBps,
  priceOrder,
  promoDiscount,
} from "@/features/orders/services/pricing";
import { pdfSafe, renderSalesDocumentPdf } from "@/features/orders/services/pdf";
import { checkPromo, promoState, type PromoRecord } from "@/features/promos/services/promo-rules";
import { promoDataFrom } from "@/features/promos/services/promos";
import { RETURN_TRANSITIONS, returnableQty } from "@/features/returns/services/return-rules";
import { WARRANTY_TRANSITIONS, warrantyExpiry } from "@/features/warranty/services/warranty-rules";
import { DomainError, InvalidTransitionError } from "@/lib/errors";
import { can } from "@/lib/rbac/can";
import { assertTransition, canTransition, isTerminal } from "@/lib/transitions";
import { vatFromGross } from "@/lib/vat";

/**
 * Orders, returns and warranty: the pure rules. Totals, VAT, discounts and
 * promos, the status machines, split payments and refunds. The database suite
 * (tests/integration/orders.test.ts) runs the same rules through real
 * transactions and checks the stock they move.
 */

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

// ============================================================== totals, VAT

describe("priceOrder: totals and VAT", () => {
  it("prices a plain order: VAT-inclusive, extracted at 12/112", () => {
    const pricing = priceOrder({
      lines: [
        { unitPriceCentavos: 459_000, qty: 1 }, // PHP 4,590.00 keyboard
        { unitPriceCentavos: 89_500, qty: 2 }, // PHP 895.00 keycap set, two of them
      ],
      shippingCentavos: 12_000,
    });

    expect(pricing.subtotalCentavos).toBe(638_000);
    expect(pricing.discountCentavos).toBe(0);
    expect(pricing.totalCentavos).toBe(650_000);
    // 650,000 x 12 / 112 = 69,642.857... rounds to 69,643.
    expect(pricing.vatCentavos).toBe(69_643);
    expect(pricing.vatableSalesCentavos).toBe(650_000 - 69_643);
  });

  it("allocates goods VAT so the lines sum to it exactly, and shipping carries the rest", () => {
    const pricing = priceOrder({
      lines: [
        { unitPriceCentavos: 33_333, qty: 1 },
        { unitPriceCentavos: 33_333, qty: 1 },
        { unitPriceCentavos: 33_334, qty: 1 },
      ],
      shippingCentavos: 9_500,
    });
    const lineVat = sum(pricing.lines.map((line) => line.vatCentavos));
    expect(lineVat).toBe(pricing.goodsVatCentavos);
    expect(pricing.goodsVatCentavos).toBe(vatFromGross(100_000));
    // The header VAT is extracted from the full total, shipping included.
    expect(pricing.vatCentavos).toBe(vatFromGross(109_500));
  });

  it("keeps every line identity the verifier checks", () => {
    const pricing = priceOrder({
      lines: [
        { unitPriceCentavos: 129_900, qty: 3, discountCentavos: 5_000 },
        { unitPriceCentavos: 7_999, qty: 7 },
        { unitPriceCentavos: 1_250_000, qty: 1 },
      ],
      promo: { type: "PERCENT", percentBps: 1500, amountCentavos: null },
      manualDiscount: { type: "FIXED", centavos: 12_345 },
      shippingCentavos: 15_000,
    });

    for (const line of pricing.lines) {
      expect(line.lineSubtotalCentavos).toBe(line.qty * line.unitPriceCentavos);
      expect(line.lineTotalCentavos).toBe(line.lineSubtotalCentavos - line.discountCentavos);
    }
    expect(sum(pricing.lines.map((line) => line.lineSubtotalCentavos))).toBe(
      pricing.subtotalCentavos,
    );
    expect(sum(pricing.lines.map((line) => line.discountCentavos))).toBe(pricing.discountCentavos);
    expect(pricing.totalCentavos).toBe(
      pricing.subtotalCentavos - pricing.discountCentavos + pricing.shippingCentavos,
    );
    expect(pricing.vatCentavos).toBe(vatFromGross(pricing.totalCentavos));
  });

  it("works in integers only, whatever the inputs", () => {
    const pricing = priceOrder({
      lines: [
        { unitPriceCentavos: 1, qty: 3 },
        { unitPriceCentavos: 99_999, qty: 13 },
      ],
      manualDiscount: { type: "PERCENT", bps: 333 },
    });
    const values = [
      pricing.totalCentavos,
      pricing.vatCentavos,
      pricing.discountCentavos,
      ...pricing.lines.flatMap((line) => [line.vatCentavos, line.discountCentavos]),
    ];
    for (const value of values) expect(Number.isInteger(value)).toBe(true);
  });

  it("refuses an empty order, a zero quantity and a line discount larger than the line", () => {
    expect(() => priceOrder({ lines: [] })).toThrow(DomainError);
    expect(() => priceOrder({ lines: [{ unitPriceCentavos: 100, qty: 0 }] })).toThrow(/quantity/);
    expect(() =>
      priceOrder({ lines: [{ unitPriceCentavos: 1_000, qty: 1, discountCentavos: 1_001 }] }),
    ).toThrow(/larger than the line/);
  });
});

// ================================================================ discounts

describe("priceOrder: discounts and promos", () => {
  it("applies a percent promo to merchandise after line discounts", () => {
    const pricing = priceOrder({
      lines: [
        { unitPriceCentavos: 300_000, qty: 1, discountCentavos: 20_000 },
        { unitPriceCentavos: 100_000, qty: 1 },
      ],
      promo: { type: "PERCENT", percentBps: 1000, amountCentavos: null },
    });
    expect(pricing.merchandiseCentavos).toBe(380_000);
    expect(pricing.promoDiscountCentavos).toBe(38_000);
    expect(pricing.discountCentavos).toBe(58_000);
    expect(pricing.totalCentavos).toBe(342_000);
  });

  it("caps a fixed promo at the merchandise, never below zero", () => {
    expect(promoDiscount({ type: "FIXED", percentBps: null, amountCentavos: 50_000 }, 30_000)).toBe(
      30_000,
    );
    const pricing = priceOrder({
      lines: [{ unitPriceCentavos: 30_000, qty: 1 }],
      promo: { type: "FIXED", percentBps: null, amountCentavos: 50_000 },
      shippingCentavos: 9_500,
    });
    expect(pricing.totalCentavos).toBe(9_500);
  });

  it("applies the manual order discount after the promo, so it never discounts the promo", () => {
    const pricing = priceOrder({
      lines: [{ unitPriceCentavos: 1_000_000, qty: 1 }],
      promo: { type: "PERCENT", percentBps: 1000, amountCentavos: null },
      manualDiscount: { type: "PERCENT", bps: 1000 },
    });
    // 10,000 less 10% is 9,000; 10% of that is 900, not another 1,000.
    expect(pricing.promoDiscountCentavos).toBe(100_000);
    expect(pricing.manualDiscountCentavos).toBe(90_000);
    expect(pricing.totalCentavos).toBe(810_000);
  });

  it("never discounts shipping", () => {
    const pricing = priceOrder({
      lines: [{ unitPriceCentavos: 100_000, qty: 1 }],
      manualDiscount: { type: "PERCENT", bps: 10_000 },
      shippingCentavos: 15_000,
    });
    expect(pricing.totalCentavos).toBe(15_000);
  });

  it("spreads header discounts by line value with no stray centavo", () => {
    const pricing = priceOrder({
      lines: [
        { unitPriceCentavos: 10_001, qty: 1 },
        { unitPriceCentavos: 20_003, qty: 1 },
        { unitPriceCentavos: 30_007, qty: 1 },
      ],
      manualDiscount: { type: "FIXED", centavos: 1_001 },
    });
    const allocated = pricing.lines.map((line) => line.allocatedDiscountCentavos);
    expect(sum(allocated)).toBe(1_001);
    // Roughly proportional: the largest line carries the most.
    expect(allocated[2]).toBeGreaterThan(allocated[1] ?? 0);
    expect(allocated[1]).toBeGreaterThan(allocated[0] ?? 0);
  });

  it("refuses a fixed order discount larger than what is left", () => {
    expect(() =>
      priceOrder({
        lines: [{ unitPriceCentavos: 10_000, qty: 1 }],
        manualDiscount: { type: "FIXED", centavos: 10_001 },
      }),
    ).toThrow(/larger than/);
  });

  it("caps manual discounts for roles with a ceiling, and ignores promos in the cap", () => {
    const withinCap = priceOrder({
      lines: [{ unitPriceCentavos: 100_000, qty: 1 }],
      promo: { type: "PERCENT", percentBps: 2000, amountCentavos: null },
      manualDiscount: { type: "PERCENT", bps: 1000 },
    });
    // 20% promo, then 10% of the remaining 80,000: 8,000 manual, 8% of the subtotal.
    expect(manualDiscountBps(withinCap)).toBe(800);
    expect(() => assertManualDiscountAllowed(withinCap, 1000)).not.toThrow();

    const overCap = priceOrder({
      lines: [{ unitPriceCentavos: 100_000, qty: 1, discountCentavos: 10_001 }],
    });
    expect(() => assertManualDiscountAllowed(overCap, 1000)).toThrow(/limit is 10 percent/);
    expect(() => assertManualDiscountAllowed(overCap, null)).not.toThrow();
  });

  it("parses percent text to basis points exactly", () => {
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps("0.05")).toBe(5);
    expect(percentToBps("100")).toBe(10_000);
    expect(percentToBps("100.01")).toBeNull();
    expect(percentToBps("abc")).toBeNull();
  });
});

describe("promo eligibility", () => {
  const now = new Date("2026-11-11T04:00:00Z");
  const base: PromoRecord = {
    code: "SINGLES1111",
    type: "PERCENT",
    percentBps: 1500,
    amountCentavos: null,
    minSubtotalCentavos: 200_000,
    startsAt: new Date("2026-11-01T00:00:00Z"),
    endsAt: new Date("2026-11-30T00:00:00Z"),
    usageLimit: 800,
    usageCount: 12,
    perCustomerLimit: 3,
    isActive: true,
    deletedAt: null,
  };
  const context = {
    now,
    merchandiseCentavos: 250_000,
    customerId: "cus_1",
    customerRedemptions: 0,
  };

  it("accepts a live promo within its limits", () => {
    expect(checkPromo(base, context)).toEqual({ ok: true });
    expect(promoState(base, now)).toBe("active");
  });

  it("names the reason a promo cannot be used", () => {
    expect(checkPromo({ ...base, isActive: false }, context)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/no longer active/),
    });
    expect(checkPromo(base, { ...context, now: new Date("2026-10-01T00:00:00Z") })).toMatchObject({
      reason: expect.stringMatching(/starts on/),
    });
    expect(checkPromo(base, { ...context, now: new Date("2026-12-01T00:00:00Z") })).toMatchObject({
      reason: expect.stringMatching(/ended on/),
    });
    expect(checkPromo({ ...base, usageCount: 800 }, context)).toMatchObject({
      reason: expect.stringMatching(/used all 800/),
    });
    expect(checkPromo(base, { ...context, customerRedemptions: 3 })).toMatchObject({
      reason: expect.stringMatching(/already used/),
    });
    expect(checkPromo(base, { ...context, merchandiseCentavos: 199_999 })).toMatchObject({
      reason: expect.stringMatching(/at least/),
    });
  });

  it("does not hold a walk-in to a per-customer limit it cannot count", () => {
    expect(checkPromo(base, { ...context, customerId: null, customerRedemptions: 99 })).toEqual({
      ok: true,
    });
  });

  it("turns the editor's values into exact columns, in Manila days", () => {
    const data = promoDataFrom({
      code: "PAYDAY",
      description: "Payday treat",
      type: "PERCENT",
      value: "7.5",
      minSubtotal: "1,500",
      startsOn: "2026-10-15",
      endsOn: "2026-10-15",
      usageLimit: "",
      perCustomerLimit: "1",
      isActive: true,
    });
    expect(data.percentBps).toBe(750);
    expect(data.amountCentavos).toBeNull();
    expect(data.minSubtotalCentavos).toBe(150_000);
    // Midnight to midnight in Manila is 16:00 to 15:59:59.999 UTC.
    expect(data.startsAt.toISOString()).toBe("2026-10-14T16:00:00.000Z");
    expect(data.endsAt.toISOString()).toBe("2026-10-15T15:59:59.999Z");
    expect(data.usageLimit).toBeNull();
  });
});

// ======================================================= status transitions

describe("order status transitions", () => {
  it("follows the ladder from the plan", () => {
    const ladder = [
      "DRAFT",
      "PENDING",
      "PAID",
      "PACKED",
      "SHIPPED",
      "DELIVERED",
      "COMPLETED",
    ] as const;
    for (let i = 0; i < ladder.length - 1; i += 1) {
      expect(canTransition(ORDER_TRANSITIONS, ladder[i]!, ladder[i + 1]!)).toBe(true);
    }
  });

  it("refuses skips, reversals and anything out of a terminal state", () => {
    expect(() => assertTransition(ORDER_TRANSITIONS, "Order", "PENDING", "SHIPPED")).toThrow(
      InvalidTransitionError,
    );
    expect(canTransition(ORDER_TRANSITIONS, "DRAFT", "PAID")).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, "SHIPPED", "PACKED")).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, "SHIPPED", "CANCELLED")).toBe(false);
    expect(isTerminal(ORDER_TRANSITIONS, "CANCELLED")).toBe(true);
    expect(isTerminal(ORDER_TRANSITIONS, "REFUNDED")).toBe(true);
  });

  it("allows cancelling only before the goods leave, and refunds only after payment", () => {
    for (const status of ["DRAFT", "PENDING", "PAID", "PACKED"] as const) {
      expect(canTransition(ORDER_TRANSITIONS, status, "CANCELLED")).toBe(true);
    }
    expect(cancelNeedsRefund("PENDING")).toBe(false);
    expect(cancelNeedsRefund("PAID")).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, "PENDING", "REFUNDED")).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, "COMPLETED", "REFUNDED")).toBe(true);
  });

  it("starts marketplace orders at pending", () => {
    expect(initialStatusFor("DIRECT", "draft")).toBe("DRAFT");
    expect(initialStatusFor("SHOPEE", "place")).toBe("PENDING");
    expect(() => initialStatusFor("LAZADA", "draft")).toThrow(/already placed/);
  });

  it("maps each move to a permission the right roles hold", () => {
    expect(can("WAREHOUSE", TRANSITION_PERMISSION.PACKED)).toBe(true);
    expect(can("SALES", TRANSITION_PERMISSION.PACKED)).toBe(false);
    expect(can("SALES", TRANSITION_PERMISSION.PAID)).toBe(true);
    expect(can("WAREHOUSE", TRANSITION_PERMISSION.PAID)).toBe(false);
    expect(can("SALES", TRANSITION_PERMISSION.REFUNDED)).toBe(false);
    expect(can("MANAGER", TRANSITION_PERMISSION.REFUNDED)).toBe(true);
  });

  it("reads status on two axes, payment and fulfilment", () => {
    const money = { totalCentavos: 10_000, amountPaidCentavos: 10_000, amountRefundedCentavos: 0 };
    expect(paymentAxis({ status: "PENDING", ...money, amountPaidCentavos: 0 }).label).toBe(
      "unpaid",
    );
    expect(paymentAxis({ status: "PACKED", ...money }).label).toBe("paid");
    expect(
      paymentAxis({ status: "DELIVERED", ...money, amountRefundedCentavos: 2_000 }).label,
    ).toBe("partly refunded");
    expect(
      paymentAxis({ status: "CANCELLED", ...money, amountRefundedCentavos: 10_000 }).label,
    ).toBe("refunded");
    expect(fulfilmentAxis("PAID").label).toBe("unfulfilled");
    expect(fulfilmentAxis("SHIPPED").label).toBe("shipped");
  });
});

describe("return and warranty transitions", () => {
  it("lets only a received return complete", () => {
    expect(canTransition(RETURN_TRANSITIONS, "REQUESTED", "COMPLETED")).toBe(false);
    expect(canTransition(RETURN_TRANSITIONS, "APPROVED", "COMPLETED")).toBe(false);
    expect(canTransition(RETURN_TRANSITIONS, "RECEIVED", "COMPLETED")).toBe(true);
    expect(isTerminal(RETURN_TRANSITIONS, "REJECTED")).toBe(true);
  });

  it("allows the appeal path on a rejected claim, and nothing out of closed", () => {
    expect(canTransition(WARRANTY_TRANSITIONS, "REJECTED", "UNDER_REVIEW")).toBe(true);
    expect(canTransition(WARRANTY_TRANSITIONS, "SUBMITTED", "APPROVED")).toBe(false);
    expect(canTransition(WARRANTY_TRANSITIONS, "UNDER_REVIEW", "REPLACED")).toBe(false);
    expect(isTerminal(WARRANTY_TRANSITIONS, "CLOSED")).toBe(true);
  });

  it("counts coverage in calendar months, clamped to month end", () => {
    expect(warrantyExpiry(new Date("2026-01-31T05:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T05:00:00.000Z",
    );
    expect(warrantyExpiry(new Date("2026-03-15T05:00:00Z"), 12).toISOString()).toBe(
      "2027-03-15T05:00:00.000Z",
    );
  });

  it("never lets two returns claim the same unit", () => {
    expect(returnableQty({ qty: 3, qtyReturned: 1 }, 1)).toBe(1);
    expect(returnableQty({ qty: 3, qtyReturned: 2 }, 2)).toBe(0);
  });
});

// ========================================================= payments, refunds

describe("split payments", () => {
  it("settles a split exactly, with change only from cash", () => {
    const settlement = settleTenders(
      650_000,
      [
        { method: "GCASH", amountCentavos: 400_000, reference: "GC1234567890" },
        { method: "CASH", amountCentavos: 250_000, tenderedCentavos: 300_000 },
      ],
      { channel: "DIRECT" },
    );
    expect(settlement.payments).toHaveLength(2);
    expect(settlement.changeCentavos).toBe(50_000);
    expect(settlement.payments[1]).toMatchObject({
      tenderedCentavos: 300_000,
      changeCentavos: 50_000,
    });
  });

  it("refuses a split that is short or over, and names the gap", () => {
    expect(() =>
      settleTenders(100_000, [{ method: "CARD", amountCentavos: 90_000 }], { channel: "DIRECT" }),
    ).toThrow(/short/);
    expect(() =>
      settleTenders(100_000, [{ method: "CARD", amountCentavos: 110_000 }], { channel: "DIRECT" }),
    ).toThrow(/more than is due/);
  });

  it("enforces the method rules", () => {
    const channel = { channel: "DIRECT" as const };
    expect(() =>
      settleTenders(100_000, [{ method: "GCASH", amountCentavos: 100_000 }], channel),
    ).toThrow(/reference/);
    expect(() =>
      settleTenders(
        100_000,
        [
          { method: "COD", amountCentavos: 50_000 },
          { method: "CARD", amountCentavos: 50_000 },
        ],
        channel,
      ),
    ).toThrow(/cannot be split/);
    expect(() =>
      settleTenders(100_000, [{ method: "COD", amountCentavos: 100_000 }], { channel: "POS" }),
    ).toThrow(/counter/);
    expect(() =>
      settleTenders(
        100_000,
        [{ method: "CASH", amountCentavos: 100_000, tenderedCentavos: 90_000 }],
        channel,
      ),
    ).toThrow(/less than/);
    expect(() =>
      settleTenders(
        100_000,
        [{ method: "CARD", amountCentavos: 100_000, tenderedCentavos: 120_000 }],
        channel,
      ),
    ).toThrow(/Only cash/);
  });

  it("settles a zero-value order with no payments at all", () => {
    expect(settleTenders(0, [], { channel: "DIRECT" })).toEqual({
      payments: [],
      changeCentavos: 0,
    });
    expect(() =>
      settleTenders(0, [{ method: "CASH", amountCentavos: 1 }], { channel: "DIRECT" }),
    ).toThrow(/Nothing is due/);
  });
});

describe("refunds", () => {
  it("refunds a line one unit at a time to exactly its total", () => {
    // Three units whose discounted line total does not divide evenly.
    const line = { qty: 3, lineTotalCentavos: 100_000 };
    const parts = [
      refundForUnits(line, 0, 1),
      refundForUnits(line, 1, 1),
      refundForUnits(line, 2, 1),
    ];
    expect(sum(parts)).toBe(100_000);
    expect(refundForUnits(line, 0, 3)).toBe(100_000);
    expect(refundForUnits(line, 1, 2)).toBe(100_000 - parts[0]!);
  });

  it("refuses to return more than was sold", () => {
    expect(() => refundForUnits({ qty: 2, lineTotalCentavos: 1_000 }, 1, 2)).toThrow(/Only 1/);
  });

  it("never refunds more than was paid less what went back", () => {
    const order = { amountPaidCentavos: 50_000, amountRefundedCentavos: 20_000 };
    expect(refundableBalance(order)).toBe(30_000);
    expect(() => assertRefundable(order, 30_000)).not.toThrow();
    expect(() => assertRefundable(order, 30_001)).toThrow(/Only/);
    expect(() => assertRefundable({ ...order, amountRefundedCentavos: 50_000 }, 1)).toThrow(
      /already been refunded/,
    );
  });

  it("calls an order refunded only when the money or every unit has gone back", () => {
    const items = [
      { qty: 2, qtyReturned: 1 },
      { qty: 1, qtyReturned: 0 },
    ];
    expect(
      isFullyRefunded({ amountPaidCentavos: 10_000, amountRefundedCentavos: 4_000, items }),
    ).toBe(false);
    expect(
      isFullyRefunded({ amountPaidCentavos: 10_000, amountRefundedCentavos: 10_000, items }),
    ).toBe(true);
    expect(
      isFullyRefunded({
        amountPaidCentavos: 10_000,
        amountRefundedCentavos: 9_000,
        items: items.map((item) => ({ ...item, qtyReturned: item.qty })),
      }),
    ).toBe(true);
  });
});

// ================================================================ documents

describe("sales documents", () => {
  const printable = {
    company: { name: "TechGear PH", tin: "008-472-915-000", address: "128 Katipunan Avenue" },
    order: {
      id: "ord_1",
      orderNumber: "SO-2026-000123",
      status: "PAID" as const,
      channel: "POS" as const,
      channelReference: null,
      placedAt: new Date("2026-09-25T02:00:00Z"),
      paidAt: new Date("2026-09-25T02:05:00Z"),
      subtotalCentavos: 459_000,
      discountCentavos: 45_900,
      shippingCentavos: 0,
      vatCentavos: vatFromGross(413_100),
      totalCentavos: 413_100,
      amountPaidCentavos: 413_100,
      amountRefundedCentavos: 0,
      promoCodeSnapshot: "TECHGEAR10",
      customer: {
        code: "CUS-00001",
        displayName: "Josefina Peñaflor",
        email: null,
        phone: null,
        taxId: null,
      },
      billingAddress: null,
      shippingAddress: null,
      salesperson: { name: "Miguel Villanueva" },
      warehouse: { code: "MNL-MAIN", name: "Manila Main Warehouse" },
      items: [
        {
          id: "oit_1",
          skuSnapshot: "KB-AUR-K87",
          nameSnapshot: "Aureus K87 Tenkeyless Black / Tanay Red",
          qty: 1,
          unitPriceCentavos: 459_000,
          discountCentavos: 45_900,
          lineTotalCentavos: 413_100,
          vatCentavos: vatFromGross(413_100),
        },
      ],
      payments: [
        {
          method: "CASH" as const,
          amountCentavos: 413_100,
          tenderedCentavos: 500_000,
          changeCentavos: 86_900,
          reference: null,
        },
      ],
    },
  };

  it("carries the BIR figures and the cash change", () => {
    const doc = salesDocument("receipt", printable);
    const totals = Object.fromEntries(doc.totals.map((row) => [row.label, row.value]));
    expect(totals["Total amount due"]).toBe("4,131.00");
    expect(totals["VAT, 12%"]).toBe("442.61");
    expect(totals["VATable sales"]).toBe("3,688.39");
    expect(doc.payments.map((row) => row.label)).toEqual(["Cash", "Cash tendered", "Change"]);
    expect(doc.fileName).toBe("SO-2026-000123-receipt.pdf");
  });

  it("never writes a dash character a person could see", () => {
    const doc = salesDocument("invoice", printable);
    expect(JSON.stringify(doc)).not.toMatch(/[–—]/);
  });

  it("keeps Latin-1 names and transliterates what the PDF fonts cannot draw", () => {
    expect(pdfSafe("Josefina Peñaflor")).toBe("Josefina Peñaflor");
    expect(pdfSafe("₱4,131.00")).toBe("?4,131.00");
    expect(pdfSafe("Łukasz")).toBe("?ukasz");
    expect(pdfSafe("Crème brûlée")).toBe("Crème brûlée");
  });

  it("renders a real PDF for both layouts", async () => {
    for (const kind of ["invoice", "receipt"] as const) {
      const bytes = await renderSalesDocumentPdf(salesDocument(kind, printable));
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(1_000);
    }
  });
});
