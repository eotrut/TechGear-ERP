import type { WarrantyClaimStatus } from "@prisma/client";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import { CLAIM_STATUS_LABEL } from "../schemas";

/** Waiting on a decision is amber; a resolution is green; money back is red, as on orders. */
const CLAIM_TONE: Record<WarrantyClaimStatus, StatusTone> = {
  SUBMITTED: "warning",
  UNDER_REVIEW: "warning",
  APPROVED: "info",
  REPLACED: "success",
  REFUNDED: "critical",
  REJECTED: "neutral",
  CLOSED: "neutral",
};

export function ClaimStatusBadge({ status }: { status: WarrantyClaimStatus }) {
  return (
    <StatusBadge tone={CLAIM_TONE[status]}>{CLAIM_STATUS_LABEL[status].toLowerCase()}</StatusBadge>
  );
}
