import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { REPORT_GROUPS, REPORTS } from "@/features/reports/services/catalog";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Reports" };

/**
 * The report index: every report the role may run, grouped the way the
 * business asks its questions. A list rather than a grid of cards, because
 * the title and one line are all anybody reads before clicking.
 */
export default async function ReportsPage() {
  const { user } = await requirePermission("reports.view");
  const reports = Object.values(REPORTS).filter((report) => can(user.role, report.permission));

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Every report takes a date range, compares it with the period before, and exports to CSV. Revenue is counted one way everywhere, so the same range gives the same figure on every page."
      />

      {REPORT_GROUPS.map((group) => {
        const items = reports.filter((report) => report.group === group);
        if (items.length === 0) return null;
        return (
          <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
            <h2
              id={`group-${group}`}
              className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase"
            >
              {group}
            </h2>
            <ul className="overflow-hidden rounded-lg border border-hairline">
              {items.map((report) => (
                <li key={report.slug} className="border-b border-hairline last:border-b-0">
                  <Link
                    href={`/reports/${report.slug}`}
                    className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-1 focus-visible:-outline-offset-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium text-ink">{report.title}</span>
                      <span className="block text-body-sm text-ink-subtle">
                        {report.description}
                      </span>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
