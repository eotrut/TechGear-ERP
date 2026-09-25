import type { PurchaseOrderStatus } from "@prisma/client";

import { DomainError } from "@/lib/errors";
import { assertCentavos } from "@/lib/money";
import { canTransition, type TransitionMap } from "@/lib/transitions";
import { vatOnNet } from "@/lib/vat";

/**
 * Pure purchase order rules, with no database access, so the PO form, the
 * receiving screen, the services and the seed all apply exactly the same
 * arithmetic. docs/PLAN.md section 5.2.
 *
 *   DRAFT              -> SENT, CANCELLED
 *   SENT               -> PARTIALLY_RECEIVED, RECEIVED, CANCELLED
 *   PARTIALLY_RECEIVED -> PARTIALLY_RECEIVED, RECEIVED, CLOSED
 *   RECEIVED           -> CLOSED
 *   CLOSED             -> terminal
 *   CANCELLED          -> terminal
 */

export const PO_TRANSITIONS: TransitionMap<PurchaseOrderStatus> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"],
  RECEIVED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

/** Statuses a delivery can be booked against. */
export const RECEIVABLE_STATUSES: readonly PurchaseOrderStatus[] = ["SENT", "PARTIALLY_RECEIVED"];

/** Statuses with goods on the way, which count toward reorder cover. */
export const OPEN_STATUSES: readonly PurchaseOrderStatus[] = ["SENT", "PARTIALLY_RECEIVED"];

/** Statuses a supplier bill can be raised against: something has arrived. */
export const BILLABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
];

export function isReceivable(status: PurchaseOrderStatus): boolean {
  return RECEIVABLE_STATUSES.includes(status);
}

/**
 * Cancelling is refused once any delivery has been booked, even one that was
 * rejected in full: received goods cannot be un-received, and the correction
 * path is an adjustment or a supplier return.
 */
export function canCancel(status: PurchaseOrderStatus, receiptCount: number): boolean {
  return canTransition(PO_TRANSITIONS, status, "CANCELLED") && receiptCount === 0;
}

/** Closing a partly received PO is a deliberate short-close and needs a reason. */
export function closeNeedsReason(status: PurchaseOrderStatus): boolean {
  return status === "PARTIALLY_RECEIVED";
}

// ------------------------------------------------------------------- pricing

export type PoLineInput = { qty: number; unitCostCentavos: number };

export type PricedPurchaseOrder<L extends PoLineInput = PoLineInput> = {
  lines: (L & { lineTotalCentavos: number })[];
  subtotalCentavos: number;
  shippingCentavos: number;
  vatCentavos: number;
  totalCentavos: number;
};

/**
 * Supplier prices are quoted VAT-exclusive, as Philippine B2B price lists are,
 * so VAT is added on top of goods and freight (decision D-40). Inventory is
 * carried at the net unit cost because the input VAT is claimable.
 */
export function pricePurchaseOrder<L extends PoLineInput>(
  lines: readonly L[],
  shippingCentavos = 0,
): PricedPurchaseOrder<L> {
  if (!Number.isSafeInteger(shippingCentavos) || shippingCentavos < 0) {
    throw new DomainError("Freight cannot be negative.");
  }

  const priced = lines.map((line) => {
    if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
      throw new DomainError(`Order a positive whole quantity, received ${line.qty}.`);
    }
    if (!Number.isSafeInteger(line.unitCostCentavos) || line.unitCostCentavos < 0) {
      throw new DomainError("A unit cost cannot be negative.");
    }
    return { ...line, lineTotalCentavos: assertCentavos(line.qty * line.unitCostCentavos) };
  });

  const subtotalCentavos = assertCentavos(
    priced.reduce((sum, line) => sum + line.lineTotalCentavos, 0),
  );
  const vatCentavos = vatOnNet(subtotalCentavos + shippingCentavos);

  return {
    lines: priced,
    subtotalCentavos,
    shippingCentavos,
    vatCentavos,
    totalCentavos: assertCentavos(subtotalCentavos + shippingCentavos + vatCentavos),
  };
}

// ----------------------------------------------------------------- receiving

export type PoItemPosition = {
  id: string;
  sku: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCostCentavos: number;
};

export function outstandingQty(item: { qtyOrdered: number; qtyReceived: number }): number {
  return Math.max(0, item.qtyOrdered - item.qtyReceived);
}

/**
 * The status a PO lands on after a delivery. Computed, never chosen: every
 * line in full is RECEIVED, anything in is PARTIALLY_RECEIVED, and a delivery
 * rejected in full at the dock leaves the status where it was (null).
 */
export function statusAfterReceipt(
  items: readonly { qtyOrdered: number; qtyReceived: number }[],
): "RECEIVED" | "PARTIALLY_RECEIVED" | null {
  if (items.length > 0 && items.every((item) => item.qtyReceived >= item.qtyOrdered)) {
    return "RECEIVED";
  }
  if (items.some((item) => item.qtyReceived > 0)) return "PARTIALLY_RECEIVED";
  return null;
}

export type ReceiptLineInput = {
  itemId: string;
  /** Good units accepted into stock. */
  qtyReceived: number;
  /** Units refused at the dock. They go back to the supplier and stay outstanding. */
  qtyRejected: number;
  /** The cost on the delivery, which may differ from the PO price. */
  unitCostCentavos: number;
};

export type PlannedReceiptLine = ReceiptLineInput & { sku: string };

export type ReceiptPlan = {
  lines: PlannedReceiptLine[];
  acceptedUnits: number;
  rejectedUnits: number;
  /** Stock value added, at the delivery cost. */
  valueCentavos: number;
};

/**
 * Check a delivery against the PO before anything is written. A line may not
 * bring in more than is still outstanding, counting accepted and rejected
 * units together, because the supplier shipped at most the balance. Lines
 * with nothing on them are dropped.
 */
export function planReceipt(
  items: readonly PoItemPosition[],
  lines: readonly ReceiptLineInput[],
): ReceiptPlan {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const planned: PlannedReceiptLine[] = [];

  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) throw new DomainError("A received line does not belong to this purchase order.");
    if (seen.has(line.itemId)) throw new DomainError(`${item.sku} appears twice on the delivery.`);
    seen.add(line.itemId);

    for (const qty of [line.qtyReceived, line.qtyRejected]) {
      if (!Number.isSafeInteger(qty) || qty < 0) {
        throw new DomainError(`Quantities for ${item.sku} must be whole numbers, zero or more.`);
      }
    }
    if (line.qtyReceived === 0 && line.qtyRejected === 0) continue;

    const outstanding = outstandingQty(item);
    const arrived = line.qtyReceived + line.qtyRejected;
    if (arrived > outstanding) {
      throw new DomainError(
        outstanding === 0
          ? `${item.sku} is already received in full.`
          : `Only ${outstanding} of ${item.sku} are outstanding, so ${arrived} cannot arrive. ` +
              `Record extra units with a count correction instead.`,
      );
    }
    if (line.qtyReceived > 0 && line.unitCostCentavos <= 0) {
      throw new DomainError(`Enter the delivered unit cost for ${item.sku}.`);
    }
    if (!Number.isSafeInteger(line.unitCostCentavos) || line.unitCostCentavos < 0) {
      throw new DomainError(`The unit cost for ${item.sku} cannot be negative.`);
    }

    planned.push({ ...line, sku: item.sku });
  }

  if (planned.length === 0) {
    throw new DomainError("Nothing to receive. Enter what arrived on at least one line.");
  }

  let acceptedUnits = 0;
  let rejectedUnits = 0;
  let valueCentavos = 0;
  for (const line of planned) {
    acceptedUnits += line.qtyReceived;
    rejectedUnits += line.qtyRejected;
    valueCentavos += line.qtyReceived * line.unitCostCentavos;
  }

  return {
    lines: planned,
    acceptedUnits,
    rejectedUnits,
    valueCentavos: assertCentavos(valueCentavos),
  };
}

// --------------------------------------------------------------------- dates

const DAY_MS = 86_400_000;

/** The date a PO is expected: order date plus the supplier's quoted lead time. */
export function expectedDateFor(orderDate: Date, leadTimeDays: number): Date {
  return new Date(orderDate.getTime() + Math.max(0, leadTimeDays) * DAY_MS);
}
