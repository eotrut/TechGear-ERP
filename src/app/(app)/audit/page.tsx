import type { Metadata } from "next";
import Link from "next/link";
import { FileClock } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { auditActionTone, StatusBadge } from "@/components/ui/status-badge";
import { AuditFilters } from "@/features/audit/components/audit-filters";
import { auditFilterOptions, listAuditEntries, type AuditEntry } from "@/features/audit/queries";
import { auditFiltersSchema } from "@/features/audit/schemas";
import { formatDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Audit log" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw : undefined;
}

/** Render the stored before/after diff as readable rows. */
function ChangeList({ changes }: { changes: AuditEntry["changes"] }) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null;

  const entries = Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>);
  if (entries.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-col gap-0.5">
      {entries.map(([field, change]) => (
        <li key={field} className="font-mono text-caption text-ink-subtle">
          <span className="text-ink-muted">{field}</span>{" "}
          <span className="line-through opacity-70">{format(change?.from)}</span>{" "}
          <span aria-hidden>{"->"}</span> <span className="text-ink">{format(change?.to)}</span>
        </li>
      ))}
    </ul>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  // Admin full, Manager read. Both land here; neither can erase anything,
  // because there is no mutation on this page at all.
  await requirePermission("audit.view");

  const params = await searchParams;
  const filters = auditFiltersSchema.parse({
    actorId: single(params.actorId),
    action: single(params.action),
    entityType: single(params.entityType),
    search: single(params.search),
    from: single(params.from),
    to: single(params.to),
    page: single(params.page),
  });
  const { page } = filters;

  const [{ entries, total, pageCount }, options] = await Promise.all([
    listAuditEntries(filters),
    auditFilterOptions(),
  ]);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const item = single(value);
    if (item && key !== "page") query.set(key, item);
  }

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Audit log"
        description="Who did what, when, and what changed. Every entry is written in the same transaction as the change it records."
      />

      <AuditFilters actors={options.actors} entityTypes={options.entityTypes} />

      {entries.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="No entries match those filters"
          description="Try widening the date range or clearing the actor and action filters."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-hairline">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline bg-surface-1">
                  <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    When
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    Actor
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    Action
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    What changed
                  </th>
                  <th className="hidden px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase lg:table-cell">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b border-hairline last:border-b-0">
                    <td className="px-3 py-2 align-top font-mono text-[12px] whitespace-nowrap text-ink-muted">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-body-sm text-ink">{entry.actor?.name ?? "Unknown"}</div>
                      <div className="font-mono text-[11px] text-ink-subtle">
                        {entry.actorEmail}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <StatusBadge tone={auditActionTone(entry.action)}>
                        {entry.action.replace(/_/g, " ").toLowerCase()}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="text-body-sm text-ink">{entry.summary}</div>
                      <div className="font-mono text-[11px] text-ink-subtle">
                        {entry.entityType}
                        {entry.entityId ? ` ${entry.entityId}` : ""}
                      </div>
                      <ChangeList changes={entry.changes} />
                    </td>
                    <td className="hidden px-3 py-2 align-top font-mono text-[11px] text-ink-subtle lg:table-cell">
                      {entry.ipAddress ?? "not recorded"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-body-sm text-ink-subtle">
              Page <span data-numeric>{page}</span> of <span data-numeric>{pageCount}</span>,{" "}
              <span data-numeric>{total.toLocaleString("en-PH")}</span> entries
            </p>
            <div className="flex gap-2">
              <Button asChild variant="secondary" size="sm" disabled={page <= 1}>
                <Link href={`/audit?${query.toString()}&page=${Math.max(1, page - 1)}`}>
                  Previous
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm" disabled={page >= pageCount}>
                <Link href={`/audit?${query.toString()}&page=${Math.min(pageCount, page + 1)}`}>
                  Next
                </Link>
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
