import type { CustomerSegment, CustomerType, OrderStatus } from "@prisma/client";

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

/**
 * Order status, shown on Customer 360 ahead of the orders module. Finished
 * sales are green, work in progress is blue, money going back is red.
 */
const ORDER_TONE: Record<OrderStatus, StatusTone> = {
  DRAFT: "neutral",
  PENDING: "warning",
  PAID: "info",
  PACKED: "info",
  SHIPPED: "info",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "neutral",
  REFUNDED: "critical",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <StatusBadge tone={ORDER_TONE[status]}>{status.toLowerCase()}</StatusBadge>;
}
