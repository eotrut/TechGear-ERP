import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ProductFilters } from "@/features/products/components/product-filters";
import { ProductsTable } from "@/features/products/components/products-table";
import { listProducts, productFilterOptions, PRODUCT_PAGE_SIZE } from "@/features/products/queries";
import { productFiltersSchema } from "@/features/products/schemas";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Products" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("products.view");
  const params = await searchParams;

  // A hand-edited URL should narrow the list or be ignored, never 500. Zod
  // parses what it recognises and the defaults cover the rest.
  const parsed = productFiltersSchema.safeParse({
    search: single(params.search),
    categoryId: single(params.categoryId),
    brandId: single(params.brandId),
    stock: single(params.stock),
    status: single(params.status),
    minPrice: single(params.minPrice),
    maxPrice: single(params.maxPrice),
    sort: single(params.sort),
    dir: single(params.dir),
    page: single(params.page) ?? 1,
  });

  const filters = parsed.success
    ? parsed.data
    : productFiltersSchema.parse({ page: 1, sort: "updated", dir: "desc" });

  const [{ rows, total, page, pageCount }, options] = await Promise.all([
    listProducts(filters),
    productFilterOptions(),
  ]);

  const exportParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const item = single(value);
    if (item && !["page", "sort", "dir"].includes(key)) exportParams.set(key, item);
  }

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Products"
        description="Every product, variant, price and stock position in one list. Filters live in the URL, so a view can be sent to somebody as a link."
      />

      <ProductsTable
        rows={rows}
        total={total}
        page={page}
        pageCount={pageCount}
        pageSize={PRODUCT_PAGE_SIZE}
        sort={filters.sort}
        dir={filters.dir}
        canViewCost={can(user.role, "products.viewCost")}
        canBulkPrice={can(user.role, "products.bulkPrice")}
        toolbar={
          // Keyed because it crosses the server boundary as a prop: React
          // treats a serialised element as a list child and warns without one.
          <ProductFilters
            key="product-filters"
            categories={options.categories}
            brands={options.brands}
            canCreate={can(user.role, "products.create")}
            canImport={can(user.role, "products.import")}
            exportHref={`/api/export/products?${exportParams.toString()}`}
          />
        }
      />
    </div>
  );
}
