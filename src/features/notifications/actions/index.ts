"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { db } from "@/lib/db";
import { authorizeAction } from "@/lib/rbac/guard";

import { notificationSummary, type NotificationSummary } from "../queries";
import { notificationIdSchema } from "../schemas";

/**
 * The bell's reads and the two ways to clear it. Every write is scoped by the
 * caller's id in the WHERE clause itself, so another person's notification id
 * matches nothing rather than needing a separate ownership check.
 */

export async function notificationSummaryAction(): Promise<NotificationSummary> {
  const { user } = await authorizeAction("notifications.viewOwn");
  return notificationSummary(user.id);
}

export async function markNotificationReadAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("notifications.viewOwn");
  const parsed = notificationIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That notification could not be read." };

  await db.notification.updateMany({
    where: { id: parsed.data.id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<ActionResult> {
  const { user } = await authorizeAction("notifications.viewOwn");
  const { count } = await db.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
  return {
    ok: true,
    message:
      count === 0
        ? "Nothing was unread."
        : `Marked ${count} notification${count === 1 ? "" : "s"} as read.`,
  };
}
