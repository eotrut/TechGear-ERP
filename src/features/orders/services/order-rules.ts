import type { OrderStatus, PaymentMethod, SalesChannel } from "@prisma/client";

import { DomainError } from "@/lib/errors";
import { formatPeso, roundHalfAwayFromZero } from "@/lib/money";
import type { Permission } from "@/lib/rbac/matrix";
import type { TransitionMap } from "@/lib/transitions";

import { PAYMENT_METHOD_LABEL, REFERENCE_REQUIRED } from "../schemas";

/**
 * The order lifecycle as data, plus the pure money rules around it: settling
 * a split payment, and working out what a returned unit is worth. No database,
 * so every rule here is unit tested directly. docs/PLAN.md section 5.1.
 */

export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  DRAFT: ["PENDING", "CANCELLED"],
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["PACKED", "CANCELLED", "REFUNDED"],
  PACKED: ["SHIPPED", "CANCELLED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["COMPLETED", "REFUNDED"],
  COMPLETED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * The permission each move needs. Cancelling a paid order also needs
 * `orders.refund`, because it sends money back; the action checks both.
 */
export const TRANSITION_PERMISSION: Record<OrderStatus, Permission> = {
  DRAFT: "orders.create",
  PENDING: "orders.create",
  PAID: "orders.recordPayment",
  PACKED: "orders.fulfil",
  SHIPPED: "orders.fulfil",
  DELIVERED: "orders.fulfil",
  COMPLETED: "orders.complete",
  CANCELLED: "orders.cancel",
  REFUNDED: "orders.refund",
};

/** Stock has physically left the building and the money is in. */
export const REALISED_STATUSES: readonly OrderStatus[] = [
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
];

/** Units are promised to the order but still on the shelf. */
export function holdsReservation(status: OrderStatus): boolean {
  return status === "PENDING";
}

/** Stock left through a SALE movement, so cancelling has to put it back. */
export function hasShipped(status: OrderStatus): boolean {
  return REALISED_STATUSES.includes(status) || status === "REFUNDED";
}

/** Goods the customer has in hand, which is what a return or a claim is raised against. */
export function isWithCustomer(status: OrderStatus): boolean {
  return status === "DELIVERED" || status === "COMPLETED";
}

/** The status a new order starts in. Marketplaces have already taken it. */
export function initialStatusFor(
  channel: SalesChannel,
  intent: "draft" | "place" | "paid",
): "DRAFT" | "PENDING" {
  if (
    intent === "draft" &&
    (channel === "SHOPEE" || channel === "LAZADA" || channel === "TIKTOK")
  ) {
    throw new DomainError("Marketplace orders are already placed, so they start as pending.");
  }
  return intent === "draft" ? "DRAFT" : "PENDING";
}

/**
 * Cancelling. Sales may cancel only their own orders, and only before money
 * has moved (docs/PLAN.md section 3); cancelling after payment is a refund.
 */
export function cancelNeedsRefund(status: OrderStatus): boolean {
  return status === "PAID" || status === "PACKED";
}

// ------------------------------------------------------------ two-axis view

/**
 * Shopify reads an order as two separate facts: has it been paid, and has it
 * been fulfilled. OrderStatus stays the single enum SPEC asks for; these are
 * how a row presents it, so Paid and Packed never look like rival ideas.
 */
export type Tone = "neutral" | "info" | "success" | "warning" | "critical" | "accent";

export type Axis = { label: string; tone: Tone };

export function paymentAxis(order: {
  status: OrderStatus;
  totalCentavos: number;
  amountPaidCentavos: number;
  amountRefundedCentavos: number;
}): Axis {
  const { status, amountPaidCentavos: paid, amountRefundedCentavos: refunded } = order;
  if (status === "DRAFT") return { label: "draft", tone: "neutral" };
  if (status === "PENDING") return { label: "unpaid", tone: "warning" };
  if (status === "CANCELLED") {
    return paid > 0
      ? { label: "refunded", tone: "critical" }
      : { label: "voided", tone: "neutral" };
  }
  if (status === "REFUNDED" || (paid > 0 && refunded >= paid)) {
    return { label: "refunded", tone: "critical" };
  }
  if (refunded > 0) return { label: "partly refunded", tone: "warning" };
  if (order.totalCentavos === 0) return { label: "no charge", tone: "neutral" };
  return { label: "paid", tone: "success" };
}

export function fulfilmentAxis(status: OrderStatus): Axis {
  switch (status) {
    case "DRAFT":
    case "PAID":
      return { label: "unfulfilled", tone: "neutral" };
    case "PENDING":
      return { label: "reserved", tone: "neutral" };
    case "PACKED":
      return { label: "packed", tone: "info" };
    case "SHIPPED":
      return { label: "shipped", tone: "info" };
    case "DELIVERED":
      return { label: "delivered", tone: "success" };
    case "COMPLETED":
      return { label: "fulfilled", tone: "success" };
    case "CANCELLED":
      return { label: "cancelled", tone: "neutral" };
    case "REFUNDED":
      return { label: "returned", tone: "critical" };
  }
}

// ----------------------------------------------------------------- tenders

export type Tender = {
  method: PaymentMethod;
  amountCentavos: number;
  /** Cash only: what was handed over. */
  tenderedCentavos?: number | null;
  reference?: string | null;
};

export type SettledPayment = {
  method: PaymentMethod;
  amountCentavos: number;
  tenderedCentavos: number | null;
  changeCentavos: number | null;
  reference: string | null;
};

export type Settlement = { payments: SettledPayment[]; changeCentavos: number };

/**
 * Check a set of payments against what is due and turn them into Payment
 * rows. A split payment is any number of tenders whose amounts sum to exactly
 * the balance: never short, because an order is paid in full or not at all,
 * and never over, because an overpayment is change, which only cash gives.
 */
export function settleTenders(
  dueCentavos: number,
  tenders: readonly Tender[],
  { channel }: { channel: SalesChannel },
): Settlement {
  if (dueCentavos === 0) {
    if (tenders.length > 0) throw new DomainError("Nothing is due on this order.");
    return { payments: [], changeCentavos: 0 };
  }
  if (tenders.length === 0) throw new DomainError("Add the payment the customer made.");

  const cashCount = tenders.filter((tender) => tender.method === "CASH").length;
  if (cashCount > 1) throw new DomainError("Record cash as one payment.");

  const hasCod = tenders.some((tender) => tender.method === "COD");
  if (hasCod && tenders.length > 1) {
    throw new DomainError("Cash on delivery settles the whole order; it cannot be split.");
  }
  if (hasCod && channel === "POS") {
    throw new DomainError("Cash on delivery is not available at the counter.");
  }

  const payments = tenders.map((tender, index): SettledPayment => {
    const label = PAYMENT_METHOD_LABEL[tender.method];
    if (!Number.isSafeInteger(tender.amountCentavos) || tender.amountCentavos <= 0) {
      throw new DomainError(`Payment ${index + 1} needs an amount above zero.`);
    }
    const reference = tender.reference?.trim() || null;
    if (REFERENCE_REQUIRED.includes(tender.method) && !reference) {
      throw new DomainError(`Add the ${label} reference number, so the payment can be traced.`);
    }

    if (tender.method !== "CASH") {
      if (tender.tenderedCentavos) {
        throw new DomainError(`Only cash gives change; ${label} is charged the exact amount.`);
      }
      return {
        method: tender.method,
        amountCentavos: tender.amountCentavos,
        tenderedCentavos: null,
        changeCentavos: null,
        reference,
      };
    }

    const tendered = tender.tenderedCentavos ?? tender.amountCentavos;
    if (tendered < tender.amountCentavos) {
      throw new DomainError("The cash handed over is less than the cash amount.");
    }
    return {
      method: "CASH",
      amountCentavos: tender.amountCentavos,
      tenderedCentavos: tendered,
      changeCentavos: tendered - tender.amountCentavos,
      reference,
    };
  });

  const paid = payments.reduce((sum, payment) => sum + payment.amountCentavos, 0);
  if (paid !== dueCentavos) {
    const gap = dueCentavos - paid;
    throw new DomainError(
      gap > 0
        ? `The payments come to ${formatPeso(paid)}, ${formatPeso(gap)} short of the ${formatPeso(dueCentavos)} due.`
        : `The payments come to ${formatPeso(paid)}, ${formatPeso(-gap)} more than is due. Record the extra as cash tendered instead.`,
    );
  }

  return {
    payments,
    changeCentavos: payments.reduce((sum, payment) => sum + (payment.changeCentavos ?? 0), 0),
  };
}

// ----------------------------------------------------------------- refunds

/**
 * What returning `returning` units of a line is worth, given `alreadyReturned`
 * went back before. Computed as the difference of two cumulative shares, so
 * returning a line one unit at a time refunds exactly its total, never a
 * centavo more or less, however the line's discount divided.
 */
export function refundForUnits(
  line: { qty: number; lineTotalCentavos: number },
  alreadyReturned: number,
  returning: number,
): number {
  if (returning <= 0) return 0;
  if (alreadyReturned + returning > line.qty) {
    throw new DomainError(
      `Only ${line.qty - alreadyReturned} of that line can still be returned, not ${returning}.`,
    );
  }
  const share = (units: number) =>
    roundHalfAwayFromZero((line.lineTotalCentavos * units) / line.qty);
  return share(alreadyReturned + returning) - share(alreadyReturned);
}

/** What can still go back to the customer on this order. */
export function refundableBalance(order: {
  amountPaidCentavos: number;
  amountRefundedCentavos: number;
}): number {
  return Math.max(0, order.amountPaidCentavos - order.amountRefundedCentavos);
}

export function assertRefundable(
  order: { amountPaidCentavos: number; amountRefundedCentavos: number },
  amountCentavos: number,
): void {
  if (!Number.isSafeInteger(amountCentavos) || amountCentavos <= 0) {
    throw new DomainError("A refund needs an amount above zero.");
  }
  const balance = refundableBalance(order);
  if (amountCentavos > balance) {
    throw new DomainError(
      balance === 0
        ? "Everything paid on this order has already been refunded."
        : `Only ${formatPeso(balance)} is left to refund on this order.`,
    );
  }
}

/**
 * When an order reads as refunded rather than partly refunded (decision
 * D-19): every unit has come back, or every centavo paid has gone back.
 * A partly refunded delivered order is still a delivered order.
 */
export function isFullyRefunded(order: {
  amountPaidCentavos: number;
  amountRefundedCentavos: number;
  items: readonly { qty: number; qtyReturned: number }[];
}): boolean {
  if (order.amountPaidCentavos > 0 && order.amountRefundedCentavos >= order.amountPaidCentavos) {
    return true;
  }
  return order.items.length > 0 && order.items.every((item) => item.qtyReturned >= item.qty);
}
