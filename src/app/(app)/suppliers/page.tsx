import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { SupplierManager } from "@/features/suppliers/components/supplier-manager";
import { listSuppliers } from "@/features/suppliers/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const { user } = await requirePermission("suppliers.view");
  const suppliers = await listSuppliers();

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Suppliers"
        description="Who TechGear PH buys from, how long they take and how they have performed. Purchase orders draw their lead time and terms from here."
      />

      <SupplierManager
        suppliers={suppliers}
        canManage={can(user.role, "suppliers.manage")}
        canDelete={can(user.role, "suppliers.delete")}
      />
    </div>
  );
}
