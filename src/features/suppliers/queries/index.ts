import { db } from "@/lib/db";

/** Supplier reads. Eight rows today, so the whole directory is fetched once. */

export async function listSuppliers() {
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
