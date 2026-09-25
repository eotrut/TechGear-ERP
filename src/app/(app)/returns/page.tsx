import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ReturnsTable } from "@/features/returns/components/returns-table";
import { listReturns, RETURN_PAGE_SIZE } from "@/features/returns/queries";
import { returnFiltersSchema, type ReturnView } from "@/features/returns/schemas";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Returns" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

const VIEW_LABEL: Record<ReturnView, string> = {
  open: "Open",
  requested: "To approve",
  approved: "To receive",
  received: "To refund",
  closed: "Closed",
  all: "All",
};

export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("returns.view");
  const params = await searchParams;
  const filters = returnFiltersSchema.parse({
    view: single(params.view),
    search: single(params.search),
    page: single(params.page),
  });
  const viewMoney = can(user.role, "orders.viewMoney");
  const list = await listReturns(filters, { viewMoney });

  const tabHref = (view: ReturnView) => {
    const next = new URLSearchParams();
    if (filters.search) next.set("search", filters.search);
    if (view !== "open") next.set("view", view);
    const query = next.toString();
    return query === "" ? "/returns" : `/returns?${query}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Returns"
        description="Goods coming back from customers. Sales raises the return, a manager approves it, the warehouse inspects each unit, and completing it restocks or writes off and refunds in one step."
        actions={
          can(user.role, "returns.create") ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/returns/new">
                <Plus aria-hidden />
                New return
              </Link>
            </Button>
          ) : null
        }
      />
      <ReturnsTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={RETURN_PAGE_SIZE}
        moneyVisible={viewMoney}
        filtered={Boolean(filters.search) || filters.view !== "all"}
        toolbar={
          <div key="return-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={(Object.keys(VIEW_LABEL) as ReturnView[]).map((view) => ({
                label: VIEW_LABEL[view],
                href: tabHref(view),
                active: filters.view === view,
                count: list.counts[view],
              }))}
            />
            <ListFilters
              keep={["view"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "RMA or order number, customer",
                },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
