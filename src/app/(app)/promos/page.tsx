import type { Metadata } from "next";

import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PromosTable } from "@/features/promos/components/promos-table";
import { listPromos, PROMO_PAGE_SIZE } from "@/features/promos/queries";
import { promoFiltersSchema, type PromoView } from "@/features/promos/schemas";
import { manilaDayKey } from "@/lib/format";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Promos" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

const VIEW_LABEL: Record<PromoView, string> = {
  all: "All",
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  inactive: "Inactive",
};

export default async function PromosPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("promos.view");
  const params = await searchParams;
  const filters = promoFiltersSchema.parse({
    view: single(params.view),
    page: single(params.page),
  });
  const now = new Date();
  const list = await listPromos(filters.view, filters.page, now);
  const today = manilaDayKey(now);
  const inAMonth = manilaDayKey(new Date(now.getTime() + 30 * 86_400_000));

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Promos"
        description="Codes that take a percent or a peso amount off the goods on an order. A use is counted when an order is saved with the code, and given back if the order is cancelled."
      />
      <PromosTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={PROMO_PAGE_SIZE}
        canManage={can(user.role, "promos.manage")}
        newDefaults={{
          code: "",
          description: "",
          type: "PERCENT",
          value: "",
          minSubtotal: "",
          startsOn: today,
          endsOn: inAMonth,
          usageLimit: "",
          perCustomerLimit: "",
          isActive: true,
        }}
        toolbar={
          <ViewTabs
            key="promo-tabs"
            tabs={(Object.keys(VIEW_LABEL) as PromoView[]).map((view) => ({
              label: VIEW_LABEL[view],
              href: view === "all" ? "/promos" : `/promos?view=${view}`,
              active: filters.view === view,
              count: list.counts[view],
            }))}
          />
        }
      />
    </div>
  );
}
