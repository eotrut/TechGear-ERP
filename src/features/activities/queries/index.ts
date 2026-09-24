import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { manilaDayKey, startOfManilaDay } from "@/lib/format";

import type { ActivityFilters } from "../schemas";

/**
 * Activity reads: one person's task list, grouped by when things are due in
 * Manila, and the manager's view of everybody's, paginated on the server.
 */

export const ACTIVITY_PAGE_SIZE = 30;

const DAY_MS = 86_400_000;

const rowSelect = {
  id: true,
  type: true,
  status: true,
  subject: true,
  note: true,
  dueAt: true,
  completedAt: true,
  createdAt: true,
  ownerId: true,
  owner: { select: { name: true } },
  customer: { select: { id: true, displayName: true } },
  lead: { select: { id: true, code: true, title: true } },
  ticket: { select: { id: true, ticketNumber: true, subject: true } },
} satisfies Prisma.ActivitySelect;

type Row = Prisma.ActivityGetPayload<{ select: typeof rowSelect }>;

export type ActivityItem = {
  id: string;
  type: Row["type"];
  status: Row["status"];
  subject: string;
  note: string | null;
  dueAt: string | null;
  completedAt: string | null;
  ownerId: string;
  ownerName: string;
  overdue: boolean;
  related: { label: string; detail: string; href: string } | null;
};

function toItem(row: Row, now: number): ActivityItem {
  const related = row.ticket
    ? {
        label: row.ticket.ticketNumber,
        detail: row.ticket.subject,
        href: `/tickets/${row.ticket.id}`,
      }
    : row.lead
      ? { label: row.lead.code, detail: row.lead.title, href: `/leads/${row.lead.id}` }
      : row.customer
        ? {
            label: row.customer.displayName,
            detail: "Customer",
            href: `/customers/${row.customer.id}`,
          }
        : null;

  return {
    id: row.id,
    type: row.type,
    status: row.status,
    subject: row.subject,
    note: row.note,
    dueAt: row.dueAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    ownerId: row.ownerId,
    ownerName: row.owner.name,
    overdue: row.status === "OPEN" && row.dueAt !== null && row.dueAt.getTime() < now,
    related,
  };
}

export type TaskGroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "undated" | "done";

export type TaskGroup = { key: TaskGroupKey; label: string; items: ActivityItem[] };

const GROUP_LABEL: Record<TaskGroupKey, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Later this week",
  later: "Coming up",
  undated: "No due date",
  done: "Done in the last 7 days",
};

/**
 * "My tasks": what is open, bucketed by Manila calendar day, and what was
 * finished this week so ticking something off does not make it vanish.
 */
export async function myTasks(userId: string, at: Date = new Date()) {
  const now = at.getTime();
  const todayStart = startOfManilaDay(at);
  const [open, done] = await Promise.all([
    db.activity.findMany({
      where: { ownerId: userId, status: "OPEN" },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: rowSelect,
    }),
    db.activity.findMany({
      where: {
        ownerId: userId,
        status: "DONE",
        completedAt: { gte: new Date(todayStart.getTime() - 7 * DAY_MS) },
      },
      orderBy: { completedAt: "desc" },
      take: 25,
      select: rowSelect,
    }),
  ]);

  const today = manilaDayKey(at);
  const tomorrow = manilaDayKey(new Date(now + DAY_MS));
  // The working week ends on Sunday; "later this week" is up to and including it.
  const weekday = new Date(todayStart.getTime() + 8 * 3_600_000).getUTCDay();
  const endOfWeek = new Date(todayStart.getTime() + (7 - (weekday === 0 ? 7 : weekday)) * DAY_MS);
  const endOfWeekKey = manilaDayKey(endOfWeek);

  const groups = new Map<TaskGroupKey, ActivityItem[]>(
    (Object.keys(GROUP_LABEL) as TaskGroupKey[]).map((key) => [key, []]),
  );

  for (const row of open) {
    const item = toItem(row, now);
    let key: TaskGroupKey;
    if (!row.dueAt) key = "undated";
    else if (item.overdue) key = "overdue";
    else {
      const day = manilaDayKey(row.dueAt);
      key =
        day === today
          ? "today"
          : day === tomorrow
            ? "tomorrow"
            : day <= endOfWeekKey
              ? "week"
              : "later";
    }
    groups.get(key)?.push(item);
  }
  for (const row of done) groups.get("done")?.push(toItem(row, now));

  const list: TaskGroup[] = [...groups.entries()].map(([key, items]) => ({
    key,
    label: GROUP_LABEL[key],
    items,
  }));

  return {
    groups: list,
    counts: {
      open: open.length,
      overdue: groups.get("overdue")?.length ?? 0,
      today: groups.get("today")?.length ?? 0,
      doneThisWeek: groups.get("done")?.length ?? 0,
    },
  };
}

// ---------------------------------------------------------------- all of them

function whereFor(filters: ActivityFilters, at: Date): Prisma.ActivityWhereInput {
  const where: Prisma.ActivityWhereInput = {};
  if (filters.owner) where.ownerId = filters.owner;
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    where.OR = [
      { subject: { contains: filters.search, mode: "insensitive" } },
      { customer: { displayName: { contains: filters.search, mode: "insensitive" } } },
      { lead: { code: { equals: filters.search.toUpperCase() } } },
      { ticket: { ticketNumber: { equals: filters.search.toUpperCase() } } },
    ];
  }
  const todayStart = startOfManilaDay(at);
  if (filters.due === "overdue") {
    where.status = "OPEN";
    where.dueAt = { lt: at };
  } else if (filters.due === "today") {
    where.dueAt = { gte: todayStart, lt: new Date(todayStart.getTime() + DAY_MS) };
  } else if (filters.due === "week") {
    where.dueAt = { gte: todayStart, lt: new Date(todayStart.getTime() + 7 * DAY_MS) };
  }
  return where;
}

export async function listActivities(filters: ActivityFilters, at: Date = new Date()) {
  const where = whereFor(filters, at);
  const [total, rows, overdue] = await Promise.all([
    db.activity.count({ where }),
    db.activity.findMany({
      where,
      // Open work first, soonest due at the top; finished work after it, newest first.
      orderBy: [
        { status: "asc" },
        { dueAt: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      skip: (filters.page - 1) * ACTIVITY_PAGE_SIZE,
      take: ACTIVITY_PAGE_SIZE,
      select: rowSelect,
    }),
    db.activity.count({ where: { status: "OPEN", dueAt: { lt: at } } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const now = at.getTime();
  return {
    total,
    page: Math.min(filters.page, pageCount),
    pageCount,
    overdue,
    rows: rows.map((row) => toItem(row, now)),
  };
}

/** People an activity can be given to, for the owner select. */
export async function activityOwners() {
  return db.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
