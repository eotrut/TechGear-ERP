"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { can } from "@/lib/rbac/can";
import { authorizeAction } from "@/lib/rbac/guard";

import { ACTIVITY_TYPE_LABEL, activityFormSchema, activityIdSchema } from "../schemas";
import { createActivity, setActivityStatus } from "../services/activities";

/**
 * Activity mutations. `activities.manageOwn` is "own" for every role; acting
 * on somebody else's activity needs `activities.assignToOthers`, which the
 * service checks against the row under its lock.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Activity action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

function revalidateLinked(links: {
  customerId: string | null;
  leadId: string | null;
  ticketId: string | null;
}) {
  revalidatePath("/activities");
  revalidatePath("/activities/mine");
  if (links.customerId) revalidatePath(`/customers/${links.customerId}`);
  if (links.leadId) revalidatePath(`/leads/${links.leadId}`);
  if (links.ticketId) revalidatePath(`/tickets/${links.ticketId}`);
  if (links.leadId) revalidatePath("/leads");
}

export async function createActivityAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("activities.manageOwn");

  const parsed = activityFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  try {
    const activity = await db.$transaction(async (tx) => {
      const created = await createActivity(tx, parsed.data, {
        id: user.id,
        canAssign: can(user.role, "activities.assignToOthers"),
      });
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Activity",
        entityId: created.id,
        summary: `${parsed.data.done ? "Logged" : "Scheduled"} ${ACTIVITY_TYPE_LABEL[
          parsed.data.type
        ].toLowerCase()}: ${created.subject}.`,
        tx,
      });
      return created;
    });

    revalidateLinked(activity);
    return {
      ok: true,
      message:
        activity.ownerId === user.id
          ? parsed.data.done
            ? "Logged."
            : "Added to your tasks."
          : "Assigned.",
    };
  } catch (error) {
    return fail(error);
  }
}

async function changeStatus(input: unknown, change: "complete" | "reopen"): Promise<ActionResult> {
  const { user } = await authorizeAction("activities.manageOwn");

  const parsed = activityIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing activity." };

  try {
    const result = await db.$transaction(async (tx) => {
      const updated = await setActivityStatus(tx, parsed.data.activityId, change, {
        id: user.id,
        canAssign: can(user.role, "activities.assignToOthers"),
      });
      if (updated.changed) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "STATUS_CHANGE",
          entityType: "Activity",
          entityId: updated.id,
          summary: `${change === "complete" ? "Completed" : "Reopened"} "${updated.subject}".`,
          changes: { status: { from: updated.from, to: updated.to } },
          tx,
        });
      }
      return updated;
    });

    if ("customerId" in result) {
      revalidateLinked({
        customerId: result.customerId,
        leadId: result.leadId,
        ticketId: result.ticketId,
      });
    } else {
      revalidateLinked({ customerId: null, leadId: null, ticketId: null });
    }
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function completeActivityAction(input: unknown): Promise<ActionResult> {
  return changeStatus(input, "complete");
}

export async function reopenActivityAction(input: unknown): Promise<ActionResult> {
  return changeStatus(input, "reopen");
}
