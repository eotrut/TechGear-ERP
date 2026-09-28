"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/features/auth/actions";
import { runStockTransaction } from "@/features/inventory/services/stock";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { authorizeAction } from "@/lib/rbac/guard";

import { searchClaimableItems } from "../queries";
import {
  CLAIM_STATUS_LABEL,
  claimRefundSchema,
  claimReplaceSchema,
  claimReviewSchema,
  createClaimSchema,
} from "../schemas";
import { createClaim, refundClaim, replaceClaim, reviewClaim } from "../services/warranty";

/**
 * Warranty mutations. Sales raises a claim, a manager reviews it, the
 * warehouse ships a replacement, and a refund needs the refund permission.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Warranty action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

async function revalidateClaim(claimId: string, extra: string[] = []) {
  const claim = await db.warrantyClaim.findUnique({
    where: { id: claimId },
    select: { customerId: true, orderItem: { select: { orderId: true } } },
  });
  for (const path of [
    "/warranty",
    `/warranty/${claimId}`,
    ...(claim ? [`/orders/${claim.orderItem.orderId}`, `/customers/${claim.customerId}`] : []),
    "/orders",
    ...extra,
  ]) {
    revalidatePath(path);
  }
}

export async function createClaimAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("warranty.create");
  const parsed = createClaimSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const claim = await createClaim(tx, parsed.data, new Date(), user.id);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "WarrantyClaim",
        entityId: claim.id,
        summary: `Raised warranty claim ${claim.claimNumber}, covered until ${formatDate(claim.warrantyExpiresAt)}.`,
        changes: { status: { from: null, to: "SUBMITTED" } },
        tx,
      });
      return claim;
    });
    await revalidateClaim(result.id);
    return { ok: true, id: result.id, message: `${result.claimNumber} submitted for review.` };
  } catch (error) {
    return fail(error);
  }
}

export async function reviewClaimAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("warranty.review");
  const parsed = claimReviewSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const reviewed = await reviewClaim(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "WarrantyClaim",
        entityId: parsed.data.claimId,
        summary: `Moved ${reviewed.claimNumber} to ${CLAIM_STATUS_LABEL[parsed.data.to].toLowerCase()}.${
          parsed.data.note ? ` ${parsed.data.note}` : ""
        }`,
        changes: { status: { from: reviewed.from, to: parsed.data.to } },
        tx,
      });
      return reviewed;
    });
    await revalidateClaim(parsed.data.claimId);
    return {
      ok: true,
      message: `${result.claimNumber} is now ${CLAIM_STATUS_LABEL[parsed.data.to].toLowerCase()}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function replaceClaimAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("warranty.fulfil");
  const parsed = claimReplaceSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const replaced = await replaceClaim(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "WarrantyClaim",
        entityId: parsed.data.claimId,
        summary: `Replaced the unit on ${replaced.claimNumber} with no-charge order ${replaced.orderNumber}.`,
        changes: { status: { from: "APPROVED", to: "REPLACED" } },
        tx,
      });
      return replaced;
    });
    await revalidateClaim(parsed.data.claimId, [
      `/orders/${result.orderId}`,
      "/inventory",
      "/inventory/ledger",
    ]);
    return {
      ok: true,
      message: `${result.claimNumber} replaced. ${result.orderNumber} is paid at no charge and ready to pack.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function refundClaimAction(input: unknown): Promise<ActionResult> {
  await authorizeAction("warranty.review");
  const { user } = await authorizeAction("orders.refund");
  const parsed = claimRefundSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const refunded = await refundClaim(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "WarrantyClaim",
        entityId: parsed.data.claimId,
        summary: `Refunded ${formatPeso(refunded.refund.amountCentavos)} on ${refunded.claimNumber} and wrote the unit off.`,
        changes: { status: { from: "APPROVED", to: "REFUNDED" } },
        tx,
      });
      return refunded;
    });
    await revalidateClaim(parsed.data.claimId, ["/inventory/ledger"]);
    return {
      ok: true,
      message: `${formatPeso(result.refund.amountCentavos)} refunded on ${result.claimNumber}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function searchClaimableItemsAction(
  input: unknown,
): Promise<
  | { ok: true; results: { id: string; label: string; detail: string; meta: string }[] }
  | { ok: false; error: string }
> {
  await authorizeAction("warranty.create");
  const parsed = z.object({ query: z.string().trim().max(80) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Search could not be read." };
  return { ok: true, results: await searchClaimableItems(parsed.data.query) };
}
