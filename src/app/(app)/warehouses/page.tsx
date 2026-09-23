import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { WarehouseManager } from "@/features/warehouses/components/warehouse-manager";
import { listWarehouses } from "@/features/warehouses/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Warehouses" };

export default async function WarehousesPage() {
  const { user } = await requirePermission("warehouses.view");
  const warehouses = await listWarehouses();

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Warehouses"
        description="Where stock sits. Every movement in the ledger names one of these, so warehouses are deactivated rather than deleted."
      />

      <WarehouseManager warehouses={warehouses} canManage={can(user.role, "warehouses.manage")} />
    </div>
  );
}
