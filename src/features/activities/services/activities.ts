import type { ActivityStatus, Prisma } from "@prisma/client";

import { DomainError, NotFoundError } from "@/lib/errors";
import { parseManilaDateTime } from "@/lib/format";
import { can } from "@/lib/rbac/can";
import { emptyToNull } from "@/lib/validation";

import type { ActivityFormValues } from "../schemas";

/**
 * Activities: the calls, emails, meetings and tasks people log against a
 * customer, a lead or a ticket, or just for themselves.
 *
 * Everyone manages their own. Assigning to somebody else, and so acting on
 * somebody else's, is its own permission; the caller passes whether it holds
 * it, and the owner check happens here against the row as it is now.
 */

type Tx = Prisma.TransactionClient;
type Actor = { id: string; canAssign: boolean };

async function assertOwnerCandidate(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw new DomainError("That person is not an active user.");
  if (!can(user.role, "activities.manageOwn")) {
    throw new DomainError(`${user.name} cannot be given activities.`);
  }
}

/**
 * The record an activity hangs off. A lead or a ticket implies its customer,
 * so the customer link is filled in from them and the customer timeline picks
 * the activity up without anybody choosing the customer twice.
 */
async function resolveLinks(tx: Tx, values: ActivityFormValues) {
  let customerId = emptyToNull(values.customerId);
  const leadId = emptyToNull(values.leadId);
  const ticketId = emptyToNull(values.ticketId);

  if (leadId) {
    const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { customerId: true } });
    if (!lead) throw new NotFoundError("That lead no longer exists.");
    customerId = customerId ?? lead.customerId;
  }
  if (ticketId) {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { customerId: true },
    });
    if (!ticket) throw new NotFoundError("That ticket no longer exists.");
    customerId = customerId ?? ticket.customerId;
  }
  if (customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError("That customer no longer exists.");
  }
  return { customerId, leadId, ticketId };
}

export async function createActivity(tx: Tx, values: ActivityFormValues, actor: Actor) {
  const ownerId = values.ownerId !== "" ? values.ownerId : actor.id;
  if (ownerId !== actor.id) {
    if (!actor.canAssign) {
      throw new DomainError("Only a manager can give an activity to somebody else.");
    }
    await assertOwnerCandidate(tx, ownerId);
  }

  const links = await resolveLinks(tx, values);
  const dueAt = values.dueAt === "" ? null : parseManilaDateTime(values.dueAt);
  const now = new Date();

  return tx.activity.create({
    data: {
      type: values.type,
      subject: values.subject,
      note: emptyToNull(values.note),
      dueAt,
      status: values.done ? "DONE" : "OPEN",
      completedAt: values.done ? now : null,
      ownerId,
      ...links,
    },
    select: {
      id: true,
      subject: true,
      ownerId: true,
      customerId: true,
      leadId: true,
      ticketId: true,
    },
  });
}

const NEXT_STATUS: Record<"complete" | "reopen" | "cancel", ActivityStatus> = {
  complete: "DONE",
  reopen: "OPEN",
  cancel: "CANCELLED",
};

/**
 * Tick an activity off, untick it, or drop it. Row-locked so a double click
 * cannot stamp two completion times.
 */
export async function setActivityStatus(
  tx: Tx,
  activityId: string,
  change: "complete" | "reopen" | "cancel",
  actor: Actor,
) {
  const [row] = await tx.$queryRaw<
    { id: string; ownerId: string; status: ActivityStatus; subject: string }[]
  >`SELECT id, "ownerId", status, subject FROM "Activity" WHERE id = ${activityId} FOR UPDATE`;
  if (!row) throw new NotFoundError("That activity no longer exists.");

  if (row.ownerId !== actor.id && !actor.canAssign) {
    throw new DomainError("That activity belongs to somebody else.");
  }

  const to = NEXT_STATUS[change];
  if (row.status === to) return { ...row, from: row.status, to, changed: false };
  if (change === "complete" && row.status === "CANCELLED") {
    throw new DomainError("A cancelled activity cannot be completed. Reopen it first.");
  }

  const updated = await tx.activity.update({
    where: { id: activityId },
    data: { status: to, completedAt: to === "DONE" ? new Date() : null },
    select: { customerId: true, leadId: true, ticketId: true },
  });
  return { ...row, ...updated, from: row.status, to, changed: true };
}
