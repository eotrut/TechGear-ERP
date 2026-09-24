import Link from "next/link";
import {
  Kanban,
  LifeBuoy,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

import { ActivityIcon } from "@/features/activities/components/activity-icon";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { TimelineEntry } from "../queries";

/**
 * The account's story, newest first: the work people logged and the events
 * the other modules recorded, on one rail. Open work is marked, overdue work
 * is marked louder, and everything links to where it happened.
 */

const KIND_ICON: Record<Exclude<TimelineEntry["kind"], "activity">, LucideIcon> = {
  order: ShoppingBag,
  ticket: LifeBuoy,
  claim: ShieldCheck,
  return: RotateCcw,
  lead: Kanban,
};

function Glyph({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === "activity") return <ActivityIcon type={entry.activityType ?? "TASK"} />;
  const Icon = KIND_ICON[entry.kind];
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-hairline bg-canvas text-ink-subtle">
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

export function CustomerTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
        Nothing logged yet. Calls, emails and meetings you log appear here alongside orders and
        tickets.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => {
        const title = entry.href ? (
          <Link href={entry.href} className="hover:text-accent-strong">
            {entry.title}
          </Link>
        ) : (
          entry.title
        );
        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < entries.length - 1 ? (
              <span className="absolute top-7 bottom-1 left-3 w-px bg-hairline" aria-hidden />
            ) : null}
            <Glyph entry={entry} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p
                  className={cn(
                    "min-w-0 text-body-sm text-ink",
                    entry.state === "done" && "text-ink-muted",
                  )}
                >
                  {title}
                  {entry.state === "overdue" ? (
                    <span className="ml-2 rounded-xs bg-danger-wash px-1.5 py-px font-mono text-[11px] text-danger">
                      overdue
                    </span>
                  ) : entry.state === "open" ? (
                    <span className="ml-2 rounded-xs bg-info-wash px-1.5 py-px font-mono text-[11px] text-info">
                      open
                    </span>
                  ) : null}
                </p>
                <time
                  dateTime={entry.at.toISOString()}
                  title={formatDateTime(entry.at)}
                  data-numeric
                  className="shrink-0 font-mono text-[11px] text-ink-subtle"
                >
                  {formatRelative(entry.at)}
                </time>
              </div>
              {entry.detail ? (
                <p className="mt-0.5 line-clamp-2 text-caption text-ink-subtle">{entry.detail}</p>
              ) : null}
              {entry.by ? <p className="text-caption text-ink-subtle">by {entry.by}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
