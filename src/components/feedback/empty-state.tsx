import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Empty states name the next action rather than shrugging. */
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-hairline bg-surface-1",
        "flex flex-col items-center px-6 py-9 text-center",
        className,
      )}
    >
      <span className="mb-4 inline-flex size-9 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
        <Icon className="size-4" aria-hidden />
      </span>

      <h2 className="text-section text-ink">{title}</h2>
      <p className="mt-1.5 max-w-[52ch] text-body-sm text-ink-subtle">{description}</p>

      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
