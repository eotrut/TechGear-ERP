import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { warehouseOptions } from "@/features/inventory/queries";
import { PoForm, type PoFormLine } from "@/features/purchasing/components/po-form";
import {
  purchasableByIds,
  reorderIdsBySupplier,
  reorderPicks,
  supplierOptions,
} from "@/features/purchasing/queries";
import { toPesoInput } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New purchase order" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * New PO. Links can prefill it: `?supplierId=` picks the supplier,
 * `&reorder=1` drops in that supplier's reorder suggestions, and
 * `?variantId=` starts from one item (the product page and alerts use it).
 */
export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { user } = await requirePermission("purchasing.manage");
  const params = await searchParams;

  const [suppliers, warehouses, reorderIds] = await Promise.all([
    supplierOptions(),
    warehouseOptions(),
    reorderIdsBySupplier(),
  ]);

  const requestedSupplier = single(params.supplierId) ?? "";
  const supplierId = suppliers.some((s) => s.id === requestedSupplier && s.isActive)
    ? requestedSupplier
    : "";
  const warehouseId =
    warehouses.find((warehouse) => warehouse.isDefault && warehouse.isActive)?.id ??
    warehouses.find((warehouse) => warehouse.isActive)?.id ??
    "";

  let lines: PoFormLine[] = [];
  if (single(params.reorder) === "1" && supplierId) {
    lines = (await reorderPicks(supplierId, warehouseId)).map((line) => ({
      pick: line.pick,
      qty: line.qty,
      unitCost: toPesoInput(line.pick.unitCostCentavos),
    }));
  } else if (single(params.variantId)) {
    lines = (await purchasableByIds([single(params.variantId) ?? ""], warehouseId)).map((pick) => ({
      pick,
      qty: 1,
      unitCost: toPesoInput(pick.unitCostCentavos),
    }));
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title="New purchase order"
        description="Save a draft to finish later, or send it to the supplier now. Nothing moves in stock until a delivery is received against it."
      />
      <PoForm
        suppliers={suppliers}
        warehouses={warehouses}
        reorderIds={reorderIds}
        canSend={can(user.role, "purchasing.send")}
        now={new Date().toISOString()}
        initial={{
          supplierId,
          warehouseId,
          expectedDate: "",
          shipping: "",
          notes: "",
          lines,
        }}
      />
    </div>
  );
}
