import type { OrderStatus } from "@prisma/client";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

import { fulfilmentAxis, paymentAxis } from "../services/order-rules";

/**
 * Order vocabulary. The canonical status is one chip; lists read it on two
 * axes instead, payment and fulfilment, the way Shopify's admin does, so Paid
 * and Packed never look like rival ideas. Finished sales are green, work in
 * progress is blue, money going back is red.
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

export function PaymentBadge(props: {
  status: OrderStatus;
  totalCentavos: number;
  amountPaidCentavos: number;
  amountRefundedCentavos: number;
}) {
  const axis = paymentAxis(props);
  return <StatusBadge tone={axis.tone}>{axis.label}</StatusBadge>;
}

export function FulfilmentBadge({ status }: { status: OrderStatus }) {
  const axis = fulfilmentAxis(status);
  return <StatusBadge tone={axis.tone}>{axis.label}</StatusBadge>;
}
