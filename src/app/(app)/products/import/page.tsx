import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ImportWizard } from "@/features/products/components/import-wizard";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportProductsPage() {
  await requirePermission("products.import");

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Import products"
        description="Upload a price and stock list, see exactly what it would change, then apply it. Nothing is written until the second step."
      />

      <ImportWizard />
    </div>
  );
}
