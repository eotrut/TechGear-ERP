import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Ranked horizontal bars with the value printed at the tip: the form for a
 * nominal breakdown (channel, category) where the job is "which is biggest,
 * and by how much". One colour for every bar, because the categories have no
 * order and colouring them would only re-encode the length (dataviz
 * anti-pattern). Built in HTML rather than SVG so long labels wrap and stay
 * selectable, and every value is already a label, so nothing hides in a
 * tooltip.
 */

export type BarListItem = {
  key: string;
  label: string;
  /** Drives the bar length. */
  value: number;
  /** The printed value, already formatted. */
  display: string;
  /** Muted context after the value, such as a share or an order count. */
  detail?: string;
  href?: string;
};

export function BarList({
  items,
  caption,
  className,
}: {
  items: BarListItem[];
  caption: string;
  className?: string;
}) {
  const max = Math.max(0, ...items.map((item) => item.value));

  return (
    <ul aria-label={caption} className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item) => {
        const width = max > 0 ? Math.max(0, (item.value / max) * 100) : 0;
        return (
          <li key={item.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-body-sm">
              {item.href ? (
                <Link
                  href={item.href}
                  className="min-w-0 truncate text-ink hover:text-accent-strong"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-ink">{item.label}</span>
              )}
              <span className="flex shrink-0 items-baseline gap-2">
                <span data-numeric className="font-mono text-ink">
                  {item.display}
                </span>
                {item.detail ? (
                  <span
                    data-numeric
                    className="w-12 text-right font-mono text-caption text-ink-subtle"
                  >
                    {item.detail}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="h-1.5 w-full" aria-hidden>
              <div
                className="h-full rounded-r-[3px] bg-chart-1"
                style={{ width: `${width}%`, minWidth: item.value > 0 ? 2 : 0 }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
