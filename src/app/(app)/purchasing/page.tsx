import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { Button } from "@/components/ui/button";
import { PoTable } from "@/features/purchasing/components/po-table";
import {
  listPurchaseOrders,
  PO_PAGE_SIZE,
  purchasingSummary,
  supplierOptions,
} from "@/features/purchasing/queries";
import { poFiltersSchema, type PoView } from "@/features/purchasing/schemas";
import { formatNumber } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Purchase orders" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const TABS: { view: PoView; label: string }[] = [
  { view: "all", label: "All" },
  { view: "open", label: "Open" },
  { view: "overdue", label: "Overdue" },
  { view: "DRAFT", label: "Drafts" },
  { view: "RECEIVED", label: "Received" },
  { view: "CLOSED", label: "Closed" },
  { view: "CANCELLED", label: "Cancelled" },
];

const FILTER_KEYS = ["search", "supplierId"] as const;

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("purchasing.view");
  const params = await searchParams;

  const filters = poFiltersSchema.parse({
    view: single(params.view),
    search: single(params.search),
    supplierId: single(params.supplierId),
    page: single(params.page),
  });

  const [list, summary, suppliers] = await Promise.all([
    listPurchaseOrders(filters),
    purchasingSummary(),
    supplierOptions(),
  ]);
  const canCreate = can(user.role, "purchasing.manage");

  const tabHref = (view: PoView) => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = single(params[key]);
      if (value) next.set(key, value);
    }
    if (view !== "all") next.set("view", view);
    const query = next.toString();
    return query === "" ? "/purchasing" : `/purchasing?${query}`;
  };

  const countFor = (view: PoView): number => {
    if (view === "all") return list.allCount;
    if (view === "open") return list.openCount;
    if (view === "overdue") return list.overdueCount;
    return list.counts[view] ?? 0;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Purchase orders"
        description="What TechGear PH has ordered and what has arrived. Receiving a delivery adds the stock to the ledger and moves each item's average cost."
        actions={
          canCreate ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/purchasing/new">
                <Plus aria-hidden />
                New purchase order
              </Link>
            </Button>
          ) : null
        }
      />

      <StatStrip
        stats={[
          {
            label: "On order",
            value: formatPeso(summary.onOrderCentavos),
            hint: `${formatNumber(summary.onOrderUnits)} units still to arrive`,
            href: "/purchasing?view=open",
          },
          {
            label: "Overdue",
            value: formatNumber(list.overdueCount),
            hint: "open orders past their expected date",
            tone: list.overdueCount > 0 ? "warning" : "default",
            href: "/purchasing?view=overdue",
          },
          {
            label: "Received this month",
            value: formatPeso(summary.receivedThisMonthCentavos),
            hint: `${formatNumber(summary.receivedThisMonthUnits)} units at cost`,
          },
          {
            label: "Drafts",
            value: formatNumber(summary.draftCount),
            hint: "not yet sent to a supplier",
            href: "/purchasing?view=DRAFT",
          },
        ]}
      />

      <PoTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={PO_PAGE_SIZE}
        canCreate={canCreate}
        filtered={FILTER_KEYS.some((key) => Boolean(filters[key])) || filters.view !== "all"}
        toolbar={
          <div key="po-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={TABS.map((tab) => ({
                label: tab.label,
                href: tabHref(tab.view),
                active: filters.view === tab.view,
                count: countFor(tab.view),
              }))}
            />
            <ListFilters
              keep={["view"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "PO number, supplier or SKU",
                },
                {
                  kind: "select",
                  name: "supplierId",
                  label: "Supplier",
                  allLabel: "Every supplier",
                  options: suppliers.map((supplier) => ({
                    value: supplier.id,
                    label: supplier.name,
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
