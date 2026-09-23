import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { BrandManager } from "@/features/taxonomy/components/brand-manager";
import { listBrands } from "@/features/taxonomy/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Brands" };

export default async function BrandsPage() {
  const { user } = await requirePermission("taxonomy.view");
  const brands = await listBrands();

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Brands"
        description="Every brand TechGear PH carries. A brand can only be deleted once nothing points at it."
      />

      <BrandManager
        brands={brands}
        canManage={can(user.role, "taxonomy.manage")}
        canDelete={can(user.role, "taxonomy.delete")}
      />
    </div>
  );
}
