import type { Metadata } from "next";
import { CalendarCheck } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { ActivityList } from "@/features/activities/components/activity-list";
import { LogActivityDialog } from "@/features/activities/components/log-activity-dialog";
import { activityOwners, myTasks } from "@/features/activities/queries";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My tasks" };

export default async function MyTasksPage() {
  const { user } = await requirePermission("activities.manageOwn");
  const canAssign = can(user.role, "activities.assignToOthers");
  const [tasks, owners] = await Promise.all([
    myTasks(user.id),
    canAssign ? activityOwners() : Promise.resolve(undefined),
  ]);

  const groups = tasks.groups.filter((group) => group.items.length > 0);
  const nothingAtAll = tasks.counts.open === 0 && tasks.counts.doneThisWeek === 0;

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5">
      <PageHeader
        title="My tasks"
        description="Calls, emails, meetings and to-dos assigned to you, grouped by when they fall due in Manila."
        className="pb-0"
        actions={<LogActivityDialog currentUserId={user.id} owners={owners} title="New activity" />}
      />

      <StatStrip
        stats={[
          {
            label: "Overdue",
            value: String(tasks.counts.overdue),
            tone: tasks.counts.overdue > 0 ? "critical" : "default",
            hint: tasks.counts.overdue > 0 ? "clear these first" : "nothing late",
          },
          { label: "Due today", value: String(tasks.counts.today) },
          { label: "Open", value: String(tasks.counts.open), hint: "everything not yet done" },
          { label: "Done this week", value: String(tasks.counts.doneThisWeek) },
        ]}
      />

      {nothingAtAll ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nothing on your list"
          description="Log a call after you make it, or schedule the next one, and it shows up here on the day it is due."
        />
      ) : (
        groups.map((group) => (
          <section key={group.key} aria-labelledby={`group-${group.key}`}>
            <h2
              id={`group-${group.key}`}
              className={cn(
                "mb-2 flex items-baseline gap-2 text-body font-semibold",
                group.key === "overdue" ? "text-danger" : "text-ink",
              )}
            >
              {group.label}
              <span data-numeric className="font-mono text-[12px] font-normal text-ink-subtle">
                {group.items.length}
              </span>
            </h2>
            <ActivityList
              activities={group.items}
              currentUserId={user.id}
              canManageOthers={canAssign}
            />
          </section>
        ))
      )}
    </div>
  );
}
