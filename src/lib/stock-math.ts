import { roundHalfAwayFromZero } from "@/lib/money";

/**
 * Pure stock-ledger arithmetic, with no database access.
 *
 * The transactional stock service and the seed script both call these, so the
 * ledger seeded for the demo obeys exactly the rules the running app enforces.
 * See docs/PLAN.md sections 6.2 and 6.3.
 */

/**
 * Moving-average cost, recomputed on every inbound movement that carries a
 * cost (a receipt, or a restocked return re-entering at its original cost).
 *
 *     newAvg = (qtyOnHandBefore * avgCostBefore + qtyIn * unitCost)
 *              / (qtyOnHandBefore + qtyIn)
 *
 * `qtyOnHandBefore` is total on-hand for the variant across **all** warehouses:
 * one average per variant, global, per decision D-8.
 *
 * The numerator reaches roughly 10^11 for large quantities, which overflows a
 * 32-bit integer. It is computed as a JS number, which is exact to 2^53, and
 * only the result is rounded back to an integer number of centavos.
 */
export function movingAverageCost(
  qtyOnHandBefore: number,
  avgCostBefore: number,
  qtyIn: number,
  unitCost: number,
): number {
  if (qtyIn <= 0) return avgCostBefore;

  // First stock in, or recovering from a zeroed position: the incoming cost
  // becomes the average rather than dividing by zero or weighting against
  // negative stock.
  if (qtyOnHandBefore <= 0) return unitCost;

  const numerator = qtyOnHandBefore * avgCostBefore + qtyIn * unitCost;
  const denominator = qtyOnHandBefore + qtyIn;

  if (!Number.isSafeInteger(numerator)) {
    throw new RangeError(
      `Moving-average numerator ${numerator} exceeds safe integer range; ` +
        `recompute this variant's average in SQL with a bigint cast.`,
    );
  }

  return roundHalfAwayFromZero(numerator / denominator);
}

/** Stock available to sell. Reserved units are spoken for by pending orders. */
export function availableQty(onHand: number, reserved: number): number {
  return onHand - reserved;
}

export type StockPosition = {
  onHand: number;
  reserved: number;
};

/** Would this draw take a position below zero available? */
export function canFulfil(position: StockPosition, qty: number): boolean {
  return availableQty(position.onHand, position.reserved) >= qty;
}

/**
 * Inventory value at cost. Deliberately recomputed from current positions
 * rather than accumulated, so per-movement rounding residue cannot compound.
 */
export function inventoryValue(
  positions: readonly { onHand: number; avgCostCentavos: number }[],
): number {
  let total = 0;
  for (const position of positions) {
    total += position.onHand * position.avgCostCentavos;
  }
  return total;
}

export type StockHealth = "out" | "low" | "in";

/**
 * How a position reads in the catalogue: out of stock, at or below its reorder
 * level, or healthy. A reorder level of zero means nobody set one, so only a
 * genuinely empty bin is called out.
 */
export function stockHealth(onHand: number, reorderLevel: number): StockHealth {
  if (onHand <= 0) return "out";
  if (reorderLevel > 0 && onHand <= reorderLevel) return "low";
  return "in";
}
