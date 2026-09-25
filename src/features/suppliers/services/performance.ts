import type { Prisma } from "@prisma/client";

import { supplierPerformance, type Delivery, type SupplierPerformance } from "./performance-rules";

/**
 * Supplier performance from the database. Every delivery a supplier has made
 * is one goods received note; the rules that turn them into rates live in
 * performance-rules.ts, shared with the seed.
 */

type Tx = Prisma.TransactionClient;

export async function supplierDeliveries(tx: Tx, supplierId: string): Promise<Delivery[]> {
  return tx.$queryRaw<Delivery[]>`
    SELECT pr."receivedAt", po."expectedDate", po."sentAt",
           COALESCE(SUM(pri."qtyReceived"), 0)::int AS "qtyReceived",
           COALESCE(SUM(pri."qtyRejected"), 0)::int AS "qtyRejected"
    FROM "PurchaseReceipt" pr
    JOIN "PurchaseOrder" po ON po.id = pr."purchaseOrderId"
    LEFT JOIN "PurchaseReceiptItem" pri ON pri."receiptId" = pr.id
    WHERE po."supplierId" = ${supplierId}
    GROUP BY pr.id, pr."receivedAt", po."expectedDate", po."sentAt"
    ORDER BY pr."receivedAt"
  `;
}

/**
 * Recompute a supplier's on-time and defect rates and store them on the
 * supplier row, which the directory and the reorder screen read. Called in
 * the same transaction as every receipt, so the rates can never lag the
 * deliveries they describe. A supplier with no deliveries stores zero and the
 * directory shows "no deliveries" from the count, not from the rate.
 */
export async function refreshSupplierPerformance(
  tx: Tx,
  supplierId: string,
): Promise<SupplierPerformance> {
  const performance = supplierPerformance(await supplierDeliveries(tx, supplierId));
  await tx.supplier.update({
    where: { id: supplierId },
    data: {
      onTimeRateBps: performance.onTimeRateBps ?? 0,
      defectRateBps: performance.defectRateBps ?? 0,
    },
    select: { id: true },
  });
  return performance;
}
