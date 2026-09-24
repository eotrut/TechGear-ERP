import type { Metadata } from "next";
import Link from "next/link";
import { X } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StockStatusBadge } from "@/features/inventory/components/badges";
import { LedgerTable } from "@/features/inventory/components/ledger-table";
import { ListFilters } from "@/components/data-table/list-filters";
import {
  LEDGER_PAGE_SIZE,
  ledgerVariant,
  listLedger,
  warehouseOptions,
} from "@/features/inventory/queries";
import {
  ledgerFiltersSchema,
  MOVEMENT_TYPE_LABEL,
  MOVEMENT_TYPES,
} from "@/features/inventory/schemas";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { stockHealth } from "@/lib/stock-math";

export const metadata: Metadata = { title: "Stock ledger" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("inventory.viewLedger");
  const params = await searchParams;

  const filters = ledgerFiltersSchema.parse({
    search: single(params.search),
    variantId: single(params.variantId),
    warehouseId: single(params.warehouseId),
    type: single(params.type),
    from: single(params.from),
    to: single(params.to),
    page: single(params.page),
  });

  const withCost = can(user.role, "products.viewCost");

  const [ledger, warehouses, variant] = await Promise.all([
    listLedger(filters, { withCost }),
    warehouseOptions(),
    filters.variantId ? ledgerVariant(filters.variantId) : Promise.resolve(null),
  ]);

  const filtered = Boolean(
    filters.search ||
    filters.variantId ||
    filters.warehouseId ||
    filters.type ||
    filters.from ||
    filters.to,
  );

  const clearVariant = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const item = single(value);
    if (item && key !== "variantId" && key !== "page") clearVariant.set(key, item);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Stock ledger"
        description="Every movement of stock, append-only. Nothing here is ever edited or deleted: a correction is a new movement, so the balance column always reads as a running total."
      />

      {variant ? (
        <section
          aria-label="Variant"
          className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-4 md:flex-row md:items-start md:justify-between"
        >
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
              Showing one variant
            </p>
            <Link
              href={`/products/${variant.product.id}`}
              className="mt-0.5 block truncate text-lead font-medium text-ink hover:text-accent-strong"
            >
              {variant.product.name}
            </Link>
            <p className="truncate text-body-sm text-ink-subtle">
              {variant.optionSummary} <span className="font-mono text-[12px]">{variant.sku}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            {variant.stockLevels.map((level) => {
              const available = level.onHand - level.reserved;
              return (
                <div key={level.warehouse.id} className="min-w-24">
                  <p className="font-mono text-[11px] text-ink-subtle">{level.warehouse.code}</p>
                  <p className="font-mono text-lead text-ink" data-numeric>
                    {available.toLocaleString("en-PH")}
                    <span className="ml-1 text-caption text-ink-subtle">available</span>
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    <StockStatusBadge status={stockHealth(available, variant.reorderLevel)} />
                    {level.reserved > 0 ? (
                      <span className="text-caption text-ink-subtle" data-numeric>
                        {level.reserved} reserved
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
            <Button asChild variant="ghost" size="sm">
              <Link
                href={
                  clearVariant.toString() === ""
                    ? "/inventory/ledger"
                    : `/inventory/ledger?${clearVariant.toString()}`
                }
              >
                <X aria-hidden />
                All variants
              </Link>
            </Button>
          </div>
        </section>
      ) : null}

      <LedgerTable
        rows={ledger.rows}
        total={ledger.total}
        page={ledger.page}
        pageCount={ledger.pageCount}
        pageSize={LEDGER_PAGE_SIZE}
        withCost={withCost}
        filtered={filtered}
        toolbar={
          <ListFilters
            key="ledger-filters"
            keep={["variantId"]}
            fields={[
              {
                kind: "search",
                name: "search",
                label: "Search",
                placeholder: "SKU, product or document number",
              },
              {
                kind: "select",
                name: "warehouseId",
                label: "Warehouse",
                allLabel: "All warehouses",
                options: warehouses.map((warehouse) => ({
                  value: warehouse.id,
                  label: warehouse.code,
                })),
              },
              {
                kind: "select",
                name: "type",
                label: "Type",
                allLabel: "Every type",
                options: MOVEMENT_TYPES.map((type) => ({
                  value: type,
                  label: MOVEMENT_TYPE_LABEL[type],
                })),
              },
              { kind: "date", name: "from", label: "From" },
              { kind: "date", name: "to", label: "To" },
            ]}
          />
        }
      />
    </div>
  );
}
