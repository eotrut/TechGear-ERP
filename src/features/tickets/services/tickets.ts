import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client";

import { notify } from "@/features/notifications/services/notify";
import { DomainError, InvalidTransitionError, NotFoundError } from "@/lib/errors";
import { nextReference } from "@/lib/numbering";
import { can } from "@/lib/rbac/can";
import type { Access } from "@/lib/rbac/matrix";
import { assertTransition, type TransitionMap } from "@/lib/transitions";
import { emptyToNull } from "@/lib/validation";

import type { TicketFormValues } from "../schemas";
import { canReopenClosed, REOPEN_WINDOW_DAYS, SLA_HOURS, addBusinessHours } from "./sla";

/**
 * Support tickets, docs/PLAN.md section 5.4.
 *
 *   OPEN             -> IN_PROGRESS, WAITING_CUSTOMER, RESOLVED, CLOSED
 *   IN_PROGRESS      -> WAITING_CUSTOMER, RESOLVED, OPEN
 *   WAITING_CUSTOMER -> IN_PROGRESS, RESOLVED, CLOSED
 *   RESOLVED         -> CLOSED, OPEN
 *   CLOSED           -> OPEN (within seven days)
 *
 * The SLA is a resolution target in business hours, set from the priority when
 * the ticket is opened and reset when it is reopened. First response is
 * stamped by the first reply the customer can see, never by an internal note
 * and never by a status change: moving a ticket to In progress is not talking
 * to the customer.
 */

type Tx = Prisma.TransactionClient;

export const TICKET_TRANSITIONS: TransitionMap<TicketStatus> = {
  OPEN: ["IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING_CUSTOMER", "RESOLVED", "OPEN"],
  WAITING_CUSTOMER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "OPEN"],
  CLOSED: ["OPEN"],
};

const FINISHED: TicketStatus[] = ["RESOLVED", "CLOSED"];

/**
 * Resolving, closing and reopening are `tickets.resolve`, which Sales holds as
 * "own": only on tickets assigned to them. Working a ticket in between is
 * `tickets.comment`.
 */
export function needsResolvePermission(from: TicketStatus, to: TicketStatus): boolean {
  return FINISHED.includes(to) || FINISHED.includes(from);
}

type LockedTicket = {
  id: string;
  ticketNumber: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  customerId: string;
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
};

async function lockTicket(tx: Tx, ticketId: string): Promise<LockedTicket> {
  const [row] = await tx.$queryRaw<LockedTicket[]>`
    SELECT id, "ticketNumber", status, priority, "assigneeId", "customerId", "createdAt",
           "firstResponseAt", "resolvedAt", "closedAt"
    FROM "Ticket"
    WHERE id = ${ticketId}
    FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That ticket no longer exists.");
  return row;
}

async function assertAssignee(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) throw new DomainError("That person is not an active user.");
  if (!can(user.role, "tickets.view")) {
    throw new DomainError(`${user.name} does not work the support queue.`);
  }
  return user;
}

// ------------------------------------------------------------------- create

export async function createTicket(
  tx: Tx,
  values: TicketFormValues,
  actor: { id: string; canAssign: boolean },
) {
  const customer = await tx.customer.findFirst({
    where: { id: values.customerId, deletedAt: null },
    select: { id: true, displayName: true },
  });
  if (!customer) throw new NotFoundError("That customer no longer exists.");

  const orderId = emptyToNull(values.orderId);
  if (orderId) {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { customerId: true },
    });
    if (!order || order.customerId !== customer.id) {
      throw new DomainError(`That order is not one of ${customer.displayName}'s.`);
    }
  }

  const variantId = emptyToNull(values.variantId);
  if (variantId) {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant) throw new NotFoundError("That product variant no longer exists.");
  }

  // Somebody who cannot assign owns what they open, so it lands in "Mine" and
  // they can resolve it; a manager may hand it straight to someone.
  let assigneeId: string | null = actor.id;
  if (actor.canAssign) {
    assigneeId = emptyToNull(values.assigneeId);
    if (assigneeId) await assertAssignee(tx, assigneeId);
  }

  const now = new Date();
  const ticketNumber = await nextReference(tx, "TKT", now);
  const ticket = await tx.ticket.create({
    data: {
      ticketNumber,
      subject: values.subject,
      description: values.description,
      priority: values.priority,
      status: "OPEN",
      customerId: customer.id,
      orderId,
      variantId,
      assigneeId,
      slaDueAt: addBusinessHours(now, SLA_HOURS[values.priority]),
      createdAt: now,
    },
    select: { id: true, ticketNumber: true, slaDueAt: true, customerId: true },
  });

  await notify(tx, {
    type: "NEW_TICKET",
    title: `New ticket: ${ticketNumber}`,
    body: `${values.subject}, from ${customer.displayName}.`,
    link: `/tickets/${ticket.id}`,
    userIds: [assigneeId],
    excludeUserId: actor.id,
  });
  return ticket;
}

// ------------------------------------------------------------------ comment

export async function addComment(
  tx: Tx,
  input: { ticketId: string; body: string; internal: boolean },
  actor: { id: string },
) {
  const ticket = await lockTicket(tx, input.ticketId);
  if (ticket.status === "CLOSED") {
    throw new DomainError(`${ticket.ticketNumber} is closed. Reopen it to add to the thread.`);
  }

  const comment = await tx.ticketComment.create({
    data: {
      ticketId: ticket.id,
      authorId: actor.id,
      body: input.body,
      isInternal: input.internal,
    },
    select: { id: true, createdAt: true },
  });

  const firstResponse = !input.internal && ticket.firstResponseAt === null;
  await tx.ticket.update({
    where: { id: ticket.id },
    data: firstResponse ? { firstResponseAt: comment.createdAt } : {},
    select: { id: true },
  });

  return { ticketNumber: ticket.ticketNumber, customerId: ticket.customerId, firstResponse };
}

// ------------------------------------------------------------------- status

export async function changeTicketStatus(
  tx: Tx,
  ticketId: string,
  to: TicketStatus,
  actor: { id: string; resolveScope: Access | null },
) {
  const ticket = await lockTicket(tx, ticketId);
  const from = ticket.status;
  if (from === to) return { ...ticket, from, to, changed: false };

  assertTransition(TICKET_TRANSITIONS, "Ticket", from, to);

  if (needsResolvePermission(from, to)) {
    if (!actor.resolveScope) {
      throw new DomainError("Resolving, closing and reopening tickets needs a manager.");
    }
    if (actor.resolveScope === "own" && ticket.assigneeId !== actor.id) {
      throw new DomainError(
        `${ticket.ticketNumber} is not assigned to you, so you cannot ${
          to === "OPEN" ? "reopen" : to === "CLOSED" ? "close" : "resolve"
        } it.`,
      );
    }
  }

  const now = new Date();
  if (from === "CLOSED" && to === "OPEN" && !canReopenClosed(ticket.closedAt, now)) {
    throw new InvalidTransitionError(
      "Ticket",
      from,
      to,
      `${ticket.ticketNumber} was closed more than ${REOPEN_WINDOW_DAYS} days ago. Open a new ticket and link the order instead.`,
    );
  }

  const data: Prisma.TicketUpdateInput = { status: to };
  if (to === "RESOLVED") data.resolvedAt = now;
  if (to === "CLOSED") {
    data.closedAt = now;
    // Closed without a resolution step (a duplicate, or no reply) still ends
    // the clock, so the SLA reads as met or missed rather than running forever.
    if (!ticket.resolvedAt) data.resolvedAt = now;
  }
  if (to === "OPEN" && FINISHED.includes(from)) {
    data.resolvedAt = null;
    data.closedAt = null;
    // A reopened ticket gets a fresh target from now, not one already blown.
    data.slaDueAt = addBusinessHours(now, SLA_HOURS[ticket.priority]);
  }

  await tx.ticket.update({ where: { id: ticket.id }, data, select: { id: true } });
  return { ...ticket, from, to, changed: true };
}

// --------------------------------------------------------- assign, priority

export async function assignTicket(tx: Tx, ticketId: string, assigneeId: string | null) {
  const ticket = await lockTicket(tx, ticketId);
  if (ticket.assigneeId === assigneeId) return { ...ticket, changed: false, assigneeName: null };
  const assignee = assigneeId ? await assertAssignee(tx, assigneeId) : null;
  await tx.ticket.update({ where: { id: ticketId }, data: { assigneeId }, select: { id: true } });
  return { ...ticket, changed: true, assigneeName: assignee?.name ?? null };
}

/**
 * Changing priority moves the target, measured from when the ticket was
 * opened: raising a day-old ticket to Urgent makes it breached at once, which
 * is the honest reading. A finished ticket keeps the target it was judged by.
 */
export async function setTicketPriority(tx: Tx, ticketId: string, priority: TicketPriority) {
  const ticket = await lockTicket(tx, ticketId);
  if (ticket.priority === priority) return { ...ticket, changed: false, slaDueAt: null };
  const slaDueAt = FINISHED.includes(ticket.status)
    ? null
    : addBusinessHours(ticket.createdAt, SLA_HOURS[priority]);
  await tx.ticket.update({
    where: { id: ticketId },
    data: { priority, ...(slaDueAt ? { slaDueAt } : {}) },
    select: { id: true },
  });
  return { ...ticket, changed: true, slaDueAt };
}
