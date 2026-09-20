import type { Metadata } from "next";
import { Database } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Phase 1 placeholder. The layout, type scale and hairline rhythm here are the
 * real ones; only the data is missing, because the schema and seed land in the
 * next phase. Rather than invent numbers, this page states what is missing and
 * what will fill it.
 */
const plannedMetrics = [
  { group: "Revenue", items: ["Today", "This week", "This month", "Average order value"] },
  { group: "Margin", items: ["Gross profit", "Gross margin", "Inventory value at cost"] },
  { group: "Operations", items: ["Orders to pack", "Low stock", "Out of stock", "Open tickets"] },
  { group: "Pipeline", items: ["Open leads", "Pipeline value", "Overdue tasks"] },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Dashboard"
        description="Revenue, margin, stock health and pipeline for TechGear PH, scoped to your role."
      />

      <EmptyState
        className="mx-auto max-w-2xl"
        icon={Database}
        title="No data yet"
        description="The database schema and the seeded demo data arrive in the next phase. Once seeded, this page shows live figures for the last twelve months across every sales channel."
        action={
          <div className="rounded-md border border-hairline bg-canvas px-3 py-2 text-left font-mono text-[12px] leading-relaxed text-ink-muted">
            <div>npm run db:up</div>
            <div>npx prisma migrate dev</div>
            <div>npm run db:seed</div>
          </div>
        }
      />

      <section className="mt-6" aria-labelledby="planned-heading">
        <h2 id="planned-heading" className="text-section text-ink">
          What lands here
        </h2>
        <p className="mt-1 text-body-sm text-ink-subtle">
          Admin and Manager see all four groups. Sales sees pipeline and their own revenue.
          Warehouse sees operations only.
        </p>

        <dl className="mt-4 grid gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
          {plannedMetrics.map((metric) => (
            <div key={metric.group} className="border-t border-hairline pt-3 pb-1">
              <dt className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                {metric.group}
              </dt>
              <dd className="mt-2">
                <ul className="flex flex-col gap-1.5">
                  {metric.items.map((item) => (
                    <li key={item} className="text-body-sm text-ink-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
