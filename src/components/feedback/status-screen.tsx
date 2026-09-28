import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one layout for every "this is not the page you wanted" moment: 401,
 * 403, 404 and a crashed render. Full screen outside the shell, a centred
 * block inside it, so the sidebar and the way back stay where they were.
 */
export function StatusScreen({
  icon: Icon,
  tone = "neutral",
  title,
  description,
  detail,
  actions,
  inShell = false,
}: {
  icon: LucideIcon;
  tone?: "neutral" | "warning" | "danger";
  title: string;
  description: string;
  /** A mono line under the copy: a missing permission, an error reference. */
  detail?: string;
  actions?: React.ReactNode;
  inShell?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center px-4",
        inShell ? "min-h-[60dvh] py-12" : "min-h-dvh",
      )}
    >
      <div className="w-full max-w-md text-center">
        <span
          className={cn(
            "mb-4 inline-flex size-10 items-center justify-center rounded-md border border-hairline bg-surface-2",
            tone === "warning"
              ? "text-warning"
              : tone === "danger"
                ? "text-danger"
                : "text-ink-subtle",
          )}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <h1 className="text-title text-ink">{title}</h1>
        <p className="mt-2 text-body-sm text-ink-subtle">{description}</p>
        {detail ? <p className="mt-3 font-mono text-[12px] text-ink-subtle">{detail}</p> : null}
        {actions ? <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
