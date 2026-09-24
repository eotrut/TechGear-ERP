import type { Metadata } from "next";

import { ListFilters } from "@/components/data-table/list-filters";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { ActivitiesTable } from "@/features/activities/components/activities-table";
import { LogActivityDialog } from "@/features/activities/components/log-activity-dialog";
import { ACTIVITY_PAGE_SIZE, activityOwners, listActivities } from "@/features/activities/queries";
import {
  ACTIVITY_TYPE_LABEL,
  ACTIVITY_TYPES,
  activityFiltersSchema,
} from "@/features/activities/schemas";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "All activities" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

export default async function ActivitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("activities.viewAll");
  const params = await searchParams;
  const filters = activityFiltersSchema.parse({
    owner: single(params.owner),
    type: single(params.type),
    status: single(params.status),
    due: single(params.due),
    search: single(params.search),
    page: single(params.page),
  });

  const [list, owners] = await Promise.all([listActivities(filters), activityOwners()]);

  const tabHref = (due?: string) => {
    const next = new URLSearchParams();
    for (const key of ["owner", "type", "status", "search"] as const) {
      const value = single(params[key]);
      if (value) next.set(key, value);
    }
    if (due) next.set("due", due);
    const query = next.toString();
    return query === "" ? "/activities" : `/activities?${query}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
      <PageHeader
        title="All activities"
        description="The whole team's calls, emails, meetings and tasks. Open work first, soonest due at the top."
        actions={<LogActivityDialog currentUserId={user.id} owners={owners} title="New activity" />}
      />
      <ActivitiesTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={ACTIVITY_PAGE_SIZE}
        filtered={Boolean(
          filters.owner || filters.type || filters.status || filters.due || filters.search,
        )}
        toolbar={
          <div key="activity-toolbar" className="flex flex-col gap-3">
            <ViewTabs
              tabs={[
                { label: "All", href: tabHref(), active: !filters.due },
                {
                  label: "Overdue",
                  href: tabHref("overdue"),
                  active: filters.due === "overdue",
                  count: list.overdue,
                },
                { label: "Due today", href: tabHref("today"), active: filters.due === "today" },
                { label: "Next 7 days", href: tabHref("week"), active: filters.due === "week" },
              ]}
            />
            <ListFilters
              keep={["due"]}
              fields={[
                {
                  kind: "search",
                  name: "search",
                  label: "Search",
                  placeholder: "Subject, customer, lead or ticket number",
                },
                {
                  kind: "select",
                  name: "owner",
                  label: "Owner",
                  allLabel: "Everyone",
                  options: owners.map((owner) => ({ value: owner.id, label: owner.name })),
                },
                {
                  kind: "select",
                  name: "type",
                  label: "Type",
                  allLabel: "Any type",
                  options: ACTIVITY_TYPES.map((type) => ({
                    value: type,
                    label: ACTIVITY_TYPE_LABEL[type],
                  })),
                },
                {
                  kind: "select",
                  name: "status",
                  label: "Status",
                  allLabel: "Any status",
                  options: [
                    { value: "OPEN", label: "Open" },
                    { value: "DONE", label: "Done" },
                    { value: "CANCELLED", label: "Cancelled" },
                  ],
                },
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
