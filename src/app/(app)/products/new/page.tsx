import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ProductForm } from "@/features/products/components/product-form";
import { emptyProduct } from "@/features/products/schemas/defaults";
import { catalogueOptions } from "@/features/products/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const { user } = await requirePermission("products.create");
  const { categories, brands } = await catalogueOptions();

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="New product"
        description="A product is created as a draft with at least one variant. Nothing appears in the POS until the status is active and the variant is sellable."
      />

      <ProductForm
        mode="create"
        defaultValues={{
          ...emptyProduct,
          categoryId: categories[0]?.id ?? "",
          brandId: brands[0]?.id ?? "",
        }}
        categories={categories}
        brands={brands}
        canSeeCost={can(user.role, "products.viewCost")}
      />
    </div>
  );
}
