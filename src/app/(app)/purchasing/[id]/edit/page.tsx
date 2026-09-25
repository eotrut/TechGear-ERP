import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { warehouseOptions } from "@/features/inventory/queries";
import { PoForm } from "@/features/purchasing/components/po-form";
import {
  getPurchaseOrder,
  purchasableByIds,
  reorderIdsBySupplier,
  supplierOptions,
} from "@/features/purchasing/queries";
import { manilaDayKey } from "@/lib/format";
import { toPesoInput } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Edit purchase order" };

/** Only drafts are editable; anything else goes back to the PO itself. */
export default async function EditPurchaseOrderPage({ params }: { params: Params }) {
  const { user } = await requirePermission("purchasing.manage");
  const { id } = await params;

  const po = await getPurchaseOrder(id, { withBills: false });
  if (!po) notFound();
  if (po.status !== "DRAFT") redirect(`/purchasing/${po.id}`);

  const [suppliers, warehouses, reorderIds, picks] = await Promise.all([
    supplierOptions(),
    warehouseOptions(),
    reorderIdsBySupplier(),
    purchasableByIds(
      po.items.map((item) => item.variantId),
      po.warehouse.id,
    ),
  ]);
  const pickById = new Map(picks.map((pick) => [pick.id, pick]));

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title={`Edit ${po.poNumber}`}
        description="A draft can change freely. Once it is sent, the supplier is working from it and the lines are fixed."
      />
      <PoForm
        suppliers={suppliers}
        warehouses={warehouses}
        reorderIds={reorderIds}
        canSend={can(user.role, "purchasing.send")}
        now={new Date().toISOString()}
        initial={{
          id: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplier.id,
          warehouseId: po.warehouse.id,
          // A draft left sitting past its date starts again from the lead time.
          expectedDate:
            po.expectedDate && manilaDayKey(po.expectedDate) >= manilaDayKey(new Date())
              ? manilaDayKey(po.expectedDate)
              : "",
          shipping: po.shippingCentavos > 0 ? toPesoInput(po.shippingCentavos) : "",
          notes: po.notes ?? "",
          lines: po.items.flatMap((item) => {
            const pick = pickById.get(item.variantId);
            return pick
              ? [{ pick, qty: item.qtyOrdered, unitCost: toPesoInput(item.unitCostCentavos) }]
              : [];
          }),
        }}
      />
    </div>
  );
}
