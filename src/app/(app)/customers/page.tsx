import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CustomersTable } from "@/features/customers/components/customers-table";
import { RefreshSegmentsButton } from "@/features/customers/components/refresh-segments-button";
import {
  CUSTOMER_PAGE_SIZE,
  customerProvinces,
  customerSegmentCounts,
  listCustomers,
} from "@/features/customers/queries";
import { CUSTOMER_TYPE_LABEL, customerFiltersSchema } from "@/features/customers/schemas";
import { SEGMENT_META, SEGMENTS } from "@/features/customers/services/segment-rules";
import { CHANNEL_LABEL, SALES_CHANNELS } from "@/lib/channels";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Customers" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("customers.view");
  const params = await searchParams;

  const filters = customerFiltersSchema.parse({
    search: single(params.search),
    segment: single(params.segment),
    type: single(params.type),
    channel: single(params.channel),
    province: single(params.province),
    sort: single(params.sort),
    dir: single(params.dir),
    page: single(params.page),
  });

  const canView360 = can(user.role, "customers.view360");
  const canCreate = can(user.role, "customers.manage");

  const [list, counts, provinces] = await Promise.all([
    listCustomers(filters, { withMoney: canView360 }),
    customerSegmentCounts(filters),
    customerProvinces(),
  ]);

  // Tabs keep every other filter, so "VIP in Cebu" is two clicks, not a reset.
  const tabHref = (segment?: string) => {
    const next = new URLSearchParams();
    for (const key of ["search", "type", "channel", "province", "sort", "dir"] as const) {
      const value = single(params[key]);
      if (value) next.set(key, value);
    }
    if (segment) next.set("segment", segment);
    const query = next.toString();
    return query === "" ? "/customers" : `/customers?${query}`;
  };
  const all = Object.values(counts).reduce((sum, count) => sum + count, 0);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Customers"
        description="Everyone who has bought from TechGear PH or is about to. Segments update themselves from order history."
        actions={
          <>
            {can(user.role, "customers.refreshSegments") ? <RefreshSegmentsButton /> : null}
            {canCreate ? (
              <Button asChild variant="primary" size="sm">
                <Link href="/customers/new">
                  <Plus aria-hidden />
                  New customer
                </Link>
              </Button>
            ) : null}
          </>
        }
        className="pb-0"
      />

      <CustomersTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={CUSTOMER_PAGE_SIZE}
        sort={filters.sort}
        dir={filters.dir}
        filtered={Boolean(
          filters.search || filters.segment || filters.type || filters.channel || filters.province,
        )}
        canView360={canView360}
        canCreate={canCreate}
        toolbar={
          <div key="customer-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={[
                { label: "All", href: tabHref(), active: !filters.segment, count: all },
                ...SEGMENTS.map((segment) => ({
                  label: SEGMENT_META[segment].label,
                  href: tabHref(segment),
                  active: filters.segment === segment,
                  count: counts[segment],
                })),
              ]}
            />
            {filters.segment ? (
              <p className="-mt-1 text-caption text-ink-subtle">
                <span className="font-medium text-ink-muted">
                  {SEGMENT_META[filters.segment].label}:
                </span>{" "}
                {SEGMENT_META[filters.segment].rule}.
              </p>
            ) : null}
            <ListFilters
              keep={["sort", "dir", "segment"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "Name, email, phone, code or tag",
                },
                {
                  kind: "select",
                  name: "type",
                  label: "Type",
                  allLabel: "Any type",
                  options: (["INDIVIDUAL", "BUSINESS"] as const).map((type) => ({
                    value: type,
                    label: CUSTOMER_TYPE_LABEL[type],
                  })),
                },
                {
                  kind: "select",
                  name: "channel",
                  label: "Source",
                  allLabel: "Any channel",
                  options: SALES_CHANNELS.map((channel) => ({
                    value: channel,
                    label: CHANNEL_LABEL[channel],
                  })),
                },
                {
                  kind: "select",
                  name: "province",
                  label: "Province",
                  allLabel: "Anywhere",
                  options: provinces.map((province) => ({ value: province, label: province })),
                },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
