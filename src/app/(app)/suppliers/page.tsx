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
        description="Who TechGear PH buys from, on what terms and how long they quote. On-time and defect rates are measured from every delivery received, not typed in."
      />

      <SupplierManager
        suppliers={suppliers}
        canManage={can(user.role, "suppliers.manage")}
        canDelete={can(user.role, "suppliers.delete")}
      />
    </div>
  );
}
