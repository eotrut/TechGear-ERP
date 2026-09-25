import type { PaymentMethod, Prisma, ReturnDisposition, ReturnStatus } from "@prisma/client";

import { applyMovement, lockVariants } from "@/features/inventory/services/stock";
import {
  lockOrder,
  recordRefund,
  type Actor,
  type RefundResult,
} from "@/features/orders/services/orders";
import {
  isWithCustomer,
  refundableBalance,
  refundForUnits,
} from "@/features/orders/services/order-rules";
import { DomainError, NotFoundError } from "@/lib/errors";
import { nextReference } from "@/lib/numbering";
import { assertTransition } from "@/lib/transitions";

import { OPEN_RETURN_STATUSES, RETURN_TRANSITIONS, returnableQty } from "./return-rules";

/**
 * Returns (RMA).
 *
 *   REQUESTED -> APPROVED, REJECTED
 *   APPROVED  -> RECEIVED, REJECTED
 *   RECEIVED  -> COMPLETED
 *   REJECTED, COMPLETED -> terminal
 *
 * Only completion moves stock and money (docs/PLAN.md section 5.6). Per line,
 * a RESTOCK disposition writes a RETURN movement at the cost the unit left at,
 * so the reversal is symmetric; a WRITE_OFF writes a zero-quantity WRITE_OFF
 * movement that books that cost to loss without putting a damaged unit back
 * on sale. The refund is the returned units' share of what the customer paid
 * for the line, discounts included.
 *
 * Lock order: the return row, then the order row, then the variants.
 */

type Tx = Prisma.TransactionClient;

export { OPEN_RETURN_STATUSES, RETURN_TRANSITIONS, returnableQty };

type LockedReturn = {
  id: string;
  rmaNumber: string;
  status: ReturnStatus;
  orderId: string;
  warehouseId: string;
  notes: string | null;
};

async function lockReturn(tx: Tx, returnId: string): Promise<LockedReturn> {
  const [row] = await tx.$queryRaw<LockedReturn[]>`
    SELECT id, "rmaNumber", status, "orderId", "warehouseId", notes
    FROM "Return" WHERE id = ${returnId} FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That return does not exist.");
  return row;
}

function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition;
}

/** Units of each order line already spoken for by returns still in flight. */
async function openReturnUnits(tx: Tx, orderId: string, excludeReturnId?: string) {
  const rows = await tx.returnItem.groupBy({
    by: ["orderItemId"],
    where: {
      return: {
        orderId,
        status: { in: [...OPEN_RETURN_STATUSES] },
        ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
      },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((row) => [row.orderItemId, row._sum.qty ?? 0]));
}

// ------------------------------------------------------------------- create

export type CreateReturnInput = {
  orderId: string;
  reason: string;
  notes: string | null;
  lines: { orderItemId: string; qty: number }[];
};

export async function createReturn(
  tx: Tx,
  input: CreateReturnInput,
  actor: Actor,
): Promise<{ id: string; rmaNumber: string; units: number; estimateCentavos: number }> {
  const rmaNumber = await nextReference(tx, "RMA");
  // The order lock keeps two returns from claiming the same unit at once.
  const order = await lockOrder(tx, input.orderId);

  if (!isWithCustomer(order.status)) {
    throw new DomainError(
      `${order.orderNumber} has not been delivered, so there is nothing to return yet. ` +
        (order.status === "PAID" || order.status === "PACKED"
          ? "Cancel it instead; the stock goes straight back on the shelf."
          : ""),
    );
  }
  if (!order.customerId) {
    throw new DomainError(
      `${order.orderNumber} was a walk-in sale with no customer on file, and a return needs one.`,
    );
  }

  const items = await tx.orderItem.findMany({
    where: { orderId: order.id },
    select: { id: true, skuSnapshot: true, qty: true, qtyReturned: true, lineTotalCentavos: true },
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const open = await openReturnUnits(tx, order.id);

  const lines = input.lines.filter((line) => line.qty > 0);
  if (lines.length === 0) throw new DomainError("Choose at least one unit to return.");

  let estimateCentavos = 0;
  const rows = lines.map((line) => {
    const item = byId.get(line.orderItemId);
    if (!item) throw new DomainError("A returned line does not belong to this order.");
    const openUnits = open.get(item.id) ?? 0;
    const allowed = returnableQty(item, openUnits);
    if (line.qty > allowed) {
      throw new DomainError(
        allowed === 0
          ? `${item.skuSnapshot} has nothing left to return on this order.`
          : `Only ${allowed} of ${item.skuSnapshot} can still be returned, not ${line.qty}.`,
      );
    }
    const refund = refundForUnits(item, item.qtyReturned + openUnits, line.qty);
    estimateCentavos += refund;
    return { orderItemId: item.id, qty: line.qty, refundAmountCentavos: refund };
  });

  const created = await tx.return.create({
    data: {
      rmaNumber,
      orderId: order.id,
      customerId: order.customerId,
      warehouseId: order.warehouseId,
      status: "REQUESTED",
      reason: input.reason,
      notes: input.notes,
      createdById: actor.id,
      items: { create: rows },
    },
    select: { id: true },
  });

  return {
    id: created.id,
    rmaNumber,
    units: rows.reduce((sum, row) => sum + row.qty, 0),
    estimateCentavos,
  };
}

// ---------------------------------------------------------------- decisions

export async function decideReturn(
  tx: Tx,
  input: { returnId: string; decision: "APPROVED" | "REJECTED"; note: string },
): Promise<{ rmaNumber: string; from: ReturnStatus }> {
  const record = await lockReturn(tx, input.returnId);
  assertTransition(RETURN_TRANSITIONS, "Return", record.status, input.decision);

  if (input.decision === "REJECTED" && input.note.trim() === "") {
    throw new DomainError("Say why the return is rejected; the customer will ask.");
  }

  await tx.return.update({
    where: { id: record.id },
    data: {
      status: input.decision,
      ...(input.decision === "APPROVED" ? { approvedAt: new Date() } : {}),
      ...(input.note.trim()
        ? {
            notes: appendNote(
              record.notes,
              `${input.decision === "APPROVED" ? "Approved" : "Rejected"}: ${input.note.trim()}`,
            ),
          }
        : {}),
    },
    select: { id: true },
  });
  return { rmaNumber: record.rmaNumber, from: record.status };
}

/**
 * The goods are back in the building. The warehouse inspects each line and
 * decides whether it can be sold again; nothing moves in the ledger until the
 * return is completed.
 */
export async function receiveReturn(
  tx: Tx,
  input: {
    returnId: string;
    lines: { returnItemId: string; disposition: ReturnDisposition; conditionNote: string }[];
  },
): Promise<{ rmaNumber: string; writeOffs: number }> {
  const record = await lockReturn(tx, input.returnId);
  assertTransition(RETURN_TRANSITIONS, "Return", record.status, "RECEIVED");

  const items = await tx.returnItem.findMany({
    where: { returnId: record.id },
    select: { id: true },
  });
  const decided = new Map(input.lines.map((line) => [line.returnItemId, line]));
  for (const item of items) {
    const line = decided.get(item.id);
    if (!line) throw new DomainError("Set a disposition for every returned line.");
    if (line.disposition === "WRITE_OFF" && line.conditionNote.trim() === "") {
      throw new DomainError("Note the damage on anything written off, for the loss report.");
    }
  }

  let writeOffs = 0;
  for (const item of items) {
    const line = decided.get(item.id);
    if (!line) continue;
    if (line.disposition === "WRITE_OFF") writeOffs += 1;
    await tx.returnItem.update({
      where: { id: item.id },
      data: { disposition: line.disposition, conditionNote: line.conditionNote.trim() || null },
      select: { id: true },
    });
  }

  await tx.return.update({
    where: { id: record.id },
    data: { status: "RECEIVED", receivedAt: new Date() },
    select: { id: true },
  });
  return { rmaNumber: record.rmaNumber, writeOffs };
}

// ----------------------------------------------------------------- complete

export type CompleteReturnResult = {
  rmaNumber: string;
  restockedUnits: number;
  writtenOffUnits: number;
  refund: RefundResult | null;
};

export async function completeReturn(
  tx: Tx,
  input: {
    returnId: string;
    method: PaymentMethod;
    reference: string;
    refundShipping: boolean;
  },
  actor: Actor,
): Promise<CompleteReturnResult> {
  const record = await lockReturn(tx, input.returnId);
  assertTransition(RETURN_TRANSITIONS, "Return", record.status, "COMPLETED");
  const order = await lockOrder(tx, record.orderId);

  const items = await tx.returnItem.findMany({
    where: { returnId: record.id },
    orderBy: { id: "asc" },
    select: {
      id: true,
      qty: true,
      disposition: true,
      orderItem: {
        select: {
          id: true,
          variantId: true,
          skuSnapshot: true,
          qty: true,
          qtyReturned: true,
          lineTotalCentavos: true,
          unitCostCentavos: true,
        },
      },
    },
  });

  await lockVariants(
    tx,
    items.map((item) => item.orderItem.variantId),
  );

  let restockedUnits = 0;
  let writtenOffUnits = 0;
  let refundCentavos = 0;

  for (const item of items) {
    const line = item.orderItem;
    if (line.qtyReturned + item.qty > line.qty) {
      throw new DomainError(`${line.skuSnapshot} would be returned more times than it was sold.`);
    }
    const refund = refundForUnits(line, line.qtyReturned, item.qty);
    refundCentavos += refund;

    if (item.disposition === "RESTOCK") {
      await applyMovement(tx, {
        variantId: line.variantId,
        warehouseId: record.warehouseId,
        type: "RETURN",
        reason: "CUSTOMER_RETURN",
        qtyDelta: item.qty,
        unitCostCentavos: line.unitCostCentavos,
        note: `Restocked from ${record.rmaNumber}`,
        actorId: actor.id,
        refs: { returnItemId: item.id },
      });
      restockedUnits += item.qty;
    } else {
      // A write-off moves no unit, so its quantity is zero and the row's cost
      // is the loss. One row per unit keeps "unit cost" meaning one unit.
      for (let unit = 1; unit <= item.qty; unit += 1) {
        await applyMovement(tx, {
          variantId: line.variantId,
          warehouseId: record.warehouseId,
          type: "WRITE_OFF",
          reason: "DAMAGE",
          qtyDelta: 0,
          unitCostCentavos: line.unitCostCentavos,
          note: `Returned damaged on ${record.rmaNumber}, written off to loss`,
          actorId: actor.id,
          refs: { returnItemId: item.id },
        });
      }
      writtenOffUnits += item.qty;
    }

    await tx.orderItem.update({
      where: { id: line.id },
      data: { qtyReturned: { increment: item.qty } },
      select: { id: true },
    });
    await tx.returnItem.update({
      where: { id: item.id },
      data: { refundAmountCentavos: refund },
      select: { id: true },
    });
  }

  if (input.refundShipping) {
    const already = await tx.return.count({
      where: { orderId: order.id, status: "COMPLETED", id: { not: record.id } },
    });
    // Shipping is refunded once per order, with the first return that asks.
    if (already === 0) {
      const shipping = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { shippingCentavos: true },
      });
      refundCentavos += shipping.shippingCentavos;
    }
  }

  // An earlier goodwill refund may already have covered part of it.
  const amount = Math.min(refundCentavos, refundableBalance(order));

  let refund: RefundResult | null = null;
  if (amount > 0) {
    refund = await recordRefund(
      tx,
      {
        orderId: order.id,
        amountCentavos: amount,
        method: input.method,
        reason: `Return ${record.rmaNumber}`,
        reference: input.reference,
        returnId: record.id,
      },
      actor,
    );
  }

  await tx.return.update({
    where: { id: record.id },
    data: { status: "COMPLETED", completedAt: new Date() },
    select: { id: true },
  });

  return { rmaNumber: record.rmaNumber, restockedUnits, writtenOffUnits, refund };
}
