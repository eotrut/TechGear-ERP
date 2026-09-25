import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { OrdersTable } from "@/features/orders/components/orders-table";
import { listOrders, ORDER_PAGE_SIZE, salespeople } from "@/features/orders/queries";
import {
  orderFiltersSchema,
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  type OrderView,
} from "@/features/orders/schemas";
import { CHANNEL_LABEL, SALES_CHANNELS } from "@/lib/channels";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Orders" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

const VIEW_LABEL: Record<OrderView, string> = {
  all: "All",
  open: "Open",
  unpaid: "Unpaid",
  "to-fulfil": "To fulfil",
  "in-transit": "In transit",
  completed: "Delivered",
  cancelled: "Cancelled",
};

const FILTER_KEYS = ["channel", "method", "salesperson", "from", "to", "search"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("orders.view");
  const params = await searchParams;

  const filters = orderFiltersSchema.parse({
    view: single(params.view),
    channel: single(params.channel),
    method: single(params.method),
    salesperson: single(params.salesperson),
    from: single(params.from),
    to: single(params.to),
    search: single(params.search),
    sort: single(params.sort),
    dir: single(params.dir),
    page: single(params.page),
  });

  const viewMoney = can(user.role, "orders.viewMoney");
  const [list, people] = await Promise.all([
    listOrders(filters, { userId: user.id, viewMoney }),
    salespeople(),
  ]);
  const canCreate = can(user.role, "orders.create");

  const tabHref = (view: OrderView) => {
    const next = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = single(params[key]);
      if (value) next.set(key, value);
    }
    if (view !== "all") next.set("view", view);
    const query = next.toString();
    return query === "" ? "/orders" : `/orders?${query}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="Orders"
        description={
          viewMoney
            ? "Every channel in one list. Stock is reserved when an order is placed and leaves the shelf when it is paid."
            : "What to pick, pack and ship. Placed orders hold their stock; paid ones are ready to fulfil."
        }
        actions={
          canCreate ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/orders/new">
                <Plus aria-hidden />
                New order
              </Link>
            </Button>
          ) : null
        }
      />

      <OrdersTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={ORDER_PAGE_SIZE}
        sort={filters.sort}
        dir={filters.dir}
        canCreate={canCreate}
        filtered={FILTER_KEYS.some((key) => Boolean(filters[key])) || filters.view !== "all"}
        toolbar={
          <div key="order-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={(Object.keys(VIEW_LABEL) as OrderView[]).map((view) => ({
                label: VIEW_LABEL[view],
                href: tabHref(view),
                active: filters.view === view,
                count: list.counts[view],
              }))}
            />
            <ListFilters
              keep={["view", "sort", "dir"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "Order number, marketplace ref, customer or SKU",
                },
                {
                  kind: "select",
                  name: "channel",
                  label: "Channel",
                  allLabel: "Every channel",
                  options: SALES_CHANNELS.map((channel) => ({
                    value: channel,
                    label: CHANNEL_LABEL[channel],
                  })),
                },
                ...(viewMoney
                  ? [
                      {
                        kind: "select" as const,
                        name: "method",
                        label: "Paid by",
                        allLabel: "Any method",
                        options: PAYMENT_METHODS.map((method) => ({
                          value: method,
                          label: PAYMENT_METHOD_LABEL[method],
                        })),
                      },
                    ]
                  : []),
                {
                  kind: "select",
                  name: "salesperson",
                  label: "Sold by",
                  allLabel: "Anyone",
                  options: [
                    { value: "me", label: "Mine" },
                    ...people
                      .filter((person) => person.id !== user.id)
                      .map((person) => ({ value: person.id, label: person.name })),
                  ],
                },
                { kind: "date", name: "from", label: "Placed from" },
                { kind: "date", name: "to", label: "Placed to" },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
