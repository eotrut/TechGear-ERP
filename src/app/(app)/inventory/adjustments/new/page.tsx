import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { AdjustmentForm } from "@/features/inventory/components/adjustment-form";
import { variantStockByIds, warehouseOptions } from "@/features/inventory/queries";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New adjustment" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewAdjustmentPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission("inventory.adjust");
  const params = await searchParams;

  const warehouses = await warehouseOptions();
  const active = warehouses.filter((warehouse) => warehouse.isActive);
  const requested = active.find((warehouse) => warehouse.id === single(params.warehouseId));
  const warehouseId =
    (requested ?? active.find((warehouse) => warehouse.isDefault) ?? active[0])?.id ?? "";

  // A link from the ledger or the stock list can bring the variant along.
  const variantId = single(params.variantId);
  const initialLines = variantId ? await variantStockByIds([variantId], warehouseId) : [];

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="New adjustment"
        description="Correct stock that has been damaged, lost, stolen, pulled as a sample, or miscounted. The whole adjustment saves or none of it does, and every line lands in the ledger with your reason."
      />
      <AdjustmentForm
        warehouses={warehouses}
        defaultWarehouseId={warehouseId}
        initialLines={initialLines}
      />
    </div>
  );
}
