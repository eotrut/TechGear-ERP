/**
 * Reorder and rebalancing arithmetic. Pure, so the rules the alerts page shows
 * are the rules the tests pin down.
 *
 * The policy is the textbook (s, nQ) reorder point: when the inventory
 * position falls to the reorder point s, order enough whole batches of the
 * reorder quantity Q to lift it back above s.
 *
 *   inventory position = available + on order
 *
 * "On order" counts units already coming from suppliers and from other
 * warehouses, so a SKU with a purchase order in flight is not suggested twice.
 */

export type ReorderInput = {
  /** On hand minus reserved, summed across warehouses. */
  available: number;
  /** Open purchase order units not yet received. */
  onOrder: number;
  /** s. Zero means nobody set one. */
  reorderLevel: number;
  /** Q, the usual order batch. Zero means nobody set one. */
  reorderQty: number;
};

export function inventoryPosition(input: Pick<ReorderInput, "available" | "onOrder">): number {
  return input.available + input.onOrder;
}

/** Units to order now. Zero when the position is healthy. */
export function suggestedReorderQty(input: ReorderInput): number {
  const position = inventoryPosition(input);

  // Without a reorder point there is no policy to apply, except that an empty
  // shelf with nothing coming is always worth one batch.
  if (input.reorderLevel <= 0) {
    return position <= 0 ? Math.max(input.reorderQty, 1) : 0;
  }

  if (position > input.reorderLevel) return 0;

  const batch = input.reorderQty > 0 ? input.reorderQty : input.reorderLevel;
  const batches = Math.floor((input.reorderLevel - position) / batch) + 1;
  return batches * batch;
}

/**
 * Days until the shelf is empty at the recent sales rate. Null when nothing
 * sold in the window, which is a different fact from "zero days left".
 */
export function daysOfCover(
  available: number,
  unitsSoldInWindow: number,
  windowDays: number,
): number | null {
  if (unitsSoldInWindow <= 0 || windowDays <= 0) return null;
  if (available <= 0) return 0;
  return Math.floor(available / (unitsSoldInWindow / windowDays));
}

export type Donor = { warehouseId: string; code: string; available: number };

export type Rebalance = { fromWarehouseId: string; fromCode: string; qty: number };

/**
 * Can a short warehouse be topped up from another one instead of buying more?
 *
 * Both sides aim for twice the reorder point, a buffer that survives a busy
 * weekend. The receiving side asks for its shortfall below that target; a
 * donor offers only what it holds above the same target, so a transfer never
 * turns one alert into another. The donor with the most to spare wins.
 */
export function rebalanceSuggestion(
  short: { available: number; reorderLevel: number },
  donors: readonly Donor[],
): Rebalance | null {
  const target = Math.max(short.reorderLevel * 2, 1);
  const shortfall = target - short.available;
  if (shortfall <= 0) return null;

  let best: { donor: Donor; surplus: number } | null = null;
  for (const donor of donors) {
    const surplus = donor.available - target;
    if (surplus > 0 && (!best || surplus > best.surplus)) best = { donor, surplus };
  }
  if (!best) return null;

  return {
    fromWarehouseId: best.donor.warehouseId,
    fromCode: best.donor.code,
    qty: Math.min(shortfall, best.surplus),
  };
}
