import type { Prisma, PurchaseOrderStatus } from "@prisma/client";

import { applyMovement, lockVariants } from "@/features/inventory/services/stock";
import { refreshSupplierPerformance } from "@/features/suppliers/services/performance";
import { DomainError, NotFoundError } from "@/lib/errors";
import { parsePesoInput } from "@/lib/money";
import { nextReference } from "@/lib/numbering";
import { assertTransition } from "@/lib/transitions";

import { PO_STATUS_LABEL, type ReceivePoInput } from "../schemas";
import { lockPurchaseOrder } from "./purchase-orders";
import {
  isReceivable,
  PO_TRANSITIONS,
  planReceipt,
  statusAfterReceipt,
  type ReceiptLineInput,
} from "./purchase-rules";

/**
 * Receiving a delivery against a purchase order. The only code that creates
 * RECEIPT movements for a purchase, and so the only purchasing code that moves
 * the moving-average cost (docs/PLAN.md sections 5.2 and 6.3).
 *
 * One transaction, in this order:
 *
 *   1. Lock the PO row. Two people receiving the same PO queue here, and the
 *      second re-reads what is outstanding after the first has committed, so
 *      the same units can never be received twice.
 *   2. Allocate the GRN number (the counter row is the second document lock;
 *      only receiving takes it, always after the PO).
 *   3. Lock every variant being received, in one statement.
 *   4. Write the receipt, then one RECEIPT movement per accepted line through
 *      the stock service, which updates StockLevel and recomputes the average
 *      against total on-hand across every warehouse (decision D-8).
 *   5. Bump each line's qtyReceived and set the computed status.
 *   6. Notify, and refresh the supplier's on-time and defect rates.
 *
 * Rejected units are recorded on the receipt line but move no stock: they go
 * back to the supplier and stay outstanding on the PO.
 */

type Tx = Prisma.TransactionClient;

export type ReceivedLine = {
  sku: string;
  qtyReceived: number;
  qtyRejected: number;
  unitCostCentavos: number;
  avgCostBeforeCentavos: number;
  avgCostAfterCentavos: number;
  balanceAfter: number;
};

export type ReceiptResult = {
  id: string;
  reference: string;
  purchaseOrderId: string;
  poNumber: string;
  warehouseCode: string;
  statusBefore: PurchaseOrderStatus;
  statusAfter: PurchaseOrderStatus;
  acceptedUnits: number;
  rejectedUnits: number;
  valueCentavos: number;
  lines: ReceivedLine[];
};

export async function receivePurchaseOrder(
  tx: Tx,
  input: ReceivePoInput,
  actor: { id: string },
): Promise<ReceiptResult> {
  // 1. Document lock first, then everything is read under it.
  const po = await lockPurchaseOrder(tx, input.purchaseOrderId);
  if (!isReceivable(po.status)) {
    throw new DomainError(
      po.status === "DRAFT"
        ? `${po.poNumber} is still a draft. Send it to the supplier before receiving against it.`
        : `${po.poNumber} is ${PO_STATUS_LABEL[po.status]}, so nothing more can be received against it.`,
    );
  }

  const warehouse = await tx.warehouse.findFirst({
    where: { id: po.warehouseId, deletedAt: null },
    select: { id: true, code: true, isActive: true },
  });
  if (!warehouse) throw new NotFoundError("The receiving warehouse no longer exists.");
  if (!warehouse.isActive) {
    throw new DomainError(`${warehouse.code} is inactive. Reactivate it before receiving into it.`);
  }

  const items = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: po.id },
    select: {
      id: true,
      variantId: true,
      qtyOrdered: true,
      qtyReceived: true,
      unitCostCentavos: true,
      variant: { select: { sku: true } },
    },
    orderBy: { id: "asc" },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));

  const lines: ReceiptLineInput[] = input.lines.map((line) => {
    const cost = parsePesoInput(line.unitCost);
    if (cost === null || cost < 0) throw new DomainError("Enter a valid unit cost on every line.");
    return {
      itemId: line.itemId,
      qtyReceived: line.qtyReceived,
      qtyRejected: line.qtyRejected,
      unitCostCentavos: cost,
    };
  });

  const plan = planReceipt(
    items.map((item) => ({
      id: item.id,
      sku: item.variant.sku,
      qtyOrdered: item.qtyOrdered,
      qtyReceived: item.qtyReceived,
      unitCostCentavos: item.unitCostCentavos,
    })),
    lines,
  );

  // 2. The GRN number.
  const reference = await nextReference(tx, "GRN");

  // 3. Every variant that gains stock, locked together in a fixed order.
  const accepted = plan.lines.filter((line) => line.qtyReceived > 0);
  const locked = await lockVariants(
    tx,
    accepted.map((line) => itemById.get(line.itemId)?.variantId ?? ""),
  );

  const note = input.note.trim();
  const receipt = await tx.purchaseReceipt.create({
    data: {
      reference,
      purchaseOrderId: po.id,
      receivedById: actor.id,
      note: note === "" ? null : note,
    },
    select: { id: true },
  });

  // 4. and 5. One receipt line and, for accepted units, one movement each.
  const received: ReceivedLine[] = [];
  for (const line of plan.lines) {
    const item = itemById.get(line.itemId);
    if (!item) throw new DomainError("A received line does not belong to this purchase order.");

    const receiptItem = await tx.purchaseReceiptItem.create({
      data: {
        receiptId: receipt.id,
        purchaseOrderItemId: item.id,
        qtyReceived: line.qtyReceived,
        qtyRejected: line.qtyRejected,
        unitCostCentavos: line.unitCostCentavos,
      },
      select: { id: true },
    });

    const avgBefore = locked.get(item.variantId)?.avgCostCentavos ?? 0;
    let avgAfter = avgBefore;
    let balanceAfter = 0;

    if (line.qtyReceived > 0) {
      const movement = await applyMovement(tx, {
        variantId: item.variantId,
        warehouseId: warehouse.id,
        type: "RECEIPT",
        reason: "PURCHASE_RECEIPT",
        qtyDelta: line.qtyReceived,
        unitCostCentavos: line.unitCostCentavos,
        note:
          line.qtyRejected > 0
            ? `${reference} on ${po.poNumber}, ${line.qtyRejected} rejected`
            : `${reference} on ${po.poNumber}`,
        actorId: actor.id,
        refs: { purchaseReceiptItemId: receiptItem.id },
      });
      avgAfter = movement.avgCostAfterCentavos;
      balanceAfter = movement.balanceAfter;

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { qtyReceived: { increment: line.qtyReceived } },
        select: { id: true },
      });
      item.qtyReceived += line.qtyReceived;
    }

    received.push({
      sku: line.sku,
      qtyReceived: line.qtyReceived,
      qtyRejected: line.qtyRejected,
      unitCostCentavos: line.unitCostCentavos,
      avgCostBeforeCentavos: avgBefore,
      avgCostAfterCentavos: avgAfter,
      balanceAfter,
    });
  }

  // The status follows from the lines. A delivery rejected in full changes nothing.
  const computed = statusAfterReceipt(items);
  let statusAfter: PurchaseOrderStatus = po.status;
  if (computed) {
    assertTransition(PO_TRANSITIONS, "Purchase order", po.status, computed);
    statusAfter = computed;
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: computed },
      select: { id: true },
    });
  }

  // 6. Tell the people who pay for it, and keep the supplier's scorecard current.
  await tx.notification.create({
    data: {
      targetRole: "MANAGER",
      type: "PO_RECEIVED",
      title: `Stock received: ${reference}`,
      body:
        plan.rejectedUnits > 0
          ? `${plan.acceptedUnits} units in against ${po.poNumber}, ${plan.rejectedUnits} rejected at the dock.`
          : `${plan.acceptedUnits} units in against ${po.poNumber} at ${warehouse.code}.`,
      link: `/purchasing/${po.id}`,
    },
  });
  await refreshSupplierPerformance(tx, po.supplierId);

  return {
    id: receipt.id,
    reference,
    purchaseOrderId: po.id,
    poNumber: po.poNumber,
    warehouseCode: warehouse.code,
    statusBefore: po.status,
    statusAfter,
    acceptedUnits: plan.acceptedUnits,
    rejectedUnits: plan.rejectedUnits,
    valueCentavos: plan.valueCentavos,
    lines: received,
  };
}
