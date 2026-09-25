import type { ReturnDisposition, ReturnStatus } from "@prisma/client";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import { DISPOSITION_LABEL, RETURN_STATUS_LABEL } from "../schemas";

/** Waiting on someone is amber; done is green; refused is grey, not red, since it is a decision. */
const RETURN_TONE: Record<ReturnStatus, StatusTone> = {
  REQUESTED: "warning",
  APPROVED: "info",
  RECEIVED: "info",
  COMPLETED: "success",
  REJECTED: "neutral",
};

export function ReturnStatusBadge({ status }: { status: ReturnStatus }) {
  return (
    <StatusBadge tone={RETURN_TONE[status]}>
      {RETURN_STATUS_LABEL[status].toLowerCase()}
    </StatusBadge>
  );
}

export function DispositionBadge({ disposition }: { disposition: ReturnDisposition }) {
  return (
    <StatusBadge tone={disposition === "RESTOCK" ? "success" : "critical"}>
      {DISPOSITION_LABEL[disposition].toLowerCase()}
    </StatusBadge>
  );
}
