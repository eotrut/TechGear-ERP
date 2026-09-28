import type { NotificationType, Prisma, PrismaClient } from "@prisma/client";

import { formatDateTime } from "@/lib/format";
import { rolesWith } from "@/lib/rbac/can";

import { AUDIENCE, overdueTaskKey } from "./notification-rules";

/**
 * Writing notifications. Every notification is one row per recipient, so
 * reading one is personal: a shared row would let the first manager to open it
 * mark it read for every other manager.
 *
 * Call `notify` inside the transaction that did the thing, with `tx`, so a
 * rolled-back receipt never announces stock that did not arrive.
 */

type Client = Prisma.TransactionClient | PrismaClient;

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  /** People to reach by name, on top of the type's audience. */
  userIds?: (string | null | undefined)[];
  /** Usually the actor: nobody needs telling about what they just did. */
  excludeUserId?: string | null;
  dedupeKey?: string;
  createdAt?: Date;
};

export async function notify(client: Client, input: NotifyInput): Promise<number> {
  const permission = AUDIENCE[input.type];
  const roles = permission ? rolesWith(permission) : [];
  const named = (input.userIds ?? []).filter((id): id is string => Boolean(id));
  if (roles.length === 0 && named.length === 0) return 0;

  const recipients = await client.user.findMany({
    where: {
      isActive: true,
      OR: [{ role: { in: roles } }, { id: { in: named } }],
      ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
    },
    select: { id: true, role: true },
  });
  if (recipients.length === 0) return 0;

  const result = await client.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      // Recorded so the centre can say why it reached you.
      targetRole: roles.includes(user.role) ? user.role : null,
      type: input.type,
      title: input.title,
      body: input.body,
      link: input.link,
      dedupeKey: input.dedupeKey ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Nothing happens at the moment a task goes overdue, so there is no
 * transaction to notify from. Instead the centre sweeps the reader's own open
 * tasks whenever it is read. The dedupe key makes the sweep idempotent: each
 * task raises one notification, ever, however often the bell is opened.
 */
export async function raiseOverdueTasks(
  client: Client,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const overdue = await client.activity.findMany({
    where: { ownerId: userId, status: "OPEN", dueAt: { lt: now } },
    orderBy: { dueAt: "desc" },
    take: 50,
    select: { id: true, subject: true, dueAt: true },
  });
  if (overdue.length === 0) return 0;

  const result = await client.notification.createMany({
    data: overdue.map((task) => ({
      userId,
      targetRole: null,
      type: "OVERDUE_TASK" as const,
      title: `Overdue: ${task.subject}`,
      body: `This was due ${formatDateTime(task.dueAt ?? now)}.`,
      link: "/activities/mine",
      dedupeKey: overdueTaskKey(task.id),
      // Dated when it fell due, so the centre orders it with everything else.
      createdAt: task.dueAt ?? now,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
