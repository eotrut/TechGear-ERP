import type { WarrantyClaimStatus } from "@prisma/client";
import { z } from "zod";

import { PAYMENT_METHODS } from "@/features/orders/schemas";
import { pageParam, requiredId, text } from "@/lib/validation";

/** Warranty claim schemas. */

export const CLAIM_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REPLACED",
  "REFUNDED",
  "REJECTED",
  "CLOSED",
] as const satisfies readonly WarrantyClaimStatus[];

export const CLAIM_STATUS_LABEL: Record<WarrantyClaimStatus, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  APPROVED: "Approved",
  REPLACED: "Replaced",
  REFUNDED: "Refunded",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

export const createClaimSchema = z.object({
  orderItemId: requiredId("Choose the item the claim is for."),
  issueDescription: text(2000, {
    min: 10,
    required: "Describe the fault as the customer reported it.",
  }),
  serialNumber: text(60),
});

export type CreateClaimValues = z.infer<typeof createClaimSchema>;

/** Review moves. Replacement and refund have their own schemas, since they do more. */
export const CLAIM_REVIEW_TARGETS = ["UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"] as const;

export const claimReviewSchema = z.object({
  claimId: requiredId("Missing claim."),
  to: z.enum(CLAIM_REVIEW_TARGETS),
  note: text(1000),
});

export const claimReplaceSchema = z.object({
  claimId: requiredId("Missing claim."),
  warehouseId: requiredId("Choose the warehouse the replacement ships from."),
  note: text(1000),
});

export const claimRefundSchema = z.object({
  claimId: requiredId("Missing claim."),
  method: z.enum(PAYMENT_METHODS),
  reference: text(60),
  note: text(1000),
});

export const CLAIM_VIEWS = ["open", "review", "approved", "resolved", "all"] as const;
export type ClaimView = (typeof CLAIM_VIEWS)[number];

export const claimFiltersSchema = z.object({
  view: z.enum(CLAIM_VIEWS).catch("open"),
  search: z.string().trim().max(80).optional().catch(undefined),
  page: pageParam,
});

export type ClaimFilters = z.infer<typeof claimFiltersSchema>;
