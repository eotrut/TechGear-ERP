import type { NotificationType, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { formatDate, formatRelative, manilaDayKey } from "@/lib/format";

import type { NotificationView } from "../schemas";
import { NOTIFICATION_GROUP } from "../services/notification-rules";
import { raiseOverdueTasks } from "../services/notify";

/**
 * Read paths for the bell and the centre. Always scoped to one recipient:
 * `notifications.viewOwn` is "own" for every role, and a user id is the only
 * way in.
 *
 * Relative ages are computed here, on the server, and sent as text, so the
 * client never renders "now" and never hydrates with a different minute.
 */

export type NotificationItem = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
  age: string;
};

const SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  link: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type Row = Prisma.NotificationGetPayload<{ select: typeof SELECT }>;

function toItem(row: Row): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
    age: formatRelative(row.createdAt),
  };
}

const TYPES_IN_GROUP = (group: "stock" | "work" | "purchasing"): NotificationType[] =>
  (Object.keys(NOTIFICATION_GROUP) as NotificationType[]).filter(
    (type) => NOTIFICATION_GROUP[type] === group,
  );

function whereFor(userId: string, view: NotificationView): Prisma.NotificationWhereInput {
  if (view === "all") return { userId };
  if (view === "unread") return { userId, readAt: null };
  return { userId, type: { in: TYPES_IN_GROUP(view) } };
}

export type NotificationSummary = { unread: number; items: NotificationItem[] };

/** What the bell shows: the unread count and the latest few. */
export async function notificationSummary(userId: string): Promise<NotificationSummary> {
  await raiseOverdueTasks(db, userId);
  const [unread, rows] = await Promise.all([
    db.notification.count({ where: { userId, readAt: null } }),
    db.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      select: SELECT,
    }),
  ]);
  return { unread, items: rows.map(toItem) };
}

/** Just the count, for the badge on first paint. */
export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export const NOTIFICATIONS_PAGE_SIZE = 30;

export type NotificationDay = { key: string; label: string; items: NotificationItem[] };

/** The centre: one view, one page, grouped by Manila day. */
export async function listNotifications(
  userId: string,
  view: NotificationView,
  page: number,
): Promise<{
  days: NotificationDay[];
  total: number;
  pageCount: number;
  counts: Record<NotificationView, number>;
}> {
  await raiseOverdueTasks(db, userId);
  const where = whereFor(userId, view);

  const [rows, total, all, unread, byType] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
      take: NOTIFICATIONS_PAGE_SIZE,
      select: SELECT,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId } }),
    db.notification.count({ where: { userId, readAt: null } }),
    db.notification.groupBy({ by: ["type"], where: { userId }, _count: { _all: true } }),
  ]);

  const counts: Record<NotificationView, number> = {
    all,
    unread,
    stock: 0,
    work: 0,
    purchasing: 0,
  };
  for (const row of byType) counts[NOTIFICATION_GROUP[row.type]] += row._count._all;

  const todayKey = manilaDayKey(new Date());
  const yesterdayKey = manilaDayKey(new Date(Date.now() - 86_400_000));
  const days: NotificationDay[] = [];
  for (const row of rows) {
    const key = manilaDayKey(row.createdAt);
    let day = days.at(-1);
    if (!day || day.key !== key) {
      const label =
        key === todayKey ? "Today" : key === yesterdayKey ? "Yesterday" : formatDate(row.createdAt);
      day = { key, label, items: [] };
      days.push(day);
    }
    day.items.push(toItem(row));
  }

  return {
    days,
    total,
    pageCount: Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)),
    counts,
  };
}
