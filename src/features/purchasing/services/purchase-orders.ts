import type { Prisma, PurchaseOrderStatus } from "@prisma/client";

import { DomainError, NotFoundError } from "@/lib/errors";
import { parseManilaDate, startOfManilaDay } from "@/lib/format";
import { parsePesoInput } from "@/lib/money";
import { nextReference } from "@/lib/numbering";
import { assertTransition } from "@/lib/transitions";

import type { CancelPoInput, ClosePoInput, PurchaseOrderInput } from "../schemas";
import {
  canCancel,
  closeNeedsReason,
  expectedDateFor,
  outstandingQty,
  PO_TRANSITIONS,
  pricePurchaseOrder,
} from "./purchase-rules";

/**
 * Purchase order lifecycle: draft, send, cancel, close. Receiving lives in
 * receiving.ts because it is the part that moves stock.
 *
 * Every status change starts by locking the PO row and checking the move
 * against PO_TRANSITIONS, so two people acting on the same PO queue on that
 * lock and the second is refused by the map instead of overwriting the first.
 * No `next/headers`, no `auth()`: the actions, the tests and the seed share it.
 */

type Tx = Prisma.TransactionClient;

export type LockedPurchaseOrder = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  warehouseId: string;
  expectedDate: Date | null;
  notes: string | null;
};

/** The document lock. Always taken before any variant lock (docs/PLAN.md D-21). */
export async function lockPurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
): Promise<LockedPurchaseOrder> {
  const [row] = await tx.$queryRaw<LockedPurchaseOrder[]>`
    SELECT id, "poNumber", status, "supplierId", "warehouseId", "expectedDate", notes
    FROM "PurchaseOrder"
    WHERE id = ${purchaseOrderId}
    FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That purchase order does not exist.");
  return row;
}

export function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition;
}

// --------------------------------------------------------------------- save

export type SavedPurchaseOrder = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  created: boolean;
  totalCentavos: number;
  lines: number;
  units: number;
};

/**
 * Create a PO, or rewrite a draft. Only drafts are editable: once a PO has
 * been sent, the supplier is working from it. Costs are the buyer's to set,
 * so they are taken from the input, but every total is recomputed here.
 */
export async function savePurchaseOrder(
  tx: Tx,
  input: PurchaseOrderInput,
  actor: { id: string },
  { now = new Date() }: { now?: Date } = {},
): Promise<SavedPurchaseOrder> {
  const existing = input.id ? await lockPurchaseOrder(tx, input.id) : null;
  if (existing && existing.status !== "DRAFT") {
    throw new DomainError(
      `${existing.poNumber} has been sent, so its lines can no longer change. Cancel it and raise a new one.`,
    );
  }

  const supplier = await tx.supplier.findFirst({
    where: { id: input.supplierId, deletedAt: null },
    select: { id: true, name: true, isActive: true, leadTimeDays: true },
  });
  if (!supplier) throw new NotFoundError("That supplier does not exist.");
  if (!supplier.isActive) {
    throw new DomainError(`${supplier.name} is inactive. Reactivate it before ordering from it.`);
  }

  const warehouse = await tx.warehouse.findFirst({
    where: { id: input.warehouseId, deletedAt: null },
    select: { id: true, code: true, isActive: true },
  });
  if (!warehouse) throw new NotFoundError("That warehouse does not exist.");
  if (!warehouse.isActive) {
    throw new DomainError(`${warehouse.code} is inactive, so it cannot receive a delivery.`);
  }

  const variantIds = input.lines.map((line) => line.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    throw new DomainError("Each variant can appear on only one line of a purchase order.");
  }
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds }, deletedAt: null, product: { deletedAt: null } },
    select: { id: true },
  });
  if (variants.length !== variantIds.length) {
    throw new NotFoundError("One of those product variants is no longer in the catalogue.");
  }

  const lines = input.lines.map((line) => {
    const cost = parsePesoInput(line.unitCost);
    if (cost === null || cost < 0) throw new DomainError("Enter a valid unit cost on every line.");
    return { variantId: line.variantId, qty: line.qty, unitCostCentavos: cost };
  });
  const shipping = input.shipping === "" ? 0 : parsePesoInput(input.shipping);
  if (shipping === null || shipping < 0) throw new DomainError("Enter a valid freight amount.");

  const priced = pricePurchaseOrder(lines, shipping);

  let expectedDate = expectedDateFor(startOfManilaDay(now), supplier.leadTimeDays);
  if (input.expectedDate !== "") {
    const parsed = parseManilaDate(input.expectedDate);
    if (!parsed) throw new DomainError("The expected date is not a valid date.");
    if (parsed < startOfManilaDay(now)) {
      throw new DomainError("The expected date cannot be in the past.");
    }
    expectedDate = parsed;
  }

  const header = {
    supplierId: supplier.id,
    warehouseId: warehouse.id,
    expectedDate,
    subtotalCentavos: priced.subtotalCentavos,
    discountCentavos: 0,
    shippingCentavos: priced.shippingCentavos,
    vatCentavos: priced.vatCentavos,
    totalCentavos: priced.totalCentavos,
    notes: input.notes === "" ? null : input.notes,
  };
  const items = priced.lines.map((line) => ({
    variantId: line.variantId,
    qtyOrdered: line.qty,
    qtyReceived: 0,
    unitCostCentavos: line.unitCostCentavos,
    discountCentavos: 0,
    lineTotalCentavos: line.lineTotalCentavos,
  }));

  let saved: { id: string; poNumber: string };
  if (existing) {
    // A draft has no receipts, so its lines can be replaced wholesale.
    await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existing.id } });
    saved = await tx.purchaseOrder.update({
      where: { id: existing.id },
      data: { ...header, items: { create: items } },
      select: { id: true, poNumber: true },
    });
  } else {
    const poNumber = await nextReference(tx, "PO", now);
    saved = await tx.purchaseOrder.create({
      data: {
        ...header,
        poNumber,
        status: "DRAFT",
        orderDate: now,
        createdById: actor.id,
        items: { create: items },
      },
      select: { id: true, poNumber: true },
    });
  }

  let status: PurchaseOrderStatus = "DRAFT";
  if (input.intent === "send") {
    status = (await sendPurchaseOrder(tx, saved.id, actor)).status;
  }

  return {
    id: saved.id,
    poNumber: saved.poNumber,
    status,
    created: !existing,
    totalCentavos: priced.totalCentavos,
    lines: items.length,
    units: items.reduce((sum, item) => sum + item.qtyOrdered, 0),
  };
}

// --------------------------------------------------------------------- send

/**
 * Send a draft to the supplier. The sender is recorded as the approver: in a
 * shop this size, the manager who presses Send is the one committing the money.
 */
export async function sendPurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  actor: { id: string },
): Promise<{ id: string; poNumber: string; status: "SENT" }> {
  const po = await lockPurchaseOrder(tx, purchaseOrderId);
  assertTransition(PO_TRANSITIONS, "Purchase order", po.status, "SENT");

  const lines = await tx.purchaseOrderItem.count({ where: { purchaseOrderId: po.id } });
  if (lines === 0) throw new DomainError("Add at least one line before sending.");

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: { status: "SENT", sentAt: new Date(), approvedById: actor.id },
    select: { id: true },
  });
  return { id: po.id, poNumber: po.poNumber, status: "SENT" };
}

// ------------------------------------------------------------------- cancel

export async function cancelPurchaseOrder(
  tx: Tx,
  input: CancelPoInput,
): Promise<{ id: string; poNumber: string; from: PurchaseOrderStatus }> {
  const po = await lockPurchaseOrder(tx, input.purchaseOrderId);
  const receipts = await tx.purchaseReceipt.count({ where: { purchaseOrderId: po.id } });

  if (receipts > 0) {
    throw new DomainError(
      `${po.poNumber} already has deliveries booked against it, and received goods cannot be un-received. ` +
        `Close it short instead, and correct stock with an adjustment if needed.`,
    );
  }
  assertTransition(PO_TRANSITIONS, "Purchase order", po.status, "CANCELLED");
  if (!canCancel(po.status, receipts)) {
    throw new DomainError(`${po.poNumber} cannot be cancelled.`);
  }

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      notes: appendNote(po.notes, `Cancelled: ${input.reason}`),
    },
    select: { id: true },
  });
  return { id: po.id, poNumber: po.poNumber, from: po.status };
}

// -------------------------------------------------------------------- close

/**
 * Close a PO. From RECEIVED this is housekeeping. From PARTIALLY_RECEIVED it
 * is a short-close: the balance is no longer expected, stops counting toward
 * reorder cover, and the reason is kept on the PO.
 */
export async function closePurchaseOrder(
  tx: Tx,
  input: ClosePoInput,
): Promise<{ id: string; poNumber: string; from: PurchaseOrderStatus; shortUnits: number }> {
  const po = await lockPurchaseOrder(tx, input.purchaseOrderId);
  assertTransition(PO_TRANSITIONS, "Purchase order", po.status, "CLOSED");

  const reason = input.reason.trim();
  if (closeNeedsReason(po.status) && reason === "") {
    throw new DomainError(
      `${po.poNumber} still has units outstanding. Say why the balance is no longer expected.`,
    );
  }

  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: po.id },
    select: { qtyOrdered: true, qtyReceived: true },
  });
  const shortUnits = items.reduce((sum, item) => sum + outstandingQty(item), 0);

  await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      ...(reason
        ? {
            notes: appendNote(
              po.notes,
              shortUnits > 0
                ? `Closed short by ${shortUnits} units: ${reason}`
                : `Closed: ${reason}`,
            ),
          }
        : {}),
    },
    select: { id: true },
  });
  return { id: po.id, poNumber: po.poNumber, from: po.status, shortUnits };
}
