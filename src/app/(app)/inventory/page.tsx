import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, ClipboardPen } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ListFilters } from "@/features/inventory/components/list-filters";
import { StatStrip, type Stat } from "@/features/inventory/components/stat-strip";
import { StockTable } from "@/features/inventory/components/stock-table";
import { ViewTabs } from "@/features/inventory/components/view-tabs";
import {
  categoryOptions,
  listStock,
  STOCK_PAGE_SIZE,
  stockSummary,
  warehouseOptions,
} from "@/features/inventory/queries";
import { stockFiltersSchema } from "@/features/inventory/schemas";
import { formatNumber } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Stock" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("inventory.viewLevels");
  const params = await searchParams;

  const filters = stockFiltersSchema.parse({
    search: single(params.search),
    warehouseId: single(params.warehouseId),
    categoryId: single(params.categoryId),
    status: single(params.status),
    sort: single(params.sort),
    dir: single(params.dir),
    page: single(params.page),
  });

  const withCost = can(user.role, "products.viewCost");

  const [stock, summary, warehouses, categories] = await Promise.all([
    listStock(filters, { withCost }),
    stockSummary(filters.warehouseId),
    warehouseOptions(),
    categoryOptions(),
  ]);

  const scope = warehouses.find((warehouse) => warehouse.id === filters.warehouseId);

  const tabHref = (status?: string) => {
    const next = new URLSearchParams();
    if (filters.warehouseId) next.set("warehouseId", filters.warehouseId);
    if (status) next.set("status", status);
    const query = next.toString();
    return query === "" ? "/inventory" : `/inventory?${query}`;
  };

  const stats: Stat[] = [
    {
      label: "On hand",
      value: formatNumber(summary.units),
      hint: `${formatNumber(summary.reserved)} reserved for pending orders`,
    },
    withCost
      ? {
          label: "Value at cost",
          value: formatPeso(summary.valueCentavos),
          hint: "On hand at moving-average cost",
        }
      : { label: "Variants tracked", value: formatNumber(summary.skus), hint: "Active catalogue" },
    {
      label: "Out of stock",
      value: formatNumber(summary.out),
      hint: "Nothing available to sell",
      tone: summary.out > 0 ? "critical" : "default",
      href: tabHref("out"),
    },
    {
      label: "At or below reorder point",
      value: formatNumber(summary.low),
      hint: "Still selling, time to restock",
      tone: summary.low > 0 ? "warning" : "default",
      href: tabHref("low"),
    },
  ];

  const filtered = Boolean(filters.search || filters.categoryId || filters.status);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Stock"
        description={
          scope
            ? `Positions in ${scope.name}. Every number is derived from the stock ledger; available is on hand less units reserved for pending orders.`
            : "Positions across every warehouse. Every number is derived from the stock ledger; available is on hand less units reserved for pending orders."
        }
        actions={
          <>
            {can(user.role, "inventory.adjust") ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/inventory/adjustments/new">
                  <ClipboardPen aria-hidden />
                  Adjust stock
                </Link>
              </Button>
            ) : null}
            {can(user.role, "inventory.transfer") ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/inventory/transfers/new">
                  <ArrowLeftRight aria-hidden />
                  New transfer
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatStrip stats={stats} />

      <StockTable
        rows={stock.rows}
        total={stock.total}
        page={stock.page}
        pageCount={stock.pageCount}
        pageSize={STOCK_PAGE_SIZE}
        sort={filters.sort}
        dir={filters.dir}
        warehouses={scope ? [] : warehouses.filter((warehouse) => warehouse.isActive)}
        withCost={withCost}
        filtered={filtered}
        toolbar={
          <div key="stock-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={[
                { label: "All", href: tabHref(), active: !filters.status, count: summary.skus },
                {
                  label: "Low",
                  href: tabHref("low"),
                  active: filters.status === "low",
                  count: summary.low,
                },
                {
                  label: "Out of stock",
                  href: tabHref("out"),
                  active: filters.status === "out",
                  count: summary.out,
                },
                {
                  label: "In stock",
                  href: tabHref("in"),
                  active: filters.status === "in",
                },
              ]}
            />
            <ListFilters
              keep={["sort", "dir", "status"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "Name, SKU or barcode",
                },
                {
                  kind: "select",
                  name: "warehouseId",
                  label: "Warehouse",
                  allLabel: "All warehouses",
                  options: warehouses.map((warehouse) => ({
                    value: warehouse.id,
                    label: warehouse.isActive ? warehouse.code : `${warehouse.code} (inactive)`,
                  })),
                },
                {
                  kind: "select",
                  name: "categoryId",
                  label: "Category",
                  allLabel: "Any category",
                  options: categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
