import type { Metadata } from "next";
import Link from "next/link";
import { BellOff } from "lucide-react";

import { ViewTabs } from "@/components/data-table/view-tabs";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  MarkAllReadButton,
  NotificationFeed,
} from "@/features/notifications/components/notification-feed";
import { listNotifications } from "@/features/notifications/queries";
import { notificationListSchema, type NotificationView } from "@/features/notifications/schemas";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Notifications" };

const VIEW_LABEL: Record<NotificationView, string> = {
  all: "All",
  unread: "Unread",
  stock: "Stock",
  work: "Tickets and tasks",
  purchasing: "Deliveries",
};

const EMPTY_COPY: Record<NotificationView, string> = {
  all: "Low stock, new tickets, overdue tasks and deliveries land here as they happen.",
  unread: "Everything has been read. New alerts will show up here first.",
  stock: "No stock alerts. One appears when a position crosses its reorder point.",
  work: "No tickets or overdue tasks for you right now.",
  purchasing: "No deliveries yet. Receiving a purchase order announces it here.",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requirePermission("notifications.viewOwn");
  const { view, page } = notificationListSchema.parse(await searchParams);
  const feed = await listNotifications(user.id, view, page);

  const href = (next: NotificationView, nextPage = 1) => {
    const params = new URLSearchParams();
    if (next !== "all") params.set("view", next);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    return query ? `/notifications?${query}` : "/notifications";
  };

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      <PageHeader
        title="Notifications"
        description="Alerts addressed to you: stock that needs attention, tickets to triage, tasks past due and deliveries that arrived."
        className="pb-0"
        actions={<MarkAllReadButton disabled={feed.counts.unread === 0} />}
      />

      <ViewTabs
        tabs={(Object.keys(VIEW_LABEL) as NotificationView[]).map((key) => ({
          label: VIEW_LABEL[key],
          href: href(key),
          active: key === view,
          count: feed.counts[key],
        }))}
      />

      {feed.total === 0 ? (
        <EmptyState
          icon={BellOff}
          title={view === "unread" ? "All caught up" : "Nothing here yet"}
          description={EMPTY_COPY[view]}
          action={
            view === "all" ? undefined : (
              <Button asChild variant="secondary">
                <Link href="/notifications">Show everything</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <NotificationFeed days={feed.days} />
          {feed.pageCount > 1 ? (
            <nav
              aria-label="Pages"
              className="flex items-center justify-end gap-1 text-body-sm text-ink-subtle"
            >
              {page > 1 ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={href(view, page - 1)}>Previous</Link>
                </Button>
              ) : null}
              <span className="px-2">
                <span data-numeric>{page}</span> of <span data-numeric>{feed.pageCount}</span>
              </span>
              {page < feed.pageCount ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={href(view, page + 1)}>Next</Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
