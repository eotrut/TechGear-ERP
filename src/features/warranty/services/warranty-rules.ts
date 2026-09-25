import type { WarrantyClaimStatus } from "@prisma/client";

import type { TransitionMap } from "@/lib/transitions";

/**
 * Warranty claim rules with no database access, so the claim page can offer
 * exactly the moves the service will accept. docs/PLAN.md section 5.5.
 *
 *   SUBMITTED    -> UNDER_REVIEW, REJECTED
 *   UNDER_REVIEW -> APPROVED, REJECTED
 *   APPROVED     -> REPLACED, REFUNDED
 *   REJECTED     -> CLOSED, UNDER_REVIEW   (the appeal)
 *   REPLACED     -> CLOSED
 *   REFUNDED     -> CLOSED
 *   CLOSED       -> terminal
 */
export const WARRANTY_TRANSITIONS: TransitionMap<WarrantyClaimStatus> = {
  SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["REPLACED", "REFUNDED"],
  REJECTED: ["CLOSED", "UNDER_REVIEW"],
  REPLACED: ["CLOSED"],
  REFUNDED: ["CLOSED"],
  CLOSED: [],
};

/** Claims still holding a unit, so two cannot be raised against the same one. */
export const OPEN_CLAIM_STATUSES: readonly WarrantyClaimStatus[] = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
];

/** Coverage runs whole calendar months from delivery, as a customer reads a warranty card. */
export function warrantyExpiry(deliveredAt: Date, months: number): Date {
  const expiry = new Date(deliveredAt);
  const day = expiry.getUTCDate();
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  // 31 January plus one month is the last day of February, not 3 March.
  const lastDay = new Date(
    Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0),
  ).getUTCDate();
  expiry.setUTCDate(Math.min(day, lastDay));
  return expiry;
}
