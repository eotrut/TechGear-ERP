import { describe, expect, it } from "vitest";

import {
  agingBucket,
  billStatusAfterPayment,
  BILL_TRANSITIONS,
  daysOverdue,
  dueDateFor,
  planSupplierPayment,
  priceBill,
  summariseAging,
  unbilledSubtotal,
} from "@/features/purchasing/services/bill-rules";
import {
  canCancel,
  closeNeedsReason,
  PO_TRANSITIONS,
  planReceipt,
  pricePurchaseOrder,
  statusAfterReceipt,
  type PoItemPosition,
} from "@/features/purchasing/services/purchase-rules";
import { supplierPerformance } from "@/features/suppliers/services/performance-rules";
import { DomainError } from "@/lib/errors";
import { movingAverageCost } from "@/lib/stock-math";
import { canTransition, isTerminal } from "@/lib/transitions";

/**
 * Purchasing rules: PO pricing and status flow, receiving, moving-average
 * cost, bills, payments, aging and supplier performance. The database suite
 * (tests/integration/purchasing.test.ts) runs the same rules through the
 * services under real row locks.
 */

// Manila is UTC+8 with no daylight saving, so these are exact.
const manila = (iso: string) => new Date(`${iso}+08:00`);

describe("purchase order status flow", () => {
  it("follows the plan's transition map", () => {
    expect(canTransition(PO_TRANSITIONS, "DRAFT", "SENT")).toBe(true);
    expect(canTransition(PO_TRANSITIONS, "SENT", "PARTIALLY_RECEIVED")).toBe(true);
    expect(canTransition(PO_TRANSITIONS, "SENT", "RECEIVED")).toBe(true);
    expect(canTransition(PO_TRANSITIONS, "PARTIALLY_RECEIVED", "PARTIALLY_RECEIVED")).toBe(true);
    expect(canTransition(PO_TRANSITIONS, "PARTIALLY_RECEIVED", "RECEIVED")).toBe(true);
    expect(canTransition(PO_TRANSITIONS, "RECEIVED", "CLOSED")).toBe(true);
  });

  it("refuses skips and reversals", () => {
    expect(canTransition(PO_TRANSITIONS, "DRAFT", "RECEIVED")).toBe(false);
    expect(canTransition(PO_TRANSITIONS, "DRAFT", "PARTIALLY_RECEIVED")).toBe(false);
    expect(canTransition(PO_TRANSITIONS, "RECEIVED", "SENT")).toBe(false);
    expect(canTransition(PO_TRANSITIONS, "SENT", "CLOSED")).toBe(false);
    expect(canTransition(PO_TRANSITIONS, "PARTIALLY_RECEIVED", "CANCELLED")).toBe(false);
    expect(canTransition(PO_TRANSITIONS, "RECEIVED", "CANCELLED")).toBe(false);
  });

  it("makes closed and cancelled terminal", () => {
    expect(isTerminal(PO_TRANSITIONS, "CLOSED")).toBe(true);
    expect(isTerminal(PO_TRANSITIONS, "CANCELLED")).toBe(true);
    expect(isTerminal(PO_TRANSITIONS, "RECEIVED")).toBe(false);
  });

  it("blocks cancelling once any delivery is booked", () => {
    expect(canCancel("SENT", 0)).toBe(true);
    expect(canCancel("DRAFT", 0)).toBe(true);
    // A delivery rejected in full leaves the PO at SENT, but it was still booked.
    expect(canCancel("SENT", 1)).toBe(false);
    expect(canCancel("PARTIALLY_RECEIVED", 0)).toBe(false);
  });

  it("needs a reason only to close a partly received order short", () => {
    expect(closeNeedsReason("PARTIALLY_RECEIVED")).toBe(true);
    expect(closeNeedsReason("RECEIVED")).toBe(false);
  });
});

describe("pricePurchaseOrder", () => {
  it("adds VAT on top of goods and freight, since supplier prices are net", () => {
    const priced = pricePurchaseOrder(
      [
        { qty: 10, unitCostCentavos: 185_000 },
        { qty: 3, unitCostCentavos: 42_050 },
      ],
      150_000,
    );
    expect(priced.lines.map((line) => line.lineTotalCentavos)).toEqual([1_850_000, 126_150]);
    expect(priced.subtotalCentavos).toBe(1_976_150);
    // 12% of (1,976,150 + 150,000) = 255,138
    expect(priced.vatCentavos).toBe(255_138);
    expect(priced.totalCentavos).toBe(1_976_150 + 150_000 + 255_138);
  });

  it("carries extra fields on each line through to the result", () => {
    const priced = pricePurchaseOrder([{ variantId: "v1", qty: 2, unitCostCentavos: 100 }]);
    expect(priced.lines[0]).toEqual({
      variantId: "v1",
      qty: 2,
      unitCostCentavos: 100,
      lineTotalCentavos: 200,
    });
  });

  it("rejects zero quantities and negative money", () => {
    expect(() => pricePurchaseOrder([{ qty: 0, unitCostCentavos: 100 }])).toThrow(DomainError);
    expect(() => pricePurchaseOrder([{ qty: 1, unitCostCentavos: -1 }])).toThrow(DomainError);
    expect(() => pricePurchaseOrder([{ qty: 1, unitCostCentavos: 100 }], -5)).toThrow(DomainError);
  });
});

describe("receiving", () => {
  const items: PoItemPosition[] = [
    { id: "a", sku: "KB-A", qtyOrdered: 20, qtyReceived: 0, unitCostCentavos: 150_000 },
    { id: "b", sku: "KB-B", qtyOrdered: 10, qtyReceived: 6, unitCostCentavos: 80_000 },
  ];

  it("computes the status from the lines, never from a choice", () => {
    expect(statusAfterReceipt([{ qtyOrdered: 5, qtyReceived: 5 }])).toBe("RECEIVED");
    expect(
      statusAfterReceipt([
        { qtyOrdered: 5, qtyReceived: 5 },
        { qtyOrdered: 4, qtyReceived: 0 },
      ]),
    ).toBe("PARTIALLY_RECEIVED");
    // Everything rejected at the dock: nothing in, status unchanged.
    expect(statusAfterReceipt([{ qtyOrdered: 5, qtyReceived: 0 }])).toBeNull();
  });

  it("plans a partial delivery at a different cost and drops empty lines", () => {
    const plan = planReceipt(items, [
      { itemId: "a", qtyReceived: 12, qtyRejected: 1, unitCostCentavos: 156_000 },
      { itemId: "b", qtyReceived: 0, qtyRejected: 0, unitCostCentavos: 80_000 },
    ]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.acceptedUnits).toBe(12);
    expect(plan.rejectedUnits).toBe(1);
    expect(plan.valueCentavos).toBe(12 * 156_000);
  });

  it("refuses more than is outstanding, counting rejects as arrived", () => {
    expect(() =>
      planReceipt(items, [{ itemId: "b", qtyReceived: 5, qtyRejected: 0, unitCostCentavos: 1 }]),
    ).toThrow(/Only 4 of KB-B are outstanding/);
    expect(() =>
      planReceipt(items, [{ itemId: "b", qtyReceived: 3, qtyRejected: 2, unitCostCentavos: 1 }]),
    ).toThrow(DomainError);
    expect(() =>
      planReceipt(
        [{ ...items[0]!, qtyReceived: 20 }],
        [{ itemId: "a", qtyReceived: 1, qtyRejected: 0, unitCostCentavos: 1 }],
      ),
    ).toThrow(/already received in full/);
  });

  it("refuses an empty delivery, a stranger's line, a duplicate and a free unit", () => {
    expect(() =>
      planReceipt(items, [{ itemId: "a", qtyReceived: 0, qtyRejected: 0, unitCostCentavos: 1 }]),
    ).toThrow(/Nothing to receive/);
    expect(() =>
      planReceipt(items, [{ itemId: "zzz", qtyReceived: 1, qtyRejected: 0, unitCostCentavos: 1 }]),
    ).toThrow(/does not belong/);
    expect(() =>
      planReceipt(items, [
        { itemId: "a", qtyReceived: 1, qtyRejected: 0, unitCostCentavos: 1 },
        { itemId: "a", qtyReceived: 1, qtyRejected: 0, unitCostCentavos: 1 },
      ]),
    ).toThrow(/twice/);
    expect(() =>
      planReceipt(items, [{ itemId: "a", qtyReceived: 1, qtyRejected: 0, unitCostCentavos: 0 }]),
    ).toThrow(/unit cost/);
    // A line rejected in full needs no cost: nothing enters stock.
    expect(
      planReceipt(items, [{ itemId: "a", qtyReceived: 0, qtyRejected: 2, unitCostCentavos: 0 }])
        .rejectedUnits,
    ).toBe(2);
  });
});

describe("moving-average cost across receipts", () => {
  it("weights each delivery by units against everything already on hand", () => {
    // 40 on hand at 1,500.00, then 20 more arrive at 1,800.00.
    expect(movingAverageCost(40, 150_000, 20, 180_000)).toBe(160_000);
  });

  it("seeds the average from the first receipt, and from a zeroed position", () => {
    expect(movingAverageCost(0, 0, 12, 99_950)).toBe(99_950);
    expect(movingAverageCost(0, 120_000, 5, 99_950)).toBe(99_950);
    expect(movingAverageCost(-2, 120_000, 5, 99_950)).toBe(99_950);
  });

  it("rounds to the nearest centavo, half away from zero", () => {
    // (3 * 1000 + 1 * 1001) / 4 = 1000.25
    expect(movingAverageCost(3, 1000, 1, 1001)).toBe(1000);
    // (1 * 1000 + 1 * 1001) / 2 = 1000.5
    expect(movingAverageCost(1, 1000, 1, 1001)).toBe(1001);
  });

  it("is order-sensitive in the way a ledger should be", () => {
    // Two deliveries of the same size in either order land on the same average
    // only when nothing sold in between.
    const ab = movingAverageCost(10, movingAverageCost(0, 0, 10, 100_000), 10, 140_000);
    const ba = movingAverageCost(10, movingAverageCost(0, 0, 10, 140_000), 10, 100_000);
    expect(ab).toBe(120_000);
    expect(ba).toBe(120_000);

    // Sell 8 of the first lot before the second arrives: the cheap stock
    // carries less weight, so the average leans toward the new cost.
    const afterSale = movingAverageCost(2, 100_000, 10, 140_000);
    expect(afterSale).toBe(133_333);
  });

  it("stays exact past the 32-bit numerator boundary", () => {
    // 50,000 units at PHP 50,000.00 is a 2.5e11 numerator; Int32 would wrap.
    expect(movingAverageCost(50_000, 5_000_000, 50_000, 5_000_002)).toBe(5_000_001);
  });

  it("ignores rejected units, which never enter stock", () => {
    // Receiving 10 with 2 rejected is a 10-unit receipt; the rejects do not dilute cost.
    expect(movingAverageCost(10, 100_000, 10, 120_000)).toBe(110_000);
  });
});

describe("supplier bills and payments", () => {
  it("prices a bill VAT-exclusive and refuses zero", () => {
    expect(priceBill(1_000_000)).toEqual({
      subtotalCentavos: 1_000_000,
      vatCentavos: 120_000,
      totalCentavos: 1_120_000,
    });
    expect(() => priceBill(0)).toThrow(DomainError);
  });

  it("suggests the unbilled balance of what arrived", () => {
    expect(
      unbilledSubtotal({
        receivedValueCentavos: 900_000,
        shippingCentavos: 50_000,
        billedSubtotalCentavos: 400_000,
      }),
    ).toBe(550_000);
    expect(
      unbilledSubtotal({
        receivedValueCentavos: 100,
        shippingCentavos: 0,
        billedSubtotalCentavos: 500,
      }),
    ).toBe(0);
  });

  it("dates the bill from the supplier's terms", () => {
    const issued = manila("2026-09-01T00:00:00");
    expect(dueDateFor(issued, "NET_30").getTime()).toBe(manila("2026-10-01T00:00:00").getTime());
    expect(dueDateFor(issued, "COD").getTime()).toBe(issued.getTime());
  });

  it("settles partially, then fully, and never overpays", () => {
    const bill = {
      status: "OPEN" as const,
      billNumber: "SB-2026-0001",
      totalCentavos: 1_120_000,
      amountPaidCentavos: 0,
    };
    expect(planSupplierPayment(bill, 500_000)).toEqual({
      amountPaidAfter: 500_000,
      statusAfter: "PARTIALLY_PAID",
    });
    const partial = { ...bill, status: "PARTIALLY_PAID" as const, amountPaidCentavos: 500_000 };
    expect(planSupplierPayment(partial, 620_000)).toEqual({
      amountPaidAfter: 1_120_000,
      statusAfter: "PAID",
    });
    expect(() => planSupplierPayment(partial, 620_001)).toThrow(/overpay/);
    expect(() => planSupplierPayment(partial, 0)).toThrow(DomainError);
    expect(() => planSupplierPayment({ ...bill, status: "PAID" }, 1)).toThrow(/already paid/);
    expect(() => planSupplierPayment({ ...bill, status: "VOID" }, 1)).toThrow(/cannot be paid/);
    expect(billStatusAfterPayment(100, 0)).toBe("OPEN");
  });

  it("lets only an unpaid bill be voided", () => {
    expect(canTransition(BILL_TRANSITIONS, "OPEN", "VOID")).toBe(true);
    expect(canTransition(BILL_TRANSITIONS, "PARTIALLY_PAID", "VOID")).toBe(false);
    expect(canTransition(BILL_TRANSITIONS, "PAID", "VOID")).toBe(false);
  });
});

describe("payables aging", () => {
  const asOf = manila("2026-09-25T10:00:00");

  it("counts whole Manila days past due, and due today is not late", () => {
    expect(daysOverdue(manila("2026-09-25T00:00:00"), asOf)).toBe(0);
    expect(daysOverdue(manila("2026-09-24T23:59:00"), asOf)).toBe(1);
    // 16:30 UTC on the 24th is already the 25th in Manila.
    expect(daysOverdue(new Date("2026-09-24T16:30:00Z"), asOf)).toBe(0);
  });

  it("buckets at the 30, 60 and 90 day edges", () => {
    const due = (days: number) => new Date(asOf.getTime() - days * 86_400_000);
    expect(agingBucket(due(-5), asOf)).toBe("current");
    expect(agingBucket(due(0), asOf)).toBe("current");
    expect(agingBucket(due(1), asOf)).toBe("d1_30");
    expect(agingBucket(due(30), asOf)).toBe("d1_30");
    expect(agingBucket(due(31), asOf)).toBe("d31_60");
    expect(agingBucket(due(60), asOf)).toBe("d31_60");
    expect(agingBucket(due(61), asOf)).toBe("d61_90");
    expect(agingBucket(due(91), asOf)).toBe("d90_plus");
  });

  it("sums only what is still owed", () => {
    const totals = summariseAging(
      [
        {
          status: "OPEN",
          dueDate: manila("2026-10-10T00:00:00"),
          totalCentavos: 1000,
          amountPaidCentavos: 0,
        },
        {
          status: "PARTIALLY_PAID",
          dueDate: manila("2026-09-10T00:00:00"),
          totalCentavos: 1000,
          amountPaidCentavos: 400,
        },
        {
          status: "PAID",
          dueDate: manila("2026-06-10T00:00:00"),
          totalCentavos: 1000,
          amountPaidCentavos: 1000,
        },
        {
          status: "VOID",
          dueDate: manila("2026-06-10T00:00:00"),
          totalCentavos: 1000,
          amountPaidCentavos: 0,
        },
      ],
      asOf,
    );
    expect(totals).toEqual({
      current: 1000,
      d1_30: 600,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
      total: 1600,
    });
  });
});

describe("supplier performance", () => {
  it("measures on-time deliveries by Manila day, defects by units, lead time by days", () => {
    const performance = supplierPerformance([
      {
        sentAt: manila("2026-08-01T09:00:00"),
        expectedDate: manila("2026-08-10T00:00:00"),
        // Late in the evening of the expected day is still on time.
        receivedAt: manila("2026-08-10T21:00:00"),
        qtyReceived: 95,
        qtyRejected: 5,
      },
      {
        sentAt: manila("2026-08-01T09:00:00"),
        expectedDate: manila("2026-08-10T00:00:00"),
        receivedAt: manila("2026-08-13T10:00:00"),
        qtyReceived: 100,
        qtyRejected: 0,
      },
    ]);
    expect(performance).toEqual({
      deliveries: 2,
      onTimeDeliveries: 1,
      onTimeRateBps: 5000,
      unitsArrived: 200,
      unitsRejected: 5,
      defectRateBps: 250,
      averageLeadDays: 10.5,
    });
  });

  it("has no rate at all before the first delivery", () => {
    const performance = supplierPerformance([]);
    expect(performance.onTimeRateBps).toBeNull();
    expect(performance.defectRateBps).toBeNull();
    expect(performance.averageLeadDays).toBeNull();
  });
});
