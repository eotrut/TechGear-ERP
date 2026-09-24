"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActivityStatus, ActivityType } from "@prisma/client";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { formatDateTime, formatTime, formatWeekday, manilaDayKey } from "@/lib/format";
import { cn } from "@/lib/utils";

import { completeActivityAction, reopenActivityAction } from "../actions";
import { ActivityIcon } from "./activity-icon";

/**
 * A list of activities with a tick box each. Ticking is optimistic: the row
 * strikes through at once and the server confirms behind it; a refusal puts
 * it back and says why. Somebody else's activity shows its owner and cannot
 * be ticked unless the viewer may manage other people's work.
 */

export type ActivityRowData = {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  subject: string;
  note: string | null;
  dueAt: string | null;
  completedAt: string | null;
  ownerId: string;
  ownerName: string;
  related?: { label: string; detail: string; href: string } | null;
};

function DueLabel({ activity, now }: { activity: ActivityRowData; now: number }) {
  if (activity.status === "DONE" && activity.completedAt) {
    return (
      <span data-numeric className="font-mono text-[11px] whitespace-nowrap text-ink-subtle">
        done {formatWeekday(activity.completedAt)}
      </span>
    );
  }
  if (!activity.dueAt) return <span className="text-caption text-ink-subtle">no date</span>;

  const due = new Date(activity.dueAt);
  const overdue = activity.status === "OPEN" && due.getTime() < now;
  const today = manilaDayKey(due) === manilaDayKey(new Date(now));
  return (
    <time
      dateTime={activity.dueAt}
      title={formatDateTime(due)}
      data-numeric
      className={cn(
        "font-mono text-[11px] whitespace-nowrap",
        overdue ? "font-medium text-danger" : today ? "text-ink" : "text-ink-subtle",
      )}
    >
      {today ? formatTime(due) : `${formatWeekday(due)}, ${formatTime(due)}`}
    </time>
  );
}

export function ActivityList({
  activities,
  currentUserId,
  canManageOthers,
  showOwner = false,
  showRelated = true,
  empty,
}: {
  activities: ActivityRowData[];
  currentUserId: string;
  canManageOthers: boolean;
  showOwner?: boolean;
  showRelated?: boolean;
  empty?: React.ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(
    activities,
    (current, change: { id: string; status: ActivityStatus }) =>
      current.map((activity) =>
        activity.id === change.id
          ? {
              ...activity,
              status: change.status,
              completedAt: change.status === "DONE" ? new Date().toISOString() : null,
            }
          : activity,
      ),
  );
  const now = Date.now();

  if (optimistic.length === 0) return <>{empty ?? null}</>;

  function toggle(activity: ActivityRowData) {
    const next: ActivityStatus = activity.status === "DONE" ? "OPEN" : "DONE";
    startTransition(async () => {
      setOptimistic({ id: activity.id, status: next });
      const result =
        next === "DONE"
          ? await completeActivityAction({ activityId: activity.id })
          : await reopenActivityAction({ activityId: activity.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <ul className="divide-y divide-hairline rounded-lg border border-hairline bg-canvas">
      {optimistic.map((activity) => {
        const done = activity.status === "DONE";
        const mine = activity.ownerId === currentUserId;
        const editable = activity.status !== "CANCELLED" && (mine || canManageOthers);
        return (
          <li
            key={activity.id}
            className="flex items-start gap-3 px-3 py-2.5"
            data-activity={activity.id}
          >
            <Checkbox
              className="mt-1"
              checked={done}
              disabled={!editable}
              onCheckedChange={() => toggle(activity)}
              aria-label={done ? `Reopen ${activity.subject}` : `Mark ${activity.subject} done`}
            />
            <ActivityIcon type={activity.type} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p
                  className={cn(
                    "min-w-0 text-body-sm text-ink",
                    done && "text-ink-subtle line-through decoration-ink-subtle/60",
                  )}
                >
                  {activity.subject}
                </p>
                <DueLabel activity={activity} now={now} />
              </div>
              {activity.note ? (
                <p className="mt-0.5 line-clamp-2 text-caption text-ink-subtle">{activity.note}</p>
              ) : null}
              {(showRelated && activity.related) || (showOwner && !mine) ? (
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-ink-subtle">
                  {showRelated && activity.related ? (
                    <Link
                      href={activity.related.href}
                      className="min-w-0 truncate hover:text-accent-strong"
                    >
                      <span className="font-mono text-[11px]">{activity.related.label}</span>
                      {activity.related.detail !== "Customer"
                        ? ` · ${activity.related.detail}`
                        : ""}
                    </Link>
                  ) : null}
                  {showOwner && !mine ? <span>{activity.ownerName}</span> : null}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
