"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { diffRecords, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { authorizeAction } from "@/lib/rbac/guard";

import { promoFormSchema, promoToggleSchema, updatePromoSchema } from "../schemas";
import { describePromoValue } from "../services/promo-rules";
import { createPromo, promoDataFrom, setPromoActive, updatePromo } from "../services/promos";

/** Promo mutations. Managers and admins only; every change is audited. */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Promo action failed", error);
  return { ok: false, error: "Something went wrong saving that promo." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

export async function createPromoAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("promos.manage");
  const parsed = promoFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const created = await db.$transaction(async (tx) => {
      const promo = await createPromo(tx, parsed.data);
      const data = promoDataFrom(parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Promo",
        entityId: promo.id,
        summary: `Created promo ${promo.code}: ${describePromoValue(data)}.`,
        tx,
      });
      return promo;
    });
    revalidatePath("/promos");
    return { ok: true, message: `${created.code} created.` };
  } catch (error) {
    return fail(error);
  }
}

export async function updatePromoAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("promos.manage");
  const parsed = updatePromoSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const code = await db.$transaction(async (tx) => {
      const { before, after } = await updatePromo(tx, parsed.data.promoId, parsed.data.values);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Promo",
        entityId: after.id,
        summary: `Updated promo ${after.code}.`,
        changes: diffRecords(before, after, { ignore: ["updatedAt", "createdAt", "usageCount"] }),
        tx,
      });
      return after.code;
    });
    revalidatePath("/promos");
    return { ok: true, message: `${code} saved.` };
  } catch (error) {
    return fail(error);
  }
}

export async function togglePromoAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("promos.manage");
  const parsed = promoToggleSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const promo = await db.$transaction(async (tx) => {
      const before = await setPromoActive(tx, parsed.data.promoId, parsed.data.isActive);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Promo",
        entityId: before.id,
        summary: `${parsed.data.isActive ? "Reactivated" : "Deactivated"} promo ${before.code}.`,
        changes: { isActive: { from: before.isActive, to: parsed.data.isActive } },
        tx,
      });
      return before;
    });
    revalidatePath("/promos");
    return {
      ok: true,
      message: `${promo.code} ${parsed.data.isActive ? "is live again" : "no longer applies to new orders"}.`,
    };
  } catch (error) {
    return fail(error);
  }
}
