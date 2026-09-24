import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { AlertsTable } from "@/features/inventory/components/alerts-table";
import { ListFilters } from "@/components/data-table/list-filters";
import { ReorderTable } from "@/features/inventory/components/reorder-table";
import { ViewTabs } from "@/components/data-table/view-tabs";
import {
  ALERT_PAGE_SIZE,
  alertCounts,
  listAlerts,
  listReorderSuggestions,
  SALES_WINDOW_DAYS,
  warehouseOptions,
} from "@/features/inventory/queries";
import { alertFiltersSchema } from "@/features/inventory/schemas";
import { formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Stock alerts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("inventory.viewAlerts");
  const params = await searchParams;

  const filters = alertFiltersSchema.parse({
    view: single(params.view),
    warehouseId: single(params.warehouseId),
    level: single(params.level),
    page: single(params.page),
  });

  const withCost = can(user.role, "products.viewCost");
  const canSetReorder = can(user.role, "inventory.setReorderLevels");

  const [counts, warehouses, reorderAll] = await Promise.all([
    alertCounts(filters.warehouseId),
    warehouseOptions(),
    // Only the count is needed for the tab when the other view is open.
    listReorderSuggestions(filters.view === "reorder" ? filters.page : 1, { withCost }),
  ]);

  const href = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = {
      warehouseId: filters.warehouseId,
      level: filters.level,
      view: filters.view,
      ...changes,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value && !(key === "view" && value === "alerts")) next.set(key, value);
    }
    const query = next.toString();
    return query === "" ? "/inventory/alerts" : `/inventory/alerts?${query}`;
  };

  const tabs = (
    <ViewTabs
      tabs={[
        {
          label: "All alerts",
          href: href({ view: "alerts", level: undefined }),
          active: filters.view === "alerts" && !filters.level,
          count: counts.out + counts.low,
        },
        {
          label: "Out of stock",
          href: href({ view: "alerts", level: "out" }),
          active: filters.view === "alerts" && filters.level === "out",
          count: counts.out,
        },
        {
          label: "Low",
          href: href({ view: "alerts", level: "low" }),
          active: filters.view === "alerts" && filters.level === "low",
          count: counts.low,
        },
        {
          label: "Reorder suggestions",
          href: href({ view: "reorder", level: undefined, warehouseId: undefined }),
          active: filters.view === "reorder",
          count: reorderAll.total,
        },
      ]}
    />
  );

  if (filters.view === "reorder") {
    return (
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
        <PageHeader
          title="Stock alerts"
          description={`What to buy, company wide. A variant is suggested when available stock plus open purchase orders reaches its reorder point, and the quantity is enough whole batches to clear it. Sorted by days of cover at the last ${SALES_WINDOW_DAYS} days of sales.`}
        />

        <ReorderTable
          rows={reorderAll.rows}
          total={reorderAll.total}
          page={reorderAll.page}
          pageCount={reorderAll.pageCount}
          pageSize={ALERT_PAGE_SIZE}
          withCost={withCost}
          canSetReorder={canSetReorder}
          toolbar={
            <div key="reorder-toolbar" className="flex flex-col gap-3">
              {tabs}
              {withCost && reorderAll.total > 0 ? (
                <p className="text-body-sm text-ink-subtle">
                  Buying every suggestion would cost about{" "}
                  <span data-numeric className="font-mono text-ink">
                    {formatPeso(reorderAll.totalCostCentavos)}
                  </span>{" "}
                  at last cost.
                </p>
              ) : null}
            </div>
          }
        />
      </div>
    );
  }

  const alerts = await listAlerts(filters);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Stock alerts"
        description="Warehouse positions that are out of stock or at their reorder point, measured on available stock. Where another warehouse has units to spare, moving them is suggested before buying more."
      />

      <AlertsTable
        rows={alerts.rows}
        total={alerts.total}
        page={alerts.page}
        pageCount={alerts.pageCount}
        pageSize={ALERT_PAGE_SIZE}
        canTransfer={can(user.role, "inventory.transfer")}
        canSetReorder={canSetReorder}
        filtered={Boolean(filters.warehouseId || filters.level)}
        toolbar={
          <div key="alerts-toolbar" className="flex flex-col gap-3">
            {tabs}
            <ListFilters
              keep={["level", "view"]}
              fields={[
                {
                  kind: "select",
                  name: "warehouseId",
                  label: "Warehouse",
                  allLabel: "All warehouses",
                  options: warehouses
                    .filter((warehouse) => warehouse.isActive)
                    .map((warehouse) => ({ value: warehouse.id, label: warehouse.code })),
                },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
