import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Saved-view tabs above a list, the Shopify resource-list convention the
 * product list already uses. Rendered on the server: each tab is a plain link
 * to a URL, so the active one is simply whichever matches the current params.
 */

export type ViewTab = {
  label: string;
  href: string;
  active: boolean;
  count?: number;
};

export function ViewTabs({ tabs, actions }: { tabs: ViewTab[]; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-hairline">
      <nav aria-label="Views" className="-mb-px flex max-w-full items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-body-sm whitespace-nowrap transition-colors",
              tab.active
                ? "border-accent-fill text-ink"
                : "border-transparent text-ink-subtle hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span
                data-numeric
                className="rounded-xs bg-surface-2 px-1 font-mono text-[11px] text-ink-subtle"
              >
                {tab.count.toLocaleString("en-PH")}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
      {actions ? <div className="ml-auto flex items-center gap-2 pb-1.5">{actions}</div> : null}
    </div>
  );
}
