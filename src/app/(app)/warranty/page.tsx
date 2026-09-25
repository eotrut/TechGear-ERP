import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ClaimsTable } from "@/features/warranty/components/claims-table";
import { CLAIM_PAGE_SIZE, listClaims } from "@/features/warranty/queries";
import { claimFiltersSchema, type ClaimView } from "@/features/warranty/schemas";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Warranty claims" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

const VIEW_LABEL: Record<ClaimView, string> = {
  open: "Open",
  review: "To review",
  approved: "To resolve",
  resolved: "Resolved",
  all: "All",
};

export default async function WarrantyPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("warranty.view");
  const params = await searchParams;
  const filters = claimFiltersSchema.parse({
    view: single(params.view),
    search: single(params.search),
    page: single(params.page),
  });
  const list = await listClaims(filters);

  const tabHref = (view: ClaimView) => {
    const next = new URLSearchParams();
    if (filters.search) next.set("search", filters.search);
    if (view !== "open") next.set("view", view);
    const query = next.toString();
    return query === "" ? "/warranty" : `/warranty?${query}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Warranty claims"
        description="Faults on delivered items still inside their coverage. A covered fault is resolved with a no-charge replacement from stock, or a refund for the unit."
        actions={
          can(user.role, "warranty.create") ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/warranty/new">
                <Plus aria-hidden />
                New claim
              </Link>
            </Button>
          ) : null
        }
      />
      <ClaimsTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={CLAIM_PAGE_SIZE}
        filtered={Boolean(filters.search) || filters.view !== "all"}
        toolbar={
          <div key="claim-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={(Object.keys(VIEW_LABEL) as ClaimView[]).map((view) => ({
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
                  placeholder: "Claim number, serial, SKU or customer",
                },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
