import type { ReturnStatus } from "@prisma/client";

import type { TransitionMap } from "@/lib/transitions";

/**
 * Return (RMA) rules with no database access. docs/PLAN.md section 5.6.
 *
 *   REQUESTED -> APPROVED, REJECTED
 *   APPROVED  -> RECEIVED, REJECTED
 *   RECEIVED  -> COMPLETED
 *   REJECTED, COMPLETED -> terminal
 */
export const RETURN_TRANSITIONS: TransitionMap<ReturnStatus> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["RECEIVED", "REJECTED"],
  RECEIVED: ["COMPLETED"],
  REJECTED: [],
  COMPLETED: [],
};

/** Returns still in flight hold their units, so two cannot claim the same one. */
export const OPEN_RETURN_STATUSES: readonly ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED"];

/** What is still returnable on a line: sold, less returned, less already in a return. */
export function returnableQty(
  item: { qty: number; qtyReturned: number },
  openUnits: number,
): number {
  return Math.max(0, item.qty - item.qtyReturned - openUnits);
}
