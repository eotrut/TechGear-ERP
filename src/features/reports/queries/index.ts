import { cache } from "react";

import { payablesAging } from "@/features/purchasing/queries";
import { db } from "@/lib/db";
import { scopeFor } from "@/lib/rbac/can";
import type { CurrentUser } from "@/lib/rbac/guard";

import type { SalesBreakdown } from "../schemas";
import type { SalesScope } from "../services/measures";
import { addDays, dayStart, isComparable, manilaDay, type DateRange } from "../services/date-range";
import { profitAndLoss, vatSummary } from "../services/finance";
import {
  movementSummary,
  slowMoving,
  valuationAsOf,
  inventoryValueNow,
} from "../services/inventory";
import {
  customerValue,
  purchasesBySupplier,
  receivablesAging,
  receivedSeries,
} from "../services/operations";
import { assembleStatement } from "../services/pl-rules";
import {
  salesByCategory,
  salesByChannel,
  salesByProduct,
  salesBySalesperson,
  salesPeriod,
  unitsSold,
} from "../services/sales";

/**
 * Report read paths. Each loader is what one report page renders and what its
 * CSV export writes, so the download is always the page's own numbers. Role
 * scoping happens here, in the query, never by hiding rows in the page.
 */

type Viewer = Pick<CurrentUser, "id" | "role">;

/** The first sale on record. Cached per request: several sections ask. */
export const historyStart = cache(async (): Promise<Date | null> => {
  const row = await db.order.aggregate({ _min: { placedAt: true } });
  return row._min.placedAt;
});

/** Whether the range's prior period lies inside recorded history. */
export async function hasComparison(range: DateRange): Promise<boolean> {
  return isComparable(range, await historyStart());
}

/**
 * Sales sees company-wide sales by product, category and channel (the matrix
 * marks them R), but the salesperson breakdown is scoped to their own row.
 */
function salespersonScope(viewer: Viewer): SalesScope {
  return scopeFor(viewer.role, "reports.salesBySalesperson") === "own"
    ? { salespersonId: viewer.id }
    : {};
}

export async function loadSalesReport(range: DateRange, by: SalesBreakdown, viewer: Viewer) {
  const [period, units] = await Promise.all([salesPeriod(db, range), unitsSold(db, range)]);

  switch (by) {
    case "product":
      return { by, period, units, products: await salesByProduct(db, range) };
    case "category":
      return { by, period, units, categories: await salesByCategory(db, range) };
    case "channel":
      return { by, period, units, channels: await salesByChannel(db, range) };
    case "salesperson":
      return {
        by,
        period,
        units,
        salespeople: await salesBySalesperson(db, range, salespersonScope(viewer)),
        scopedToSelf: Boolean(salespersonScope(viewer).salespersonId),
      };
  }
}

export type SalesReport = Awaited<ReturnType<typeof loadSalesReport>>;

export async function loadGrossProfit(range: DateRange) {
  const [period, channels] = await Promise.all([salesPeriod(db, range), salesByChannel(db, range)]);
  return { period, channels };
}

export async function loadProfitAndLoss(range: DateRange) {
  const pl = await profitAndLoss(db, range);
  return {
    ...pl,
    statement: assembleStatement(pl.total),
    previousStatement: assembleStatement(pl.previous),
    months: pl.buckets.map((bucket) => ({
      key: bucket.key,
      statement: assembleStatement(bucket.components),
    })),
  };
}

export async function loadVat(range: DateRange) {
  return vatSummary(db, range);
}

export async function loadAging(now: Date) {
  const [receivables, payables] = await Promise.all([
    receivablesAging(db, now),
    payablesAging(now),
  ]);
  return { receivables, payables };
}

export async function loadPurchases(range: DateRange) {
  const [suppliers, previous, series] = await Promise.all([
    purchasesBySupplier(db, range),
    purchasesBySupplier(db, range.previous),
    receivedSeries(db, range),
  ]);
  const sum = (rows: typeof suppliers, pick: (row: (typeof suppliers)[number]) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  const totals = (rows: typeof suppliers) => ({
    pos: sum(rows, (r) => r.posRaised),
    ordered: sum(rows, (r) => r.orderedCentavos),
    received: sum(rows, (r) => r.receivedCentavos),
    receivedUnits: sum(rows, (r) => r.receivedUnits),
    rejectedUnits: sum(rows, (r) => r.rejectedUnits),
    billed: sum(rows, (r) => r.billedCentavos),
    paid: sum(rows, (r) => r.paidCentavos),
  });
  return { suppliers, series, totals: totals(suppliers), previous: totals(previous) };
}

/**
 * Valuation as of the end of a Manila day. Today is taken as of now, which is
 * the only moment the StockLevel cache also describes.
 */
export async function loadValuation(asOfDay: string | undefined, now: Date) {
  const today = manilaDay(now);
  const day = asOfDay && asOfDay < today ? asOfDay : today;
  const asOf = day === today ? now : dayStart(addDays(day, 1));
  const rows = await valuationAsOf(db, asOf);

  const byWarehouse = new Map<
    string,
    { key: string; label: string; units: number; value: number }
  >();
  const byCategory = new Map<
    string,
    { key: string; label: string; units: number; value: number }
  >();
  let value = 0;
  let units = 0;
  const skus = new Set<string>();
  for (const row of rows) {
    value += row.valueCentavos;
    units += row.qty;
    skus.add(row.variantId);
    const w = byWarehouse.get(row.warehouseId) ?? {
      key: row.warehouseId,
      label: row.warehouseName,
      units: 0,
      value: 0,
    };
    w.units += row.qty;
    w.value += row.valueCentavos;
    byWarehouse.set(row.warehouseId, w);
    const c = byCategory.get(row.categoryName) ?? {
      key: row.categoryName,
      label: row.categoryName,
      units: 0,
      value: 0,
    };
    c.units += row.qty;
    c.value += row.valueCentavos;
    byCategory.set(row.categoryName, c);
  }

  return {
    day,
    isToday: day === today,
    rows,
    total: { value, units, skus: skus.size },
    byWarehouse: [...byWarehouse.values()].sort((a, b) => b.value - a.value),
    byCategory: [...byCategory.values()].sort((a, b) => b.value - a.value),
  };
}

export async function loadStockMovement(range: DateRange, warehouseId: string | undefined) {
  return movementSummary(db, range, warehouseId);
}

export async function loadSlowMoving(days: number, now: Date, warehouseId: string | undefined) {
  const [rows, inventory] = await Promise.all([
    slowMoving(db, days, now, warehouseId),
    inventoryValueNow(db),
  ]);
  const value = rows.reduce((total, row) => total + row.valueCentavos, 0);
  const units = rows.reduce((total, row) => total + row.onHand, 0);
  return { rows, value, units, inventoryValue: inventory.value };
}

export async function loadCustomerValue(range: DateRange, options: { limit?: number } = {}) {
  return customerValue(db, range, options);
}
