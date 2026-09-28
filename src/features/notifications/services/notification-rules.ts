import type { NotificationType } from "@prisma/client";

import type { Permission } from "@/lib/rbac/matrix";

/**
 * Who hears about what. Pure, so the seed, the services and the tests share it.
 *
 * An audience is a permission, never a role: a notification goes to whoever
 * can act on it, and the matrix stays the only place a role is named. A null
 * audience means the notification is personal and the caller names the
 * recipient (the owner of an overdue task, the assignee of a new ticket).
 */
export const AUDIENCE: Record<NotificationType, Permission | null> = {
  LOW_STOCK: "inventory.viewAlerts",
  OUT_OF_STOCK: "inventory.viewAlerts",
  // Triage belongs to whoever assigns the queue; the assignee is added by name.
  NEW_TICKET: "tickets.assign",
  // Stock arriving is a bill about to land, so it goes to the people who pay.
  PO_RECEIVED: "bills.manage",
  WARRANTY_CLAIM: "warranty.review",
  OVERDUE_TASK: null,
  ORDER_PLACED: null,
};

/** How the centre groups types for its filter tabs. */
export const NOTIFICATION_GROUP: Record<NotificationType, "stock" | "work" | "purchasing"> = {
  LOW_STOCK: "stock",
  OUT_OF_STOCK: "stock",
  NEW_TICKET: "work",
  OVERDUE_TASK: "work",
  WARRANTY_CLAIM: "work",
  ORDER_PLACED: "work",
  PO_RECEIVED: "purchasing",
};

/**
 * An overdue task is raised once per task. The key is what the unique index
 * on (userId, dedupeKey) holds, so a second sweep is a no-op, even two sweeps
 * racing each other from two open tabs.
 */
export function overdueTaskKey(activityId: string): string {
  return `activity:${activityId}:overdue`;
}

/** The bell shows a number up to 99, then "99+", so the badge never widens. */
export function unreadBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
