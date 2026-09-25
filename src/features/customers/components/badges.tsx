import type { CustomerSegment, CustomerType } from "@prisma/client";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import { SEGMENT_META } from "../services/segment-rules";

/**
 * Customer vocabulary. VIP is the one segment that earns the accent, because
 * it is the one a person should notice across a table; dormant reads as a
 * warning since it is an action (win them back), not a state to admire.
 */

const SEGMENT_TONE: Record<CustomerSegment, StatusTone> = {
  VIP: "accent",
  REPEAT: "success",
  NEW: "info",
  DORMANT: "warning",
};

export function SegmentBadge({ segment }: { segment: CustomerSegment }) {
  return (
    <StatusBadge tone={SEGMENT_TONE[segment]}>
      <span title={SEGMENT_META[segment].rule}>{SEGMENT_META[segment].label.toLowerCase()}</span>
    </StatusBadge>
  );
}

export function CustomerTypeBadge({ type }: { type: CustomerType }) {
  return <StatusBadge>{type === "BUSINESS" ? "business" : "individual"}</StatusBadge>;
}

/** Order status lives with the orders module; Customer 360 shows the same chip. */
export { OrderStatusBadge } from "@/features/orders/components/badges";
