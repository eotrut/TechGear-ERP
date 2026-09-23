import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { ArchiveProductButton } from "@/features/products/components/archive-product-button";
import { getProductDetail } from "@/features/products/queries";
import { formatDateTime } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { stockHealth } from "@/lib/stock-math";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const product = await getProductDetail(id);
  return { title: product?.name ?? "Product" };
}

const STOCK_TONE: Record<"in" | "low" | "out", StatusTone> = {
  in: "success",
  low: "warning",
  out: "critical",
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-t border-hairline pt-2">
      <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono text-lead text-ink" data-numeric>
        {value}
      </dd>
      {hint ? <p className="text-caption text-ink-subtle">{hint}</p> : null}
    </div>
  );
}

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { user } = await requirePermission("products.view");
  const { id } = await params;

  const product = await getProductDetail(id);
  if (!product) notFound();

  const canSeeCost = can(user.role, "products.viewCost");
  const canEdit = can(user.role, "products.update");
  const canArchive = can(user.role, "products.archive");

  const onHand = product.variants.reduce(
    (total, variant) => total + variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0),
    0,
  );
  const reserved = product.variants.reduce(
    (total, variant) => total + variant.stockLevels.reduce((sum, level) => sum + level.reserved, 0),
    0,
  );
  const inventoryValue = product.variants.reduce(
    (total, variant) =>
      total +
      variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0) * variant.avgCostCentavos,
    0,
  );
  const prices = product.variants.map((variant) => variant.priceCentavos);
  const lowest = prices.length > 0 ? Math.min(...prices) : 0;
  const highest = prices.length > 0 ? Math.max(...prices) : 0;

  const warehouses = [
    ...new Map(
      product.variants
        .flatMap((variant) => variant.stockLevels)
        .map((level) => [level.warehouse.id, level.warehouse]),
    ).values(),
  ].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title={product.name}
        description={product.description}
        actions={
          <>
            {canEdit ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/products/${product.id}/edit`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            ) : null}
            {canArchive ? (
              <ArchiveProductButton
                productId={product.id}
                name={product.name}
                archived={product.status === "ARCHIVED"}
              />
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={product.status === "ACTIVE" ? "success" : "neutral"}>
          {product.status.toLowerCase()}
        </StatusBadge>
        <span className="text-body-sm text-ink-muted">{product.category.name}</span>
        <span className="text-ink-subtle" aria-hidden>
          /
        </span>
        <span className="text-body-sm text-ink-muted">{product.brand.name}</span>
        {product.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-sm border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-subtle"
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          <section>
            <h2 className="mb-2 text-section text-ink">Variants</h2>
            <div className="overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-1">
                    <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      Variant
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      SKU
                    </th>
                    <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase md:table-cell">
                      Barcode
                    </th>
                    <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      Price
                    </th>
                    {canSeeCost ? (
                      <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase lg:table-cell">
                        Avg cost
                      </th>
                    ) : null}
                    {warehouses.map((warehouse) => (
                      <th
                        key={warehouse.id}
                        className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase"
                      >
                        {warehouse.code}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      Stock
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {product.variants.map((variant) => {
                    const variantOnHand = variant.stockLevels.reduce(
                      (sum, level) => sum + level.onHand,
                      0,
                    );
                    const health = stockHealth(variantOnHand, variant.reorderLevel);

                    return (
                      <tr key={variant.id} className="border-b border-hairline last:border-b-0">
                        <td className="px-3 py-2">
                          <span className="text-ink">{variant.optionSummary}</span>
                          {variant.isActive ? null : (
                            <span className="ml-2 text-caption text-ink-subtle">not sellable</span>
                          )}
                          {variant.attributes.length > 0 ? (
                            <span className="block text-caption text-ink-subtle">
                              {variant.attributes
                                .map((attribute) => `${attribute.name}: ${attribute.value}`)
                                .join(", ")}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 font-mono text-[12px] whitespace-nowrap text-ink-muted">
                          {variant.sku}
                        </td>
                        <td className="hidden px-3 py-2 font-mono text-[12px] whitespace-nowrap text-ink-subtle md:table-cell">
                          {variant.barcode ?? "none"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink">
                          {formatAmount(variant.priceCentavos)}
                        </td>
                        {canSeeCost ? (
                          <td className="hidden px-3 py-2 text-right font-mono text-ink-muted lg:table-cell">
                            {formatAmount(variant.avgCostCentavos)}
                          </td>
                        ) : null}
                        {warehouses.map((warehouse) => {
                          const level = variant.stockLevels.find(
                            (candidate) => candidate.warehouse.id === warehouse.id,
                          );
                          return (
                            <td
                              key={warehouse.id}
                              className="px-3 py-2 text-right font-mono text-ink-muted"
                            >
                              {level?.onHand ?? 0}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right">
                          <StatusBadge tone={STOCK_TONE[health]}>
                            {health === "in" ? "in stock" : health === "low" ? "low" : "out"}
                          </StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-caption text-ink-subtle">
              Reorder levels are set per variant on the edit page. Stock itself only ever moves
              through the ledger: receipts, sales, returns, adjustments and transfers.
            </p>
          </section>

          {product.specs.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Specifications</h2>
              <dl className="grid gap-x-6 rounded-lg border border-hairline bg-surface-1 p-4 sm:grid-cols-2">
                {product.specs.map((spec) => (
                  <div
                    key={spec.id}
                    className="flex justify-between gap-4 border-b border-hairline py-1.5 last:border-b-0"
                  >
                    <dt className="text-body-sm text-ink-subtle">{spec.key}</dt>
                    <dd className="text-right text-body-sm text-ink">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-5">
          {product.images.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Images</h2>
              <div className="grid grid-cols-2 gap-2">
                {product.images.map((image, index) => (
                  <div
                    key={image.id}
                    className="relative aspect-square overflow-hidden rounded-md border border-hairline bg-surface-2"
                  >
                    <Image
                      src={image.url}
                      alt={image.alt}
                      fill
                      sizes="(max-width: 1024px) 45vw, 150px"
                      className="object-cover"
                      // The first shot is above the fold on every viewport and
                      // is what the browser measures as the largest paint.
                      priority={index === 0}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 text-section text-ink">Position</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat label="On hand" value={onHand.toLocaleString("en-PH")} />
              <Stat label="Reserved" value={reserved.toLocaleString("en-PH")} />
              <Stat
                label="Price"
                value={formatPeso(lowest)}
                hint={lowest === highest ? undefined : `up to ${formatPeso(highest)}`}
              />
              {canSeeCost ? (
                <Stat label="Value at cost" value={formatPeso(inventoryValue)} />
              ) : null}
              <Stat label="Variants" value={String(product.variants.length)} />
              <Stat
                label="Warranty"
                value={`${product.variants[0]?.warrantyMonths ?? 12} mo`}
                hint="on the first variant"
              />
            </dl>
            <p className="mt-3 text-caption text-ink-subtle">
              Updated {formatDateTime(product.updatedAt)}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
