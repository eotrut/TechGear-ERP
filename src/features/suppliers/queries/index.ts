import { db } from "@/lib/db";

/** Supplier reads. Eight rows today, so the whole directory is fetched once. */

/** Deliveries per supplier, so the directory can tell "no deliveries yet" from 0%. */
export async function deliveryCounts(): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<{ supplierId: string; deliveries: number }[]>`
    SELECT po."supplierId", COUNT(pr.id)::int AS deliveries
    FROM "PurchaseReceipt" pr
    JOIN "PurchaseOrder" po ON po.id = pr."purchaseOrderId"
    GROUP BY po."supplierId"
  `;
  return Object.fromEntries(rows.map((row) => [row.supplierId, row.deliveries]));
}

export async function listSuppliers() {
  const [suppliers, deliveries] = await Promise.all([fetchSuppliers(), deliveryCounts()]);
  return suppliers.map((supplier) => ({ ...supplier, deliveries: deliveries[supplier.id] ?? 0 }));
}

async function fetchSuppliers() {
  return db.supplier.findMany({
    where: { deletedAt: null },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      contactName: true,
      email: true,
      phone: true,
      leadTimeDays: true,
      paymentTerms: true,
      onTimeRateBps: true,
      defectRateBps: true,
      notes: true,
      isActive: true,
      address: { select: { city: true, province: true } },
      _count: { select: { purchaseOrders: true } },
    },
  });
}

export type SupplierRow = Awaited<ReturnType<typeof listSuppliers>>[number];
