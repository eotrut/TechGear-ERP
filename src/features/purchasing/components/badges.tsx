import type { BillStatus, PurchaseOrderStatus } from "@prisma/client";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import { BILL_STATUS_LABEL, PO_STATUS_LABEL } from "../schemas";
import { AGING_BUCKET_LABEL, type AgingBucket } from "../services/bill-rules";

/**
 * Purchasing status vocabulary, one tone per meaning on every page. Goods on
 * the way read as info, goods in as success, money still owed as warning and
 * money overdue as critical.
 */

const PO_TONE: Record<PurchaseOrderStatus, StatusTone> = {
  DRAFT: "neutral",
  SENT: "info",
  PARTIALLY_RECEIVED: "warning",
  RECEIVED: "success",
  CLOSED: "neutral",
  CANCELLED: "neutral",
};

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <StatusBadge tone={PO_TONE[status]}>{PO_STATUS_LABEL[status]}</StatusBadge>;
}

const BILL_TONE: Record<BillStatus, StatusTone> = {
  DRAFT: "neutral",
  OPEN: "info",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  VOID: "neutral",
};

export function BillStatusBadge({ status }: { status: BillStatus }) {
  return <StatusBadge tone={BILL_TONE[status]}>{BILL_STATUS_LABEL[status]}</StatusBadge>;
}

const AGING_TONE: Record<AgingBucket, StatusTone> = {
  current: "neutral",
  d1_30: "warning",
  d31_60: "critical",
  d61_90: "critical",
  d90_plus: "critical",
};

export function AgingBadge({ bucket }: { bucket: AgingBucket }) {
  return (
    <StatusBadge tone={AGING_TONE[bucket]}>
      {bucket === "current" ? "not due" : AGING_BUCKET_LABEL[bucket].replace(" days", "d")}
    </StatusBadge>
  );
}

/** "3 days late" or "due today", for the expected date of an open PO. */
export function OverdueNote({ days }: { days: number }) {
  if (days <= 0) return null;
  return (
    <span className="block text-caption text-danger" data-numeric>
      {days} day{days === 1 ? "" : "s"} late
    </span>
  );
}
