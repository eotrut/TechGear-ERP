import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * A row of headline numbers. Stripe's KPI anatomy at this app's density:
 * small-caps label, large mono value, one line of context, and no card
 * chrome. Hairlines separate the figures instead.
 */

export type Stat = {
  label: string;
  value: string;
  hint?: string;
  /** Tone of the value itself, for a number that is a warning on its own. */
  tone?: "default" | "warning" | "critical";
  href?: string;
};

export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 border-t border-hairline pt-2">
          <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">{stat.label}</dt>
          <dd
            data-numeric
            className={cn(
              "mt-0.5 font-mono text-lead font-medium",
              stat.tone === "warning" && "text-warning",
              stat.tone === "critical" && "text-danger",
              (!stat.tone || stat.tone === "default") && "text-ink",
            )}
          >
            {stat.href ? (
              <Link
                href={stat.href}
                className="rounded-xs hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
              >
                {stat.value}
              </Link>
            ) : (
              stat.value
            )}
          </dd>
          {stat.hint ? <dd className="text-caption text-ink-subtle">{stat.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
