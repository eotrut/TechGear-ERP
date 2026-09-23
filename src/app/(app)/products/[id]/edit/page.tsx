import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ProductForm } from "@/features/products/components/product-form";
import { catalogueOptions, getProductFormValues } from "@/features/products/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductFormValues(id);
  return { title: product ? `Edit ${product.name}` : "Edit product" };
}

export default async function EditProductPage({ params }: { params: Params }) {
  const { user } = await requirePermission("products.update");
  const { id } = await params;

  const [product, { categories, brands }] = await Promise.all([
    getProductFormValues(id),
    catalogueOptions(),
  ]);

  if (!product) notFound();

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title={`Edit ${product.name}`}
        description="Removing a variant archives it rather than deleting it, because orders and stock movements point at it. Costs entered here are the latest cost; the moving average comes from receiving."
      />

      <ProductForm
        mode="edit"
        productId={id}
        defaultValues={product.values}
        categories={categories}
        brands={brands}
        canSeeCost={can(user.role, "products.viewCost")}
      />
    </div>
  );
}
