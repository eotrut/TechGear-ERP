import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { BillsTable } from "@/features/purchasing/components/bills-table";
import { AgingStrip, SupplierAgingTable } from "@/features/purchasing/components/payables-aging";
import {
  BILL_PAGE_SIZE,
  listBills,
  payablesAging,
  supplierOptions,
} from "@/features/purchasing/queries";
import { billFiltersSchema, type BillView } from "@/features/purchasing/schemas";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Bills" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const TABS: { view: BillView; label: string }[] = [
  { view: "unpaid", label: "Unpaid" },
  { view: "overdue", label: "Overdue" },
  { view: "paid", label: "Paid" },
  { view: "void", label: "Void" },
  { view: "all", label: "All" },
];

const FILTER_KEYS = ["search", "supplierId"] as const;

export default async function BillsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("bills.view");
  const params = await searchParams;

  const filters = billFiltersSchema.parse({
    view: single(params.view),
    search: single(params.search),
    supplierId: single(params.supplierId),
    page: single(params.page),
  });

  const now = new Date();
  const [list, aging, suppliers] = await Promise.all([
    listBills(filters, now),
    payablesAging(now),
    supplierOptions(),
  ]);
  const canCreate = can(user.role, "bills.manage");

  const tabHref = (view: BillView) => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = single(params[key]);
      if (value) next.set(key, value);
    }
    if (view !== "unpaid") next.set("view", view);
    const query = next.toString();
    return query === "" ? "/purchasing/bills" : `/purchasing/bills?${query}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Bills"
        description="Supplier invoices and what is still owed on them. Aging counts calendar days past the due date the supplier's terms set."
        actions={
          canCreate ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/purchasing/bills/new">
                <Plus aria-hidden />
                Record a bill
              </Link>
            </Button>
          ) : null
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-section text-ink">Payables aging</h2>
        <AgingStrip totals={aging.totals} />
      </section>

      <BillsTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={BILL_PAGE_SIZE}
        canCreate={canCreate}
        filtered={FILTER_KEYS.some((key) => Boolean(filters[key])) || filters.view !== "unpaid"}
        toolbar={
          <div key="bill-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={TABS.map((tab) => ({
                label: tab.label,
                href: tabHref(tab.view),
                active: filters.view === tab.view,
                count: list.counts[tab.view],
              }))}
            />
            <ListFilters
              keep={["view"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "Bill, supplier invoice, supplier or PO number",
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

      {aging.suppliers.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-section text-ink">Owed by supplier</h2>
          <SupplierAgingTable rows={aging.suppliers} />
        </section>
      ) : null}
    </div>
  );
}
