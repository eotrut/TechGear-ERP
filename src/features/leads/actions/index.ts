"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { diffRecords, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { can } from "@/lib/rbac/can";
import { authorizeAction } from "@/lib/rbac/guard";

import {
  convertLeadSchema,
  leadFormSchema,
  leadIdSchema,
  markLostSchema,
  moveLeadSchema,
  reassignLeadSchema,
  updateLeadSchema,
} from "../schemas";
import {
  convertLead,
  createLead,
  deleteLead,
  moveLead,
  reassignLead,
  updateLead,
} from "../services/leads";
import { STAGE_LABEL } from "../services/pipeline";

/**
 * Lead mutations. Moving, editing and converting are "own" for Sales in the
 * matrix; the action passes the caller's scope down and the service checks
 * the owner under the row lock, against the lead as it is at that moment.
 * Editing a lead's details counts as working it, so it uses the same
 * permission as moving it.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Lead action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

function revalidateLead(leadId?: string, customerId?: string | null) {
  revalidatePath("/leads");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export async function createLeadAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("leads.create");

  const parsed = leadFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const lead = await db.$transaction(async (tx) => {
      const created = await createLead(tx, parsed.data, {
        id: user.id,
        canAssign: can(user.role, "leads.reassign"),
      });
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Lead",
        entityId: created.id,
        summary: `Opened ${created.code}: ${created.title}.`,
        tx,
      });
      return created;
    });

    revalidateLead();
    return { ok: true, id: lead.id, message: `${lead.code} added to New.` };
  } catch (error) {
    return fail(error);
  }
}

export async function updateLeadAction(input: unknown): Promise<ActionResult> {
  const { user, access } = await authorizeAction("leads.moveStage");

  const parsed = updateLeadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await db.$transaction(async (tx) => {
      const change = await updateLead(tx, parsed.data.leadId, parsed.data.values, {
        id: user.id,
        scope: access,
        canReassign: can(user.role, "leads.reassign"),
      });
      const changes = diffRecords(change.before, change.after);
      if (Object.keys(changes).length > 0) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: changes.valueCentavos ? "PRICE_CHANGE" : "UPDATE",
          entityType: "Lead",
          entityId: parsed.data.leadId,
          summary: `Updated ${change.code}.`,
          changes,
          tx,
        });
      }
      return change;
    });

    revalidateLead(parsed.data.leadId, result.after.customerId);
    return { ok: true, message: `${result.code} saved.` };
  } catch (error) {
    return fail(error);
  }
}

/** A drag on the board: a reorder within a column, or a stage change. */
export async function moveLeadAction(input: unknown): Promise<ActionResult> {
  const { user, access } = await authorizeAction("leads.moveStage");

  const parsed = moveLeadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await db.$transaction(async (tx) => {
      const move = await moveLead(tx, parsed.data, { id: user.id, scope: access });
      if (move.from !== move.to) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "STATUS_CHANGE",
          entityType: "Lead",
          entityId: parsed.data.leadId,
          summary:
            move.to === "LOST"
              ? `Marked ${move.code} lost: ${parsed.data.lostReason}`
              : `Moved ${move.code} from ${STAGE_LABEL[move.from]} to ${STAGE_LABEL[move.to]}.`,
          changes: { stage: { from: move.from, to: move.to } },
          tx,
        });
      }
      return move;
    });

    revalidateLead(parsed.data.leadId);
    return {
      ok: true,
      message:
        result.from === result.to
          ? `${result.code} reordered.`
          : `${result.code} moved to ${STAGE_LABEL[result.to]}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function markLeadLostAction(input: unknown): Promise<ActionResult> {
  const parsed = markLostSchema.safeParse(input);
  if (!parsed.success) {
    await authorizeAction("leads.moveStage");
    return invalid(parsed.error.issues);
  }
  return moveLeadAction({
    leadId: parsed.data.leadId,
    toStage: "LOST",
    beforeId: null,
    afterId: null,
    lostReason: parsed.data.reason,
  });
}

export async function reopenLeadAction(input: unknown): Promise<ActionResult> {
  const parsed = leadIdSchema.safeParse(input);
  if (!parsed.success) {
    await authorizeAction("leads.moveStage");
    return invalid(parsed.error.issues);
  }
  return moveLeadAction({
    leadId: parsed.data.leadId,
    toStage: "NEW",
    beforeId: null,
    afterId: null,
  });
}

export async function convertLeadAction(
  input: unknown,
): Promise<ActionResult & { customerId?: string }> {
  const { user, access } = await authorizeAction("leads.convert");

  const parsed = convertLeadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  // Making a new customer is a customer write in its own right.
  if (parsed.data.mode === "new") await authorizeAction("customers.manage");

  try {
    const result = await db.$transaction(async (tx) => {
      const converted = await convertLead(tx, parsed.data, { id: user.id, scope: access });

      if (converted.customer.created) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "CREATE",
          entityType: "Customer",
          entityId: converted.customer.id,
          summary: `Added customer ${converted.customer.displayName} (${converted.customer.code}) from ${converted.code}.`,
          tx,
        });
      }
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "Lead",
        entityId: parsed.data.leadId,
        summary: `Won ${converted.code} and linked it to ${converted.customer.displayName} (${converted.customer.code}).`,
        changes: {
          stage: { from: converted.from, to: "WON" },
          customerId: { from: null, to: converted.customer.id },
        },
        tx,
      });
      return converted;
    });

    revalidateLead(parsed.data.leadId, result.customer.id);
    revalidatePath("/customers");
    return {
      ok: true,
      customerId: result.customer.id,
      message: result.customer.created
        ? `${result.code} won. ${result.customer.displayName} is now customer ${result.customer.code}.`
        : `${result.code} won for ${result.customer.displayName}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function reassignLeadAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("leads.reassign");

  const parsed = reassignLeadSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await db.$transaction(async (tx) => {
      const change = await reassignLead(tx, parsed.data.leadId, parsed.data.ownerId);
      if (change.changed) {
        const [from, to] = await Promise.all([
          tx.user.findUnique({ where: { id: change.from }, select: { name: true } }),
          tx.user.findUnique({ where: { id: change.to }, select: { name: true } }),
        ]);
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entityType: "Lead",
          entityId: parsed.data.leadId,
          summary: `Reassigned ${change.code} from ${from?.name ?? "nobody"} to ${to?.name ?? "nobody"}.`,
          changes: { ownerId: { from: change.from, to: change.to } },
          tx,
        });
        return { ...change, toName: to?.name ?? "the new owner" };
      }
      return { ...change, toName: null };
    });

    revalidateLead(parsed.data.leadId);
    return {
      ok: true,
      message: result.toName ? `${result.code} now belongs to ${result.toName}.` : "No change.",
    };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteLeadAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("leads.delete");

  const parsed = leadIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const lead = await db.$transaction(async (tx) => {
      const deleted = await deleteLead(tx, parsed.data.leadId);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "DELETE",
        entityType: "Lead",
        entityId: parsed.data.leadId,
        summary: `Deleted ${deleted.code}: ${deleted.title} (${STAGE_LABEL[deleted.stage]}).`,
        tx,
      });
      return deleted;
    });

    revalidateLead();
    return { ok: true, message: `${lead.code} deleted.` };
  } catch (error) {
    return fail(error);
  }
}
