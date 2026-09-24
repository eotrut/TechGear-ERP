import type { Metadata } from "next";
import Link from "next/link";
import { Warehouse } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { TransferForm } from "@/features/inventory/components/transfer-form";
import { variantStockByIds, warehouseOptions } from "@/features/inventory/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New transfer" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewTransferPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("inventory.transfer");
  const params = await searchParams;

  const warehouses = await warehouseOptions();
  const active = warehouses.filter((warehouse) => warehouse.isActive);

  if (active.length < 2) {
    return (
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
        <PageHeader title="New transfer" />
        <EmptyState
          icon={Warehouse}
          title="A transfer needs two active warehouses"
          description="Only one warehouse is active, so there is nowhere to move stock to. Add or reactivate a second one first."
          action={
            can(user.role, "warehouses.manage") ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/warehouses">Manage warehouses</Link>
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  // The alerts page links here with the rebalance already worked out.
  const from =
    active.find((warehouse) => warehouse.id === single(params.from)) ??
    active.find((warehouse) => warehouse.isDefault) ??
    active[0];
  const to =
    active.find((warehouse) => warehouse.id === single(params.to) && warehouse.id !== from?.id) ??
    active.find((warehouse) => warehouse.id !== from?.id);

  const variantId = single(params.variantId);
  const qty = Number(single(params.qty) ?? "1");
  const picks = variantId ? await variantStockByIds([variantId], from?.id) : [];
  const initialLines = picks.map((pick) => ({
    pick,
    qty: Number.isSafeInteger(qty) && qty > 0 ? qty : 1,
  }));

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="New transfer"
        description="Move stock from one warehouse to another. Dispatching takes it out of the source straight away; the destination counts it when someone receives it there."
      />
      <TransferForm
        warehouses={warehouses}
        defaults={{ fromWarehouseId: from?.id ?? "", toWarehouseId: to?.id ?? "" }}
        initialLines={initialLines}
      />
    </div>
  );
}
