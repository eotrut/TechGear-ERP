import { describe, expect, it } from "vitest";

import { expenseDataFrom } from "@/features/expenses/services/expenses";
import { receivableDueDate } from "@/features/reports/services/aging-rules";
import { REPORTS } from "@/features/reports/services/catalog";
import {
  addMonths,
  bucketKeys,
  bucketLabel,
  bucketOf,
  changeBps,
  isComparable,
  resolveRange,
  weekStart,
} from "@/features/reports/services/date-range";
import { averageOrderValue, marginBps, orderMeasures } from "@/features/reports/services/measures";
import { assembleStatement, emptyComponents } from "@/features/reports/services/pl-rules";
import { can } from "@/lib/rbac/can";
import { permissionForRoute } from "@/lib/rbac/routes";
import { cn } from "@/lib/utils";

/**
 * Finance and reports: the pure rules every report and the dashboard share.
 * The SQL that feeds them is checked against the seeded database by
 * `npm run db:verify` (section "Reports reconcile").
 */

// 2026-09-28 18:00 in Manila, a Monday.
const NOW = new Date("2026-09-28T10:00:00Z");

describe("date ranges", () => {
  it("resolves a rolling window in Manila days, today included", () => {
    const range = resolveRange({ range: "30d" }, NOW);
    expect(range.fromDay).toBe("2026-08-30");
    expect(range.toDay).toBe("2026-09-28");
    // Midnight Manila is 16:00 UTC the day before.
    expect(range.from.toISOString()).toBe("2026-08-29T16:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-28T16:00:00.000Z");
    expect(range.granularity).toBe("day");
  });

  it("compares with the same number of days immediately before", () => {
    const range = resolveRange({ range: "30d" }, NOW);
    expect(range.previous.fromDay).toBe("2026-07-31");
    expect(range.previous.from.getTime()).toBe(range.from.getTime() - 30 * 86_400_000);
  });

  it("clips the comparison to the same elapsed time, so today is not compared with all of yesterday", () => {
    const range = resolveRange({ range: "today" }, NOW);
    expect(range.previous.fromDay).toBe("2026-09-27");
    // 18 hours into today, so 18 hours into yesterday.
    expect(range.previous.to.getTime() - range.previous.from.getTime()).toBe(18 * 3_600_000);
  });

  it("takes month to date against the same days of last month, clamped at a short month", () => {
    const march31 = new Date("2026-03-31T04:00:00Z");
    const range = resolveRange({ range: "mtd" }, march31);
    expect(range.fromDay).toBe("2026-03-01");
    expect(range.previous.fromDay).toBe("2026-02-01");
    // 30 whole days and 12 hours elapsed; February only has 28 days to give.
    expect(range.previous.toDay).toBe("2026-02-28");
  });

  it("starts the week on Monday", () => {
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-09-27")).toBe("2026-09-21");
    const range = resolveRange({ range: "wtd" }, NOW);
    expect(range.fromDay).toBe("2026-09-28");
    expect(range.previous.fromDay).toBe("2026-09-21");
  });

  it("buckets a year by month and a quarter by week", () => {
    expect(resolveRange({ range: "12m" }, NOW).granularity).toBe("month");
    expect(resolveRange({ range: "90d" }, NOW).granularity).toBe("week");
    const year = resolveRange({ range: "12m" }, NOW);
    expect(bucketKeys(year, "month")).toHaveLength(12);
    expect(bucketKeys(year, "month")[0]).toBe("2025-10");
    expect(bucketOf("2026-09-17", "month")).toBe("2026-09");
    expect(bucketOf("2026-09-17", "week")).toBe("2026-09-14");
    expect(bucketLabel("2026-09-14", "week")).toBe("Wk of Sep 14");
    expect(bucketLabel("2026-09", "month")).toBe("Sep 2026");
  });

  it("accepts a custom range, clamping its end to today", () => {
    const range = resolveRange({ range: "custom", from: "2026-09-01", to: "2026-12-31" }, NOW);
    expect(range.preset).toBe("custom");
    expect(range.toDay).toBe("2026-09-28");
    expect(range.previous.toDay).toBe("2026-08-31");
  });

  it("falls back rather than failing on a malformed or reversed range", () => {
    expect(
      resolveRange({ range: "custom", from: "2026-09-10", to: "2026-09-01" }, NOW).preset,
    ).toBe("30d");
    expect(
      resolveRange({ range: "custom", from: "2026-02-31", to: "2026-03-01" }, NOW).preset,
    ).toBe("30d");
    expect(resolveRange({ range: "fortnight" }, NOW, "mtd").preset).toBe("mtd");
  });

  it("clamps a month shift to the last day of a shorter month", () => {
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
  });

  it("offers a comparison only when the prior period is inside recorded history", () => {
    const history = new Date("2025-09-25T00:00:00Z");
    expect(isComparable(resolveRange({ range: "30d" }, NOW), history)).toBe(true);
    expect(isComparable(resolveRange({ range: "12m" }, NOW), history)).toBe(false);
    expect(isComparable(resolveRange({ range: "30d" }, NOW), null)).toBe(false);
  });

  it("measures change in basis points, with no change against nothing", () => {
    expect(changeBps(110, 100)).toBe(1000);
    expect(changeBps(90, 100)).toBe(-1000);
    expect(changeBps(50, 0)).toBeNull();
  });
});

describe("the revenue definition (D-44)", () => {
  const order = {
    totalCentavos: 1_120_000, // PHP 11,200 incl. VAT and shipping
    shippingCentavos: 20_000,
    vatCentavos: 120_000,
    amountRefundedCentavos: 0,
    costTotalCentavos: 600_000,
    restockedCostCentavos: 0,
  };

  it("counts a clean order at its total, net of VAT for margin", () => {
    const m = orderMeasures(order);
    expect(m.revenueCentavos).toBe(1_120_000);
    expect(m.merchandiseCentavos).toBe(1_100_000);
    expect(m.netSalesCentavos).toBe(1_000_000);
    expect(m.grossProfitCentavos).toBe(400_000);
  });

  it("nets a refund against its order, VAT inside it included", () => {
    const m = orderMeasures({
      ...order,
      amountRefundedCentavos: 112_000,
      restockedCostCentavos: 60_000,
    });
    expect(m.revenueCentavos).toBe(1_008_000);
    expect(m.outputVatCentavos).toBe(108_000);
    expect(m.netSalesCentavos).toBe(900_000);
    expect(m.cogsCentavos).toBe(540_000);
    // The bridge the sales report draws: merchandise + shipping - refunds = revenue.
    expect(m.merchandiseCentavos + m.shippingCentavos - m.refundsCentavos).toBe(m.revenueCentavos);
  });

  it("keeps a returned unit's cost in COGS when it was written off, not restocked", () => {
    const m = orderMeasures({
      ...order,
      amountRefundedCentavos: 112_000,
      restockedCostCentavos: 0,
    });
    expect(m.cogsCentavos).toBe(600_000);
  });

  it("reports margin and average order without dividing by zero", () => {
    expect(marginBps(400_000, 1_000_000)).toBe(4000);
    expect(marginBps(0, 0)).toBeNull();
    expect(averageOrderValue(1_000_001, 3)).toBe(333_334);
    expect(averageOrderValue(500, 0)).toBe(0);
  });
});

describe("profit and loss", () => {
  it("takes gross profit, then every operating line, to operating profit", () => {
    const c = emptyComponents();
    c.netSales = 1_000_000;
    c.cogs = 600_000;
    c.expenses.RENT = 150_000;
    c.expenses.SALARIES = 120_000;
    c.warrantyReplacements = 5_000;
    c.refundedStockLoss = 3_000;
    c.inventoryAdjustments = 2_000;
    const statement = assembleStatement(c);
    expect(statement.grossProfit).toBe(400_000);
    expect(statement.operatingExpenses).toBe(280_000);
    expect(statement.operatingProfit).toBe(120_000);
  });

  it("signs costs negative and lets the lines sum to the result", () => {
    const c = emptyComponents();
    c.netSales = 500_000;
    c.cogs = 300_000;
    c.expenses.ADS = 50_000;
    const statement = assembleStatement(c);
    const detail = statement.lines.filter((line) => line.kind === "income" || line.kind === "cost");
    expect(detail.reduce((sum, line) => sum + line.amount, 0)).toBe(statement.operatingProfit);
    expect(statement.lines.find((line) => line.key === "cogs")?.amount).toBe(-300_000);
  });

  it("books a count that found units as a gain", () => {
    const c = emptyComponents();
    c.netSales = 100_000;
    c.inventoryAdjustments = -4_000;
    expect(assembleStatement(c).operatingProfit).toBe(104_000);
  });
});

describe("receivables", () => {
  it("gives B2B accounts thirty days and every other channel seven", () => {
    const placed = new Date("2026-09-01T02:00:00Z");
    expect(receivableDueDate(placed, "B2B").toISOString()).toBe("2026-10-01T02:00:00.000Z");
    expect(receivableDueDate(placed, "SHOPEE").toISOString()).toBe("2026-09-08T02:00:00.000Z");
  });
});

describe("expenses", () => {
  const values = {
    category: "UTILITIES" as const,
    description: "Meralco, August",
    vendor: "Meralco",
    amount: "33,600.00",
    vatable: true,
    incurredOn: "2026-09-02",
  };

  it("splits 12% input VAT out of a VAT-inclusive receipt", () => {
    const data = expenseDataFrom(values, NOW);
    expect(data.amountCentavos).toBe(3_360_000);
    expect(data.vatCentavos).toBe(360_000);
    expect(data.incurredAt.toISOString()).toBe("2026-09-01T16:00:00.000Z");
  });

  it("carries no VAT for payroll and unregistered vendors", () => {
    expect(expenseDataFrom({ ...values, vatable: false }, NOW).vatCentavos).toBe(0);
  });

  it("refuses a future date and a zero amount", () => {
    expect(() => expenseDataFrom({ ...values, incurredOn: "2026-10-01" }, NOW)).toThrow(/future/);
    expect(() => expenseDataFrom({ ...values, amount: "0" }, NOW)).toThrow(/above zero/);
  });
});

describe("report access", () => {
  it("lets every role open the report index", () => {
    for (const role of ["ADMIN", "MANAGER", "SALES", "WAREHOUSE"] as const) {
      expect(can(role, "reports.view")).toBe(true);
    }
    expect(permissionForRoute("/reports")).toBe("reports.view");
  });

  it("gates each report in middleware with the permission its page checks", () => {
    for (const report of Object.values(REPORTS)) {
      expect(permissionForRoute(`/reports/${report.slug}`), report.slug).toBe(report.permission);
    }
  });

  it("keeps finance reports from Sales and Warehouse, and inventory reports from Sales", () => {
    expect(can("SALES", REPORTS.pl.permission)).toBe(false);
    expect(can("WAREHOUSE", REPORTS.vat.permission)).toBe(false);
    expect(can("WAREHOUSE", REPORTS["inventory-valuation"].permission)).toBe(true);
    expect(can("SALES", REPORTS["slow-moving"].permission)).toBe(false);
    expect(can("SALES", REPORTS.sales.permission)).toBe(true);
  });

  it("lets only managers and admins record expenses, and only admins delete them", () => {
    expect(permissionForRoute("/expenses/new")).toBe("expenses.manage");
    expect(can("MANAGER", "expenses.manage")).toBe(true);
    expect(can("MANAGER", "expenses.delete")).toBe(false);
    expect(can("SALES", "expenses.view")).toBe(false);
  });
});

describe("class merging", () => {
  it("keeps a named type size beside a text colour", () => {
    expect(cn("text-caption text-ink-subtle")).toBe("text-caption text-ink-subtle");
    expect(cn("text-body-sm", "text-ink")).toBe("text-body-sm text-ink");
    expect(cn("text-caption", "text-body")).toBe("text-body");
  });
});
