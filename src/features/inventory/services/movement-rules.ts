import type { StockMovementType, StockReason } from "@prisma/client";

import { DomainError } from "@/lib/errors";

import { ADJUSTMENT_REASON_META, ADJUSTMENT_REASONS, type AdjustmentReason } from "../schemas";

/**
 * The movement table from docs/PLAN.md section 6.2, as data.
 *
 * Every movement the stock service writes is checked against this first, so a
 * caller cannot record a positive sale, a receipt without a cost, or a damage
 * adjustment that adds stock. Pure: no database, safe to unit test directly.
 */

export type MovementDirection = "in" | "out" | "signed" | "none";

export type MovementRule = {
  /** Sign `qtyDelta` must have. "none" means exactly zero. */
  direction: MovementDirection;
  /** Whether this movement moves the variant's moving-average cost. */
  recomputesAverage: boolean;
  /**
   * Where the movement's unit cost comes from. "supplied" means the caller
   * passes it (the invoice cost, or the original sale's snapshot); "average"
   * means stock enters or leaves at the current moving average.
   */
  cost: "supplied" | "average";
  /** Reasons that make sense for this type. */
  reasons: readonly StockReason[];
};

export const MOVEMENT_RULES: Readonly<Record<StockMovementType, MovementRule>> = {
  RECEIPT: {
    direction: "in",
    recomputesAverage: true,
    cost: "supplied",
    reasons: ["PURCHASE_RECEIPT", "OPENING_BALANCE"],
  },
  SALE: {
    direction: "out",
    recomputesAverage: false,
    cost: "average",
    reasons: ["CUSTOMER_SALE", "WARRANTY_REPLACEMENT"],
  },
  RETURN: {
    // Re-enters at the cost that left on the original sale, and re-weights the
    // average, so the reversal is symmetric.
    direction: "in",
    recomputesAverage: true,
    cost: "supplied",
    reasons: ["CUSTOMER_RETURN"],
  },
  ADJUSTMENT: {
    direction: "signed",
    recomputesAverage: false,
    cost: "average",
    reasons: ADJUSTMENT_REASONS,
  },
  TRANSFER_OUT: {
    direction: "out",
    recomputesAverage: false,
    cost: "average",
    reasons: ["TRANSFER"],
  },
  TRANSFER_IN: {
    // One global average per variant (decision D-8) makes a transfer cost
    // neutral by construction: the units arrive at the cost they left at.
    direction: "in",
    recomputesAverage: false,
    cost: "average",
    reasons: ["TRANSFER"],
  },
  WRITE_OFF: {
    // Books the cost of a returned unit to loss without restocking it.
    direction: "none",
    recomputesAverage: false,
    cost: "supplied",
    reasons: ["DAMAGE", "LOSS", "OTHER"],
  },
};

export type MovementShape = {
  type: StockMovementType;
  reason: StockReason;
  qtyDelta: number;
  unitCostCentavos?: number;
  fromReserved?: boolean;
};

/** Reject a movement that contradicts its own type before any row is touched. */
export function assertMovementShape(movement: MovementShape): void {
  const rule = MOVEMENT_RULES[movement.type];
  const { qtyDelta } = movement;

  if (!Number.isSafeInteger(qtyDelta)) {
    throw new DomainError(`Stock quantities are whole units, received ${qtyDelta}.`);
  }

  const signOk =
    (rule.direction === "in" && qtyDelta > 0) ||
    (rule.direction === "out" && qtyDelta < 0) ||
    (rule.direction === "signed" && qtyDelta !== 0) ||
    (rule.direction === "none" && qtyDelta === 0);

  if (!signOk) {
    const expected = {
      in: "a positive quantity",
      out: "a negative quantity",
      signed: "a non-zero quantity",
      none: "a quantity of zero",
    }[rule.direction];
    throw new DomainError(`A ${movement.type} movement needs ${expected}, received ${qtyDelta}.`);
  }

  if (!rule.reasons.includes(movement.reason)) {
    throw new DomainError(`${movement.reason} is not a valid reason for a ${movement.type}.`);
  }

  if (rule.cost === "supplied") {
    const cost = movement.unitCostCentavos;
    if (cost === undefined || !Number.isSafeInteger(cost) || cost < 0) {
      throw new DomainError(`A ${movement.type} movement must carry a unit cost in centavos.`);
    }
  }

  if (movement.fromReserved && movement.type !== "SALE") {
    throw new DomainError("Only a sale can consume reserved stock.");
  }

  if (movement.type === "ADJUSTMENT") {
    assertAdjustmentDirection(movement.reason as AdjustmentReason, qtyDelta);
  }
}

/** Damage, loss, theft and samples only ever take stock away. */
export function assertAdjustmentDirection(reason: AdjustmentReason, qtyDelta: number): void {
  const meta = ADJUSTMENT_REASON_META[reason];
  if (meta.direction === "decrease" && qtyDelta > 0) {
    throw new DomainError(
      `${meta.label} can only remove stock. Choose Count correction to record found units.`,
    );
  }
}

// ---------------------------------------------------------------- adjustment

export type Position = { onHand: number; reserved: number };

export type ResolvedLine = { qtyDelta: number; countedQty: number | null };

/**
 * Turn an adjustment line into the change it makes, against the position read
 * under the row lock.
 *
 * A count is the more honest input for a cycle count: the person records what
 * is on the shelf, and the change is computed here from the live position
 * rather than from whatever the page showed when it loaded.
 *
 * Reserved units are promised to pending orders, so no line may take the
 * position below them. The database CHECK would refuse it anyway; this names
 * the SKU and the reason instead.
 */
export function resolveAdjustmentLine(
  line: { mode: "delta" | "count"; quantity: number },
  position: Position,
  sku: string,
): ResolvedLine {
  if (line.mode === "count") {
    if (line.quantity < position.reserved) {
      throw new DomainError(
        `Counted ${line.quantity} of ${sku}, but ${position.reserved} are reserved for pending orders. ` +
          `Resolve those orders before recording a count below them.`,
      );
    }
    return { qtyDelta: line.quantity - position.onHand, countedQty: line.quantity };
  }

  const available = position.onHand - position.reserved;
  if (line.quantity < 0 && -line.quantity > available) {
    throw new DomainError(
      `${sku} has ${available} available to adjust, so ${-line.quantity} cannot be removed` +
        (position.reserved > 0
          ? ` (${position.reserved} more are reserved for pending orders).`
          : "."),
    );
  }
  return { qtyDelta: line.quantity, countedQty: null };
}

// -------------------------------------------------------------------- alerts

export type StockAlert = "OUT_OF_STOCK" | "LOW_STOCK";

/**
 * Did this change cross an alert threshold? Only a crossing raises an alert,
 * so the tenth sale below the reorder point does not send a tenth
 * notification. Measured on available stock, because that is what can be sold.
 */
export function stockAlertCrossing(
  availableBefore: number,
  availableAfter: number,
  reorderLevel: number,
): StockAlert | null {
  if (availableAfter <= 0 && availableBefore > 0) return "OUT_OF_STOCK";
  if (reorderLevel > 0 && availableAfter <= reorderLevel && availableBefore > reorderLevel) {
    return "LOW_STOCK";
  }
  return null;
}
