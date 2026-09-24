import type { StockMovementType, StockReason } from "@prisma/client";

import { movingAverageCost } from "../../../src/lib/stock-math";

/**
 * In-memory stock ledger used while seeding.
 *
 * The seed builds a year of history in chronological order and flushes it in
 * bulk, because routing 1,400 movements through the real transactional service
 * one at a time would make `npm run db:seed` unusably slow. To avoid the trap
 * that shortcut usually creates, the arithmetic here is not reimplemented: the
 * moving average comes from the same `src/lib/stock-math` the running app uses,
 * and every rule in docs/PLAN.md section 6.2 is applied.
 *
 * `npm run db:verify` then re-checks the written rows against the ledger
 * invariants in section 6.5, so a divergence would fail the seed rather than
 * sit undetected in the demo data.
 */

export type MovementRow = {
  id: string;
  variantId: string;
  warehouseId: string;
  type: StockMovementType;
  reason: StockReason;
  qtyDelta: number;
  balanceAfter: number;
  unitCostCentavos: number;
  avgCostAfterCentavos: number;
  note: string | null;
  actorId: string | null;
  occurredAt: Date;
  createdAt: Date;
  orderItemId: string | null;
  purchaseReceiptItemId: string | null;
  returnItemId: string | null;
  adjustmentItemId: string | null;
  transferItemId: string | null;
  /** Not persisted. Drives the chronological replay; transfers are cost neutral. */
  recomputeAverage: boolean;
  /** Not persisted. Generation order, used only as a stable tiebreak. */
  sequence: number;
};

type Refs = {
  orderItemId?: string;
  purchaseReceiptItemId?: string;
  returnItemId?: string;
  adjustmentItemId?: string;
  transferItemId?: string;
};

export class InsufficientSeedStock extends Error {}

export class SeedLedger {
  readonly movements: MovementRow[] = [];

  /** `${variantId}::${warehouseId}` -> on-hand at that location. */
  private readonly onHand = new Map<string, number>();
  /** `${variantId}::${warehouseId}` -> units reserved by pending orders. */
  private readonly reserved = new Map<string, number>();
  /** variantId -> total on-hand across every warehouse. */
  private readonly totalOnHand = new Map<string, number>();
  /** variantId -> moving-average cost. One average per variant, global (D-8). */
  private readonly avgCost = new Map<string, number>();

  private sequence = 0;

  private key(variantId: string, warehouseId: string): string {
    return `${variantId}::${warehouseId}`;
  }

  private nextId(): string {
    this.sequence += 1;
    return `mov_${String(this.sequence).padStart(6, "0")}`;
  }

  getOnHand(variantId: string, warehouseId: string): number {
    return this.onHand.get(this.key(variantId, warehouseId)) ?? 0;
  }

  getReserved(variantId: string, warehouseId: string): number {
    return this.reserved.get(this.key(variantId, warehouseId)) ?? 0;
  }

  getAvailable(variantId: string, warehouseId: string): number {
    return this.getOnHand(variantId, warehouseId) - this.getReserved(variantId, warehouseId);
  }

  getAvgCost(variantId: string): number {
    return this.avgCost.get(variantId) ?? 0;
  }

  getTotalOnHand(variantId: string): number {
    return this.totalOnHand.get(variantId) ?? 0;
  }

  /**
   * The most that can be taken out of a position at `at` without the
   * chronological replay ever going negative, and without cutting into units
   * reserved by pending orders at the end.
   *
   * A movement stamped at `at` sorts after everything already dated at or
   * before it, so it lowers the balance from that point on. The limit is
   * therefore the lowest running balance from `at` to the end of the history,
   * computed over the movements generated so far in true date order. Every
   * back-dated outflow the seed adds after the main builders goes through
   * this, which is what lets it date stock corrections across the whole year
   * instead of only at "now".
   */
  headroom(variantId: string, warehouseId: string, at: Date): number {
    const rows = this.movements
      .filter((m) => m.variantId === variantId && m.warehouseId === warehouseId)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.sequence - b.sequence);

    const cutoff = at.getTime();
    let balance = 0;
    let lowest: number | null = null;
    for (const movement of rows) {
      if (lowest === null && movement.occurredAt.getTime() > cutoff) lowest = balance;
      balance += movement.qtyDelta;
      if (lowest !== null) lowest = Math.min(lowest, balance);
    }
    if (lowest === null) lowest = balance;

    const unreserved = balance - this.getReserved(variantId, warehouseId);
    return Math.max(0, Math.min(lowest, unreserved));
  }

  /** Every (variant, warehouse) position that has ever been touched. */
  positions(): { variantId: string; warehouseId: string; onHand: number; reserved: number }[] {
    const rows: { variantId: string; warehouseId: string; onHand: number; reserved: number }[] = [];
    for (const [key, onHand] of this.onHand) {
      const [variantId, warehouseId] = key.split("::");
      if (!variantId || !warehouseId) continue;
      rows.push({ variantId, warehouseId, onHand, reserved: this.reserved.get(key) ?? 0 });
    }
    return rows;
  }

  variantAvgCosts(): { variantId: string; avgCostCentavos: number }[] {
    return [...this.avgCost.entries()].map(([variantId, avgCostCentavos]) => ({
      variantId,
      avgCostCentavos,
    }));
  }

  private push(row: Omit<MovementRow, "id" | "createdAt" | "sequence">): MovementRow {
    const movement: MovementRow = {
      ...row,
      id: this.nextId(),
      createdAt: row.occurredAt,
      sequence: this.movements.length,
    };
    this.movements.push(movement);
    return movement;
  }

  private applyDelta(variantId: string, warehouseId: string, delta: number): number {
    const key = this.key(variantId, warehouseId);
    const next = (this.onHand.get(key) ?? 0) + delta;
    if (next < 0) {
      throw new InsufficientSeedStock(
        `Seed tried to take ${variantId} at ${warehouseId} to ${next}. The ledger must never go negative.`,
      );
    }
    this.onHand.set(key, next);
    this.totalOnHand.set(variantId, (this.totalOnHand.get(variantId) ?? 0) + delta);
    return next;
  }

  /**
   * Inbound stock carrying a cost: a purchase receipt, an opening balance, or a
   * restocked return. Recomputes the variant's moving average.
   */
  receive(input: {
    variantId: string;
    warehouseId: string;
    qty: number;
    unitCostCentavos: number;
    type: Extract<StockMovementType, "RECEIPT" | "RETURN" | "TRANSFER_IN">;
    reason: StockReason;
    occurredAt: Date;
    actorId?: string;
    note?: string;
    refs?: Refs;
    /** Transfers move stock without changing what it cost us. */
    recomputeAverage?: boolean;
  }): MovementRow {
    const recompute = input.recomputeAverage ?? true;

    const avgBefore = this.getAvgCost(input.variantId);
    const totalBefore = this.getTotalOnHand(input.variantId);

    const avgAfter = recompute
      ? movingAverageCost(totalBefore, avgBefore, input.qty, input.unitCostCentavos)
      : avgBefore;

    if (recompute) this.avgCost.set(input.variantId, avgAfter);

    const balanceAfter = this.applyDelta(input.variantId, input.warehouseId, input.qty);

    return this.push({
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      type: input.type,
      reason: input.reason,
      qtyDelta: input.qty,
      balanceAfter,
      unitCostCentavos: input.unitCostCentavos,
      avgCostAfterCentavos: avgAfter,
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      occurredAt: input.occurredAt,
      orderItemId: input.refs?.orderItemId ?? null,
      purchaseReceiptItemId: input.refs?.purchaseReceiptItemId ?? null,
      returnItemId: input.refs?.returnItemId ?? null,
      adjustmentItemId: input.refs?.adjustmentItemId ?? null,
      transferItemId: input.refs?.transferItemId ?? null,
      recomputeAverage: recompute,
    });
  }

  /**
   * Outbound stock. Consumes at the current average and returns the cost that
   * was snapshotted, which is what the order line stores as its COGS.
   */
  issue(input: {
    variantId: string;
    warehouseId: string;
    qty: number;
    type: Extract<StockMovementType, "SALE" | "TRANSFER_OUT">;
    reason: StockReason;
    occurredAt: Date;
    actorId?: string;
    note?: string;
    refs?: Refs;
    /** Release this many reserved units as part of the same movement. */
    releaseReserved?: number;
  }): { movement: MovementRow; unitCostCentavos: number } {
    const unitCostCentavos = this.getAvgCost(input.variantId);

    if (input.releaseReserved) {
      this.release(input.variantId, input.warehouseId, input.releaseReserved);
    }

    const balanceAfter = this.applyDelta(input.variantId, input.warehouseId, -input.qty);

    const movement = this.push({
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      type: input.type,
      reason: input.reason,
      qtyDelta: -input.qty,
      balanceAfter,
      unitCostCentavos,
      avgCostAfterCentavos: this.getAvgCost(input.variantId),
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      occurredAt: input.occurredAt,
      orderItemId: input.refs?.orderItemId ?? null,
      purchaseReceiptItemId: input.refs?.purchaseReceiptItemId ?? null,
      returnItemId: input.refs?.returnItemId ?? null,
      adjustmentItemId: input.refs?.adjustmentItemId ?? null,
      transferItemId: input.refs?.transferItemId ?? null,
      recomputeAverage: false,
    });

    return { movement, unitCostCentavos };
  }

  /**
   * A signed correction. Stock enters or leaves at the current average, so
   * valuation moves but cost per unit does not.
   */
  adjust(input: {
    variantId: string;
    warehouseId: string;
    qtyDelta: number;
    reason: StockReason;
    occurredAt: Date;
    actorId?: string;
    note?: string;
    refs?: Refs;
  }): MovementRow {
    const balanceAfter = this.applyDelta(input.variantId, input.warehouseId, input.qtyDelta);

    return this.push({
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      type: "ADJUSTMENT",
      reason: input.reason,
      qtyDelta: input.qtyDelta,
      balanceAfter,
      unitCostCentavos: this.getAvgCost(input.variantId),
      avgCostAfterCentavos: this.getAvgCost(input.variantId),
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      occurredAt: input.occurredAt,
      orderItemId: input.refs?.orderItemId ?? null,
      purchaseReceiptItemId: input.refs?.purchaseReceiptItemId ?? null,
      returnItemId: input.refs?.returnItemId ?? null,
      adjustmentItemId: input.refs?.adjustmentItemId ?? null,
      transferItemId: input.refs?.transferItemId ?? null,
      recomputeAverage: false,
    });
  }

  /**
   * Goods came back but are not resaleable. Cost is booked to loss; on-hand is
   * untouched, so `qtyDelta` is zero by design (docs/PLAN.md section 6.2).
   */
  writeOff(input: {
    variantId: string;
    warehouseId: string;
    unitCostCentavos: number;
    occurredAt: Date;
    actorId?: string;
    note?: string;
    refs?: Refs;
  }): MovementRow {
    return this.push({
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      type: "WRITE_OFF",
      reason: "DAMAGE",
      qtyDelta: 0,
      balanceAfter: this.getOnHand(input.variantId, input.warehouseId),
      unitCostCentavos: input.unitCostCentavos,
      avgCostAfterCentavos: this.getAvgCost(input.variantId),
      note: input.note ?? null,
      actorId: input.actorId ?? null,
      occurredAt: input.occurredAt,
      orderItemId: input.refs?.orderItemId ?? null,
      purchaseReceiptItemId: input.refs?.purchaseReceiptItemId ?? null,
      returnItemId: input.refs?.returnItemId ?? null,
      adjustmentItemId: input.refs?.adjustmentItemId ?? null,
      transferItemId: input.refs?.transferItemId ?? null,
      recomputeAverage: false,
    });
  }

  /** Hold stock for an order that is pending payment. */
  reserve(variantId: string, warehouseId: string, qty: number): void {
    if (this.getAvailable(variantId, warehouseId) < qty) {
      throw new InsufficientSeedStock(
        `Cannot reserve ${qty} of ${variantId} at ${warehouseId}: only ${this.getAvailable(variantId, warehouseId)} available.`,
      );
    }
    const key = this.key(variantId, warehouseId);
    this.reserved.set(key, (this.reserved.get(key) ?? 0) + qty);
  }

  /** Give reserved stock back, on cancellation or when a sale consumes it. */
  release(variantId: string, warehouseId: string, qty: number): void {
    const key = this.key(variantId, warehouseId);
    const next = (this.reserved.get(key) ?? 0) - qty;
    this.reserved.set(key, Math.max(0, next));
  }

  /**
   * Replay every movement in date order and recompute `balanceAfter`,
   * `avgCostAfterCentavos` and the COGS each sale captured.
   *
   * This pass is not optional. The builders run by module, not by date: all
   * purchase receipts are generated before any order, and returns after every
   * order. So the numbers captured during generation reflect the order the
   * builders ran, not the order the events actually happened. Replaying in date
   * order is what makes the running balance on the ledger page correct and the
   * COGS snapshot on each order line the average *at the moment of that sale*.
   *
   * `returnItemToOrderItem` lets a restocked return re-enter at the replayed
   * cost of the line it came from, keeping the reversal symmetric.
   *
   * Returns the replayed cost per order item so the caller can back-fill
   * `OrderItem.unitCostCentavos` and `Order.costTotalCentavos`.
   */
  replayChronologically(returnItemToOrderItem: Map<string, string>): {
    costByOrderItem: Map<string, number>;
    finalPositions: Map<string, number>;
    finalAvgCost: Map<string, number>;
  } {
    const ordered = [...this.movements].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.sequence - b.sequence,
    );

    const onHand = new Map<string, number>();
    const totalOnHand = new Map<string, number>();
    const avgCost = new Map<string, number>();
    const costByOrderItem = new Map<string, number>();

    for (const movement of ordered) {
      const key = this.key(movement.variantId, movement.warehouseId);
      const avgBefore = avgCost.get(movement.variantId) ?? 0;
      const totalBefore = totalOnHand.get(movement.variantId) ?? 0;

      if (movement.qtyDelta < 0) {
        // Outbound: snapshot the cost that is leaving.
        movement.unitCostCentavos = avgBefore;
        if (movement.orderItemId) {
          costByOrderItem.set(movement.orderItemId, avgBefore);
        }
      } else if (
        movement.qtyDelta > 0 &&
        (movement.type === "TRANSFER_IN" || movement.type === "ADJUSTMENT")
      ) {
        // Cost neutral inflows arrive at the average of their own moment, not
        // the average the builder happened to see when it generated them.
        movement.unitCostCentavos = avgBefore;
      } else if (movement.type === "WRITE_OFF") {
        // Books the cost of the line it came from; on-hand is untouched.
        const sourceOrderItem = movement.returnItemId
          ? returnItemToOrderItem.get(movement.returnItemId)
          : undefined;
        if (sourceOrderItem) {
          movement.unitCostCentavos =
            costByOrderItem.get(sourceOrderItem) ?? movement.unitCostCentavos;
        }
      } else if (movement.type === "RETURN" && movement.returnItemId) {
        // Re-enters at exactly the cost that left on the original sale.
        const sourceOrderItem = returnItemToOrderItem.get(movement.returnItemId);
        if (sourceOrderItem) {
          movement.unitCostCentavos =
            costByOrderItem.get(sourceOrderItem) ?? movement.unitCostCentavos;
        }
      }

      if (movement.recomputeAverage && movement.qtyDelta > 0) {
        const next = movingAverageCost(
          totalBefore,
          avgBefore,
          movement.qtyDelta,
          movement.unitCostCentavos,
        );
        avgCost.set(movement.variantId, next);
      }

      const balance = (onHand.get(key) ?? 0) + movement.qtyDelta;
      if (balance < 0) {
        throw new InsufficientSeedStock(
          `Chronological replay drove ${movement.variantId} at ${movement.warehouseId} to ${balance} ` +
            `on ${movement.occurredAt.toISOString()} (${movement.type}). Opening stock is too low for the demand generated.`,
        );
      }

      onHand.set(key, balance);
      totalOnHand.set(movement.variantId, totalBefore + movement.qtyDelta);

      movement.balanceAfter = balance;
      movement.avgCostAfterCentavos = avgCost.get(movement.variantId) ?? 0;
    }

    // Adopt the replayed state as the ledger's truth.
    for (const [key, value] of onHand) this.onHand.set(key, value);
    for (const [key, value] of totalOnHand) this.totalOnHand.set(key, value);
    for (const [key, value] of avgCost) this.avgCost.set(key, value);

    return { costByOrderItem, finalPositions: onHand, finalAvgCost: avgCost };
  }
}
