"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

import type { NotificationSummary } from "../queries";
import { unreadBadge } from "../services/notification-rules";
import { NotificationRow } from "./notification-row";
import { useMarkRead, useNotifications } from "./use-notifications";

/**
 * The bell in the top bar and its tray: the latest eight, a way to clear
 * them, and the way into the full centre. Opening it refetches, so what you
 * see is what is there now, not what was there at the last poll.
 */
export function NotificationBell({ initial }: { initial: NotificationSummary }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { data, isFetching, refetch } = useNotifications(initial);
  const { markOne, markAll } = useMarkRead();

  const badge = unreadBadge(data.unread);
  const label =
    data.unread === 0 ? "Notifications, none unread" : `Notifications, ${data.unread} unread`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refetch();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={label}>
          <Bell aria-hidden />
          {badge ? (
            <span
              data-numeric
              className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-xs bg-accent-fill px-1 font-mono text-[10px] leading-none font-semibold text-accent-on-fill ring-2 ring-canvas"
              aria-hidden
            >
              {badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="flex w-[380px] max-w-[calc(100vw-1rem)] flex-col"
        aria-label="Notifications"
      >
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-3 py-2.5">
          <h2 className="text-body font-semibold text-ink">
            Notifications
            {data.unread > 0 ? (
              <span className="ml-2 font-mono text-caption font-normal text-ink-subtle">
                {data.unread} unread
              </span>
            ) : null}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={data.unread === 0 || isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await markAll();
                if (result.ok) toast.success(result.message ?? "All caught up.");
                else toast.error(result.error);
              })
            }
          >
            <CheckCheck aria-hidden />
            {isPending ? "Marking" : "Mark all read"}
          </Button>
        </div>

        <div
          className="max-h-[min(460px,calc(100dvh-10rem))] overflow-y-auto"
          aria-busy={isFetching}
        >
          {data.items.length === 0 ? (
            isFetching ? (
              <div className="flex flex-col gap-3 p-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="flex gap-3">
                    <Skeleton className="size-7" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-3/5" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center px-6 py-9 text-center">
                <span className="mb-3 inline-flex size-9 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
                  <BellOff className="size-4" aria-hidden />
                </span>
                <p className="text-body-sm font-medium text-ink">Nothing yet</p>
                <p className="mt-1 max-w-[36ch] text-caption text-ink-subtle">
                  Low stock, new tickets, overdue tasks and deliveries will show up here.
                </p>
              </div>
            )
          ) : (
            <ul className="divide-y divide-hairline">
              {data.items.map((item) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    dense
                    onOpen={(row) => {
                      markOne(row);
                      setOpen(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-hairline p-1.5">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex h-8 items-center justify-center rounded-md text-body-sm text-accent-strong transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-fill"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
