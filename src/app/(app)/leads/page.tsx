import type { Metadata } from "next";

import { ViewTabs } from "@/components/data-table/view-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { Input } from "@/components/ui/input";
import { LeadBoard } from "@/features/leads/components/lead-board";
import { NewLeadButton } from "@/features/leads/components/new-lead-button";
import { getLeadBoard, leadOwners } from "@/features/leads/queries";
import { leadBoardFiltersSchema } from "@/features/leads/schemas";
import { formatPeso } from "@/lib/money";
import { can, scopeFor } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Leads" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

/** Whole pesos: a pipeline total to the centavo is false precision. */
function pesos(centavos: number): string {
  return formatPeso(centavos).replace(/\.\d{2}$/, "");
}

export default async function LeadsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("leads.view");
  const params = await searchParams;
  const filters = leadBoardFiltersSchema.parse({
    owner: single(params.owner),
    search: single(params.search),
  });

  const [board, owners] = await Promise.all([getLeadBoard(filters, user.id), leadOwners()]);
  const moveScope = scopeFor(user.role, "leads.moveStage");

  const tabHref = (owner?: string) => {
    const next = new URLSearchParams();
    if (owner) next.set("owner", owner);
    if (filters.search) next.set("search", filters.search);
    const query = next.toString();
    return query === "" ? "/leads" : `/leads?${query}`;
  };

  return (
    <div className="flex w-full flex-col gap-5">
      <PageHeader
        title="Leads"
        description="The B2B pipeline. Drag a card to move it a stage; dropping on Won turns it into a customer."
        className="pb-0"
        actions={
          can(user.role, "leads.create") ? (
            <NewLeadButton owners={can(user.role, "leads.reassign") ? owners : undefined} />
          ) : null
        }
      />

      <StatStrip
        stats={[
          {
            label: "Open pipeline",
            value: pesos(board.stats.openValueCentavos),
            hint: `${board.stats.openCount} open lead${board.stats.openCount === 1 ? "" : "s"}`,
          },
          {
            label: "Weighted forecast",
            value: pesos(board.stats.weightedCentavos),
            hint: "value times win probability",
          },
          {
            label: "Won, last 90 days",
            value: pesos(board.stats.wonRecentCentavos),
            hint: `${board.stats.wonRecentCount} deal${board.stats.wonRecentCount === 1 ? "" : "s"}`,
          },
          {
            label: "Win rate, 180 days",
            value:
              board.stats.winRateBps === null
                ? "no closes"
                : `${Math.round(board.stats.winRateBps / 100)}%`,
            hint:
              board.stats.overdueCount > 0
                ? `${board.stats.overdueCount} open past their close date`
                : "won against lost",
          },
        ]}
      />

      <ViewTabs
        tabs={[
          { label: "All leads", href: tabHref(), active: !filters.owner },
          { label: "Mine", href: tabHref("mine"), active: filters.owner === "mine" },
          ...owners
            .filter((owner) => owner.id !== user.id)
            .map((owner) => ({
              label: owner.name,
              href: tabHref(owner.id),
              active: filters.owner === owner.id,
            })),
        ]}
        actions={
          <form action="/leads" className="relative w-56 max-sm:w-full">
            {filters.owner ? <input type="hidden" name="owner" value={filters.owner} /> : null}
            <label htmlFor="lead-search" className="sr-only">
              Search leads
            </label>
            <Input
              id="lead-search"
              name="search"
              defaultValue={filters.search ?? ""}
              placeholder="Search title, company, code"
              className="h-7 text-body-sm"
            />
          </form>
        }
      />

      {moveScope === "own" ? (
        <p className="-mt-2 text-caption text-ink-subtle">
          You can move and convert the leads you own. Other cards show a lock.
        </p>
      ) : null}

      <LeadBoard
        board={board}
        currentUserId={user.id}
        moveScope={moveScope}
        canCreateCustomer={can(user.role, "customers.manage")}
      />
    </div>
  );
}
