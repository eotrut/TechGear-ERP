import { describe, expect, it } from "vitest";

import {
  adjustmentSchema,
  cancelTransferSchema,
  ledgerFiltersSchema,
  receiveTransferSchema,
  transferSchema,
} from "@/features/inventory/schemas";
import {
  assertMovementShape,
  MOVEMENT_RULES,
  resolveAdjustmentLine,
  stockAlertCrossing,
} from "@/features/inventory/services/movement-rules";
import {
  daysOfCover,
  rebalanceSuggestion,
  suggestedReorderQty,
} from "@/features/inventory/services/reorder";
import { isRetryableTransactionError } from "@/features/inventory/services/stock";
import { TRANSFER_TRANSITIONS } from "@/features/inventory/services/transfers";
import { DomainError, InvalidTransitionError } from "@/lib/errors";
import { formatSigned, manilaYear } from "@/lib/format";
import { formatReference } from "@/lib/numbering";
import { movingAverageCost } from "@/lib/stock-math";
import { assertTransition, canTransition, isTerminal } from "@/lib/transitions";

/**
 * Stock rules that need no database: the movement table, adjustment
 * resolution, alerts, reorder arithmetic, the transfer state machine and the
 * shared schemas. The same rules are exercised against Postgres, with real
 * locks and races, in tests/integration.
 */

describe("movement rules", () => {
  it("only receipts and restocked returns move the moving average", () => {
    const recompute = Object.entries(MOVEMENT_RULES)
      .filter(([, rule]) => rule.recomputesAverage)
      .map(([type]) => type)
      .sort();
    expect(recompute).toEqual(["RECEIPT", "RETURN"]);
  });

  it("gives every type the direction the plan's table specifies", () => {
    expect(MOVEMENT_RULES.RECEIPT.direction).toBe("in");
    expect(MOVEMENT_RULES.RETURN.direction).toBe("in");
    expect(MOVEMENT_RULES.TRANSFER_IN.direction).toBe("in");
    expect(MOVEMENT_RULES.SALE.direction).toBe("out");
    expect(MOVEMENT_RULES.TRANSFER_OUT.direction).toBe("out");
    expect(MOVEMENT_RULES.ADJUSTMENT.direction).toBe("signed");
    expect(MOVEMENT_RULES.WRITE_OFF.direction).toBe("none");
  });

  it("accepts well formed movements", () => {
    expect(() =>
      assertMovementShape({ type: "SALE", reason: "CUSTOMER_SALE", qtyDelta: -2 }),
    ).not.toThrow();
    expect(() =>
      assertMovementShape({
        type: "RECEIPT",
        reason: "PURCHASE_RECEIPT",
        qtyDelta: 10,
        unitCostCentavos: 125_000,
      }),
    ).not.toThrow();
    expect(() =>
      assertMovementShape({ type: "ADJUSTMENT", reason: "COUNT_CORRECTION", qtyDelta: 3 }),
    ).not.toThrow();
  });

  it("rejects a movement whose sign contradicts its type", () => {
    expect(() =>
      assertMovementShape({ type: "SALE", reason: "CUSTOMER_SALE", qtyDelta: 2 }),
    ).toThrow(DomainError);
    expect(() =>
      assertMovementShape({ type: "TRANSFER_IN", reason: "TRANSFER", qtyDelta: -1 }),
    ).toThrow(/positive quantity/);
    expect(() =>
      assertMovementShape({ type: "ADJUSTMENT", reason: "COUNT_CORRECTION", qtyDelta: 0 }),
    ).toThrow(/non-zero/);
    expect(() =>
      assertMovementShape({
        type: "WRITE_OFF",
        reason: "DAMAGE",
        qtyDelta: -1,
        unitCostCentavos: 1,
      }),
    ).toThrow(/zero/);
  });

  it("rejects fractional quantities", () => {
    expect(() =>
      assertMovementShape({ type: "SALE", reason: "CUSTOMER_SALE", qtyDelta: -1.5 }),
    ).toThrow(/whole units/);
  });

  it("requires a supplied cost where the stock arrives at a known price", () => {
    expect(() =>
      assertMovementShape({ type: "RECEIPT", reason: "PURCHASE_RECEIPT", qtyDelta: 5 }),
    ).toThrow(/unit cost/);
    expect(() =>
      assertMovementShape({
        type: "RETURN",
        reason: "CUSTOMER_RETURN",
        qtyDelta: 1,
        unitCostCentavos: -5,
      }),
    ).toThrow(/unit cost/);
  });

  it("rejects a reason that does not belong to the type", () => {
    expect(() => assertMovementShape({ type: "SALE", reason: "DAMAGE", qtyDelta: -1 })).toThrow(
      /not a valid reason/,
    );
    expect(() =>
      assertMovementShape({ type: "ADJUSTMENT", reason: "CUSTOMER_SALE", qtyDelta: -1 }),
    ).toThrow(/not a valid reason/);
  });

  it("lets only a sale consume reserved stock", () => {
    expect(() =>
      assertMovementShape({
        type: "TRANSFER_OUT",
        reason: "TRANSFER",
        qtyDelta: -1,
        fromReserved: true,
      }),
    ).toThrow(/Only a sale/);
  });

  it("never lets damage, loss, theft or samples add stock", () => {
    for (const reason of ["DAMAGE", "LOSS", "THEFT", "SAMPLE"] as const) {
      expect(() => assertMovementShape({ type: "ADJUSTMENT", reason, qtyDelta: 1 })).toThrow(
        /can only remove stock/,
      );
      expect(() => assertMovementShape({ type: "ADJUSTMENT", reason, qtyDelta: -1 })).not.toThrow();
    }
  });
});

describe("adjustment lines", () => {
  const position = { onHand: 12, reserved: 3 };

  it("passes a change through unchanged", () => {
    expect(resolveAdjustmentLine({ mode: "delta", quantity: -4 }, position, "SKU")).toEqual({
      qtyDelta: -4,
      countedQty: null,
    });
  });

  it("turns a count into the difference from the live position", () => {
    expect(resolveAdjustmentLine({ mode: "count", quantity: 10 }, position, "SKU")).toEqual({
      qtyDelta: -2,
      countedQty: 10,
    });
    expect(resolveAdjustmentLine({ mode: "count", quantity: 15 }, position, "SKU")).toEqual({
      qtyDelta: 3,
      countedQty: 15,
    });
    expect(resolveAdjustmentLine({ mode: "count", quantity: 12 }, position, "SKU").qtyDelta).toBe(
      0,
    );
  });

  it("refuses to remove units that are promised to pending orders", () => {
    // 12 on hand, 3 reserved: 9 can be adjusted away, not 10.
    expect(() =>
      resolveAdjustmentLine({ mode: "delta", quantity: -10 }, position, "KB-01"),
    ).toThrow(/9 available to adjust/);
    expect(() => resolveAdjustmentLine({ mode: "count", quantity: 2 }, position, "KB-01")).toThrow(
      /3 are reserved/,
    );
    expect(resolveAdjustmentLine({ mode: "count", quantity: 3 }, position, "KB-01").qtyDelta).toBe(
      -9,
    );
  });
});

describe("stock alerts", () => {
  it("fires once when stock crosses the reorder point", () => {
    expect(stockAlertCrossing(8, 5, 5)).toBe("LOW_STOCK");
    expect(stockAlertCrossing(5, 3, 5)).toBeNull();
    expect(stockAlertCrossing(6, 6, 5)).toBeNull();
  });

  it("calls out running empty ahead of running low", () => {
    expect(stockAlertCrossing(9, 0, 5)).toBe("OUT_OF_STOCK");
    expect(stockAlertCrossing(2, 0, 5)).toBe("OUT_OF_STOCK");
    expect(stockAlertCrossing(0, 0, 5)).toBeNull();
  });

  it("ignores the reorder point when nobody set one", () => {
    expect(stockAlertCrossing(3, 1, 0)).toBeNull();
    expect(stockAlertCrossing(1, 0, 0)).toBe("OUT_OF_STOCK");
  });

  it("does not alert when stock comes back", () => {
    expect(stockAlertCrossing(0, 10, 5)).toBeNull();
  });
});

describe("moving-average cost", () => {
  it("lets the first receipt set the average", () => {
    expect(movingAverageCost(0, 0, 10, 125_000)).toBe(125_000);
    // Recovering from zero stock does not weight against the old average.
    expect(movingAverageCost(0, 90_000, 5, 110_000)).toBe(110_000);
  });

  it("weights by units", () => {
    expect(movingAverageCost(10, 100_000, 30, 140_000)).toBe(130_000);
    expect(movingAverageCost(20, 150_000, 5, 100_000)).toBe(140_000);
  });

  it("rounds to whole centavos, half away from zero", () => {
    // (1 x 100 + 2 x 101) / 3 = 100.67
    expect(movingAverageCost(1, 100, 2, 101)).toBe(101);
    // (1 x 100 + 1 x 101) / 2 = 100.5
    expect(movingAverageCost(1, 100, 1, 101)).toBe(101);
  });

  it("leaves the average alone when nothing comes in", () => {
    expect(movingAverageCost(10, 100_000, 0, 999_999)).toBe(100_000);
  });

  it("stays exact at the plan's stated magnitude and refuses beyond it", () => {
    // About 10^4 units at 10^7 centavos: a numerator near 10^11, past Int32.
    expect(movingAverageCost(10_000, 10_000_000, 10_000, 10_000_000)).toBe(10_000_000);
    expect(() => movingAverageCost(Number.MAX_SAFE_INTEGER, 1_000_000, 1, 1_000_000)).toThrow(
      RangeError,
    );
  });
});

describe("reorder suggestions", () => {
  it("suggests nothing while the position is above the reorder point", () => {
    expect(
      suggestedReorderQty({ available: 12, onOrder: 0, reorderLevel: 10, reorderQty: 40 }),
    ).toBe(0);
  });

  it("orders one batch at the reorder point", () => {
    expect(
      suggestedReorderQty({ available: 10, onOrder: 0, reorderLevel: 10, reorderQty: 40 }),
    ).toBe(40);
  });

  it("counts units already on order, so nothing is ordered twice", () => {
    expect(
      suggestedReorderQty({ available: 4, onOrder: 40, reorderLevel: 10, reorderQty: 40 }),
    ).toBe(0);
  });

  it("orders enough whole batches to clear the reorder point", () => {
    // Position -30 against s = 10 with Q = 20: two batches only reach 10.
    expect(
      suggestedReorderQty({ available: -30, onOrder: 0, reorderLevel: 10, reorderQty: 20 }),
    ).toBe(60);
  });

  it("falls back to the reorder point as the batch when none is set", () => {
    expect(suggestedReorderQty({ available: 2, onOrder: 0, reorderLevel: 8, reorderQty: 0 })).toBe(
      8,
    );
  });

  it("still flags an empty shelf with no policy at all", () => {
    expect(suggestedReorderQty({ available: 0, onOrder: 0, reorderLevel: 0, reorderQty: 0 })).toBe(
      1,
    );
    expect(suggestedReorderQty({ available: 3, onOrder: 0, reorderLevel: 0, reorderQty: 25 })).toBe(
      0,
    );
  });

  it("estimates days of cover from recent sales", () => {
    expect(daysOfCover(10, 30, 30)).toBe(10);
    expect(daysOfCover(10, 60, 30)).toBe(5);
    expect(daysOfCover(0, 60, 30)).toBe(0);
    expect(daysOfCover(10, 0, 30)).toBeNull();
  });
});

describe("rebalancing between warehouses", () => {
  const donors = [
    { warehouseId: "w1", code: "MNL-MAIN", available: 40 },
    { warehouseId: "w2", code: "DVO-HUB", available: 14 },
  ];

  it("tops a short warehouse up from the one with most to spare", () => {
    // Target 2 x 6 = 12. Short by 10; MNL-MAIN can spare 28.
    expect(rebalanceSuggestion({ available: 2, reorderLevel: 6 }, donors)).toEqual({
      fromWarehouseId: "w1",
      fromCode: "MNL-MAIN",
      qty: 10,
    });
  });

  it("never takes a donor below its own buffer", () => {
    expect(
      rebalanceSuggestion({ available: 0, reorderLevel: 10 }, [
        { warehouseId: "w1", code: "MNL-MAIN", available: 26 },
      ]),
    ).toEqual({ fromWarehouseId: "w1", fromCode: "MNL-MAIN", qty: 6 });
    expect(
      rebalanceSuggestion({ available: 0, reorderLevel: 10 }, [
        { warehouseId: "w1", code: "MNL-MAIN", available: 20 },
      ]),
    ).toBeNull();
  });

  it("suggests nothing for a healthy warehouse", () => {
    expect(rebalanceSuggestion({ available: 30, reorderLevel: 6 }, donors)).toBeNull();
  });
});

describe("transfer status machine", () => {
  it("allows exactly the documented moves", () => {
    expect(canTransition(TRANSFER_TRANSITIONS, "DRAFT", "IN_TRANSIT")).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, "DRAFT", "CANCELLED")).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, "IN_TRANSIT", "RECEIVED")).toBe(true);
    expect(canTransition(TRANSFER_TRANSITIONS, "IN_TRANSIT", "CANCELLED")).toBe(true);

    expect(canTransition(TRANSFER_TRANSITIONS, "DRAFT", "RECEIVED")).toBe(false);
    expect(canTransition(TRANSFER_TRANSITIONS, "RECEIVED", "CANCELLED")).toBe(false);
    expect(canTransition(TRANSFER_TRANSITIONS, "IN_TRANSIT", "DRAFT")).toBe(false);
  });

  it("treats received and cancelled as terminal", () => {
    expect(isTerminal(TRANSFER_TRANSITIONS, "RECEIVED")).toBe(true);
    expect(isTerminal(TRANSFER_TRANSITIONS, "CANCELLED")).toBe(true);
    expect(isTerminal(TRANSFER_TRANSITIONS, "DRAFT")).toBe(false);
  });

  it("throws a readable InvalidTransitionError", () => {
    expect(() =>
      assertTransition(TRANSFER_TRANSITIONS, "Transfer", "RECEIVED", "IN_TRANSIT"),
    ).toThrow(InvalidTransitionError);
    expect(() => assertTransition(TRANSFER_TRANSITIONS, "Transfer", "DRAFT", "RECEIVED")).toThrow(
      "Transfer cannot move from draft to received.",
    );
  });
});

describe("inventory schemas", () => {
  const line = (variantId: string, quantity: number) => ({
    variantId,
    mode: "delta" as const,
    quantity,
  });

  it("requires a reason on every adjustment", () => {
    const result = adjustmentSchema.safeParse({
      warehouseId: "w1",
      note: "",
      lines: [line("v1", -1)],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/cannot be audited/);
  });

  it("requires a note where the reason alone does not explain it", () => {
    for (const reason of ["OTHER", "THEFT"] as const) {
      const result = adjustmentSchema.safeParse({
        warehouseId: "w1",
        reason,
        note: "",
        lines: [line("v1", -1)],
      });
      expect(result.success, reason).toBe(false);
    }
    expect(
      adjustmentSchema.safeParse({
        warehouseId: "w1",
        reason: "THEFT",
        note: "Blotter entry 2026-0913, Katipunan station.",
        lines: [line("v1", -1)],
      }).success,
    ).toBe(true);
  });

  it("rejects the same variant on two lines", () => {
    const result = adjustmentSchema.safeParse({
      warehouseId: "w1",
      reason: "COUNT_CORRECTION",
      note: "",
      lines: [line("v1", -1), line("v1", 2)],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["lines", 1, "variantId"]);
  });

  it("rejects a positive damage line and a zero change", () => {
    expect(
      adjustmentSchema.safeParse({
        warehouseId: "w1",
        reason: "DAMAGE",
        note: "",
        lines: [line("v1", 2)],
      }).success,
    ).toBe(false);
    expect(
      adjustmentSchema.safeParse({
        warehouseId: "w1",
        reason: "COUNT_CORRECTION",
        note: "",
        lines: [line("v1", 0)],
      }).success,
    ).toBe(false);
  });

  it("rejects en and em dashes in notes", () => {
    const result = adjustmentSchema.safeParse({
      warehouseId: "w1",
      reason: "OTHER",
      note: "Rack fell — two units broken",
      lines: [line("v1", -2)],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a transfer to the same warehouse", () => {
    const result = transferSchema.safeParse({
      fromWarehouseId: "w1",
      toWarehouseId: "w1",
      note: "",
      dispatch: true,
      lines: [{ variantId: "v1", qty: 1 }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/two different warehouses/);
  });

  it("rejects negative received quantities and a cancel without a reason", () => {
    expect(
      receiveTransferSchema.safeParse({
        transferId: "t1",
        note: "",
        lines: [{ itemId: "i1", qtyReceived: -1 }],
      }).success,
    ).toBe(false);
    expect(cancelTransferSchema.safeParse({ transferId: "t1", reason: "" }).success).toBe(false);
  });

  it("ignores filter values a hand-edited URL cannot mean", () => {
    const parsed = ledgerFiltersSchema.parse({
      type: "TELEPORT",
      from: "last tuesday",
      page: "-4",
    });
    expect(parsed.type).toBeUndefined();
    expect(parsed.from).toBeUndefined();
    expect(parsed.page).toBe(1);
  });
});

describe("transaction retries", () => {
  it("retries deadlocks and serialization failures however Prisma reports them", () => {
    expect(isRetryableTransactionError({ code: "P2034" })).toBe(true);
    expect(isRetryableTransactionError({ code: "P2010", meta: { code: "40P01" } })).toBe(true);
    expect(isRetryableTransactionError({ cause: { code: "40001" } })).toBe(true);
    expect(isRetryableTransactionError(new Error("ERROR: deadlock detected"))).toBe(true);
  });

  it("does not retry anything else", () => {
    expect(isRetryableTransactionError(new DomainError("short"))).toBe(false);
    expect(isRetryableTransactionError({ code: "P2002" })).toBe(false);
    expect(isRetryableTransactionError(null)).toBe(false);
  });
});

describe("document numbers and dates", () => {
  it("formats references with a padded yearly sequence", () => {
    expect(formatReference("ADJ", 2026, 41)).toBe("ADJ-2026-0041");
    expect(formatReference("TRF", 2027, 12345)).toBe("TRF-2027-12345");
  });

  it("uses the Manila calendar year", () => {
    // 16:30 UTC on 31 December is 00:30 on 1 January in Manila.
    expect(manilaYear(new Date("2026-12-31T16:30:00Z"))).toBe(2027);
    expect(manilaYear(new Date("2026-12-31T15:30:00Z"))).toBe(2026);
  });

  it("signs quantities explicitly", () => {
    expect(formatSigned(3)).toBe("+3");
    expect(formatSigned(-1200)).toBe("-1,200");
    expect(formatSigned(0)).toBe("0");
  });
});
