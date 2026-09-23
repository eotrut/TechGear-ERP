import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CategoryManager } from "@/features/taxonomy/components/category-manager";
import { listCategories } from "@/features/taxonomy/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const { user } = await requirePermission("taxonomy.view");
  const categories = await listCategories();

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Categories"
        description="How the catalogue is filed. Order controls where a category sits in the product filters and the POS."
      />

      <CategoryManager
        categories={categories}
        canManage={can(user.role, "taxonomy.manage")}
        canDelete={can(user.role, "taxonomy.delete")}
      />
    </div>
  );
}
