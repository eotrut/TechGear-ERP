"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  notificationSummaryAction,
} from "../actions";
import type { NotificationItem, NotificationSummary } from "../queries";

export const NOTIFICATIONS_KEY = ["notifications"] as const;

/**
 * The bell's data. Seeded from the layout's server read so the badge is right
 * on first paint, then polled once a minute and refetched when the window
 * regains focus, which is how a new ticket reaches a manager who never
 * reloads.
 */
export function useNotifications(initial: NotificationSummary) {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => notificationSummaryAction(),
    initialData: initial,
    refetchInterval: 60_000,
  });
}

/**
 * Reading one. The badge drops at once rather than on the next poll; the
 * server write is scoped to the caller, so the optimistic update can only
 * ever be undone by a refetch, never contradicted.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();

  const markOne = useCallback(
    (item: NotificationItem) => {
      if (item.read) return;
      queryClient.setQueryData<NotificationSummary>(NOTIFICATIONS_KEY, (current) =>
        current
          ? {
              unread: Math.max(0, current.unread - 1),
              items: current.items.map((row) =>
                row.id === item.id ? { ...row, read: true } : row,
              ),
            }
          : current,
      );
      void markNotificationReadAction({ id: item.id }).then(() =>
        queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
      );
    },
    [queryClient],
  );

  const markAll = useCallback(async () => {
    const result = await markAllNotificationsReadAction();
    await queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    return result;
  }, [queryClient]);

  return { markOne, markAll };
}
