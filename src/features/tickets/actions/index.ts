"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { can, scopeFor } from "@/lib/rbac/can";
import { authorizeAction } from "@/lib/rbac/guard";

import { searchProductVariants, type VariantOption } from "../queries";
import {
  assignTicketSchema,
  commentSchema,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  ticketFormSchema,
  ticketPrioritySchema,
  ticketStatusSchema,
  variantSearchSchema,
} from "../schemas";
import {
  addComment,
  assignTicket,
  changeTicketStatus,
  createTicket,
  setTicketPriority,
} from "../services/tickets";

/**
 * Ticket mutations. Resolving, closing and reopening are `tickets.resolve`,
 * "own" for Sales; the service decides which a move is from the locked row
 * and checks the assignee there.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Ticket action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

function revalidateTicket(ticketId: string, customerId?: string) {
  revalidatePath("/tickets");
  revalidatePath(`/tickets/${ticketId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createTicketAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("tickets.comment");

  const parsed = ticketFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const ticket = await db.$transaction(async (tx) => {
      const created = await createTicket(tx, parsed.data, {
        id: user.id,
        canAssign: can(user.role, "tickets.assign"),
      });
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Ticket",
        entityId: created.id,
        summary: `Opened ${created.ticketNumber} (${TICKET_PRIORITY_LABEL[parsed.data.priority]}): ${parsed.data.subject}`,
        tx,
      });
      return created;
    });

    revalidateTicket(ticket.id, ticket.customerId);
    return {
      ok: true,
      id: ticket.id,
      message: `${ticket.ticketNumber} opened. Due by ${formatDateTime(ticket.slaDueAt)}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function addCommentAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("tickets.comment");

  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  if (parsed.data.internal) await authorizeAction("tickets.internalNote");

  try {
    const result = await db.$transaction(async (tx) => {
      const comment = await addComment(tx, parsed.data, { id: user.id });
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Ticket",
        entityId: parsed.data.ticketId,
        summary: parsed.data.internal
          ? `Added an internal note to ${comment.ticketNumber}.`
          : `Replied on ${comment.ticketNumber}${comment.firstResponse ? " (first response)" : ""}.`,
        tx,
      });
      return comment;
    });

    revalidateTicket(parsed.data.ticketId, result.customerId);
    return { ok: true, message: parsed.data.internal ? "Note added." : "Reply posted." };
  } catch (error) {
    return fail(error);
  }
}

export async function changeTicketStatusAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("tickets.comment");

  const parsed = ticketStatusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await db.$transaction(async (tx) => {
      const change = await changeTicketStatus(tx, parsed.data.ticketId, parsed.data.status, {
        id: user.id,
        resolveScope: scopeFor(user.role, "tickets.resolve"),
      });
      if (change.changed) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "STATUS_CHANGE",
          entityType: "Ticket",
          entityId: change.id,
          summary: `Moved ${change.ticketNumber} from ${TICKET_STATUS_LABEL[change.from]} to ${
            TICKET_STATUS_LABEL[change.to]
          }.`,
          changes: { status: { from: change.from, to: change.to } },
          tx,
        });
      }
      return change;
    });

    revalidateTicket(result.id, result.customerId);
    return {
      ok: true,
      message: `${result.ticketNumber} is ${TICKET_STATUS_LABEL[result.to].toLowerCase()}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function assignTicketAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("tickets.assign");

  const parsed = assignTicketSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  const assigneeId = parsed.data.assigneeId === "" ? null : parsed.data.assigneeId;

  try {
    const result = await db.$transaction(async (tx) => {
      const change = await assignTicket(tx, parsed.data.ticketId, assigneeId);
      if (change.changed) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entityType: "Ticket",
          entityId: change.id,
          summary: change.assigneeName
            ? `Assigned ${change.ticketNumber} to ${change.assigneeName}.`
            : `Unassigned ${change.ticketNumber}.`,
          changes: { assigneeId: { from: change.assigneeId, to: assigneeId } },
          tx,
        });
      }
      return change;
    });

    revalidateTicket(result.id, result.customerId);
    return {
      ok: true,
      message: result.assigneeName
        ? `Assigned to ${result.assigneeName}.`
        : result.changed
          ? "Unassigned."
          : "No change.",
    };
  } catch (error) {
    return fail(error);
  }
}

export async function setTicketPriorityAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("tickets.assign");

  const parsed = ticketPrioritySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await db.$transaction(async (tx) => {
      const change = await setTicketPriority(tx, parsed.data.ticketId, parsed.data.priority);
      if (change.changed) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entityType: "Ticket",
          entityId: change.id,
          summary: `Set ${change.ticketNumber} to ${TICKET_PRIORITY_LABEL[parsed.data.priority]} priority${
            change.slaDueAt ? `, now due ${formatDateTime(change.slaDueAt)}` : ""
          }.`,
          changes: { priority: { from: change.priority, to: parsed.data.priority } },
          tx,
        });
      }
      return change;
    });

    revalidateTicket(result.id, result.customerId);
    return {
      ok: true,
      message: result.slaDueAt
        ? `Priority changed. Now due ${formatDateTime(result.slaDueAt)}.`
        : "Priority changed.",
    };
  } catch (error) {
    return fail(error);
  }
}

export async function searchVariantsForTicketAction(
  input: unknown,
): Promise<{ ok: true; results: VariantOption[] } | { ok: false; error: string }> {
  await authorizeAction("tickets.comment");
  const parsed = variantSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Search could not be read." };
  return { ok: true, results: await searchProductVariants(parsed.data.query) };
}
