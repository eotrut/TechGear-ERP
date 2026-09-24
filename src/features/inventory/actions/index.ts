"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit, type AuditChanges } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatSigned } from "@/lib/format";
import { authorizeAction } from "@/lib/rbac/guard";

import { searchVariantStock, variantStockByIds, type VariantPick } from "../queries";
import {
  ADJUSTMENT_REASON_META,
  adjustmentSchema,
  cancelTransferSchema,
  receiveTransferSchema,
  reorderLevelSchema,
  transferIdSchema,
  transferSchema,
  variantPositionsSchema,
  variantSearchSchema,
} from "../schemas";
import { createAdjustment } from "../services/adjustments";
import { runStockTransaction } from "../services/stock";
import {
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
} from "../services/transfers";

/**
 * Inventory mutations.
 *
 * Each one authorizes against the live user record, validates with the schema
 * the form uses, runs the stock service inside one transaction together with
 * its audit entry, and revalidates. A stock rule that fails (not enough
 * stock, a transfer already received) comes back as a DomainError whose
 * message is written for the person who pressed the button.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Inventory action failed", error);
  return { ok: false, error: "Something went wrong recording that. No stock was moved." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

function revalidateInventory(...extra: string[]) {
  for (const path of [
    "/inventory",
    "/inventory/ledger",
    "/inventory/alerts",
    "/products",
    ...extra,
  ]) {
    revalidatePath(path);
  }
}

// --------------------------------------------------------------- adjustments

export async function createAdjustmentAction(
  input: unknown,
): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("inventory.adjust");

  const parsed = adjustmentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const adjustment = await createAdjustment(tx, parsed.data, user);

      const changes: AuditChanges = {};
      for (const line of adjustment.lines) {
        changes[`${line.sku} at ${adjustment.warehouseCode}`] = {
          from: line.balanceBefore,
          to: line.balanceAfter,
        };
      }

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STOCK_ADJUST",
        entityType: "StockAdjustment",
        entityId: adjustment.id,
        summary: `Recorded ${adjustment.reference} at ${adjustment.warehouseCode}: ${
          ADJUSTMENT_REASON_META[parsed.data.reason].label
        }, ${formatSigned(adjustment.netUnits)} units across ${adjustment.lines.length} line${
          adjustment.lines.length === 1 ? "" : "s"
        }.`,
        changes,
        tx,
      });

      return adjustment;
    });

    revalidateInventory("/inventory/adjustments");
    return {
      ok: true,
      id: result.id,
      message: `${result.reference} recorded. Net change ${formatSigned(result.netUnits)} units.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// ----------------------------------------------------------------- transfers

export async function createTransferAction(
  input: unknown,
): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("inventory.transfer");

  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const transfer = await createTransfer(tx, parsed.data, user);
      const units = parsed.data.lines.reduce((sum, line) => sum + line.qty, 0);

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "StockTransfer",
        entityId: transfer.id,
        summary:
          transfer.status === "IN_TRANSIT"
            ? `Created and dispatched ${transfer.reference}: ${units} units on ${parsed.data.lines.length} lines.`
            : `Drafted ${transfer.reference}: ${units} units on ${parsed.data.lines.length} lines.`,
        changes: { status: { from: null, to: transfer.status } },
        tx,
      });

      return transfer;
    });

    revalidateInventory("/inventory/transfers");
    return {
      ok: true,
      id: result.id,
      message:
        result.status === "IN_TRANSIT"
          ? `${result.reference} dispatched. Stock has left the source warehouse.`
          : `${result.reference} saved as a draft. Nothing moves until it is dispatched.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function dispatchTransferAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("inventory.transfer");

  const parsed = transferIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const transfer = await dispatchTransfer(tx, parsed.data.transferId, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "StockTransfer",
        entityId: transfer.id,
        summary: `Dispatched ${transfer.reference}.`,
        changes: { status: { from: "DRAFT", to: "IN_TRANSIT" } },
        tx,
      });
      return transfer;
    });

    revalidateInventory("/inventory/transfers", `/inventory/transfers/${result.id}`);
    return { ok: true, message: `${result.reference} dispatched.` };
  } catch (error) {
    return fail(error);
  }
}

export async function receiveTransferAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("inventory.receiveTransfer");

  const parsed = receiveTransferSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const transfer = await receiveTransfer(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "StockTransfer",
        entityId: transfer.id,
        summary:
          transfer.shortUnits > 0
            ? `Received ${transfer.reference}, ${transfer.shortUnits} units short.`
            : `Received ${transfer.reference} in full.`,
        changes: { status: { from: "IN_TRANSIT", to: "RECEIVED" } },
        tx,
      });
      return transfer;
    });

    revalidateInventory("/inventory/transfers", `/inventory/transfers/${result.id}`);
    return {
      ok: true,
      message:
        result.shortUnits > 0
          ? `${result.reference} received with ${result.shortUnits} units short.`
          : `${result.reference} received in full.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelTransferAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("inventory.transfer");

  const parsed = cancelTransferSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const transfer = await cancelTransfer(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "StockTransfer",
        entityId: transfer.id,
        summary:
          transfer.movements.length > 0
            ? `Recalled ${transfer.reference} in transit and returned the stock: ${parsed.data.reason}`
            : `Cancelled draft ${transfer.reference}: ${parsed.data.reason}`,
        changes: { status: { from: null, to: "CANCELLED" } },
        tx,
      });
      return transfer;
    });

    revalidateInventory("/inventory/transfers", `/inventory/transfers/${result.id}`);
    return {
      ok: true,
      message:
        result.movements.length > 0
          ? `${result.reference} cancelled. Stock is back at the source.`
          : `${result.reference} cancelled.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------ reorder levels

export async function updateReorderLevelAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("inventory.setReorderLevels");

  const parsed = reorderLevelSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { variantId, reorderLevel, reorderQty } = parsed.data;

  try {
    const sku = await db.$transaction(async (tx) => {
      const before = await tx.productVariant.findFirst({
        where: { id: variantId, deletedAt: null },
        select: { sku: true, reorderLevel: true, reorderQty: true },
      });
      if (!before) throw new DomainError("That variant no longer exists.");

      await tx.productVariant.update({
        where: { id: variantId },
        data: { reorderLevel, reorderQty },
        select: { id: true },
      });

      const changes: AuditChanges = {};
      if (before.reorderLevel !== reorderLevel) {
        changes.reorderLevel = { from: before.reorderLevel, to: reorderLevel };
      }
      if (before.reorderQty !== reorderQty) {
        changes.reorderQty = { from: before.reorderQty, to: reorderQty };
      }

      if (Object.keys(changes).length > 0) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entityType: "ProductVariant",
          entityId: variantId,
          summary: `Set the reorder point for ${before.sku} to ${reorderLevel}, batch ${reorderQty}.`,
          changes,
          tx,
        });
      }
      return before.sku;
    });

    revalidateInventory();
    return { ok: true, message: `Reorder point for ${sku} saved.` };
  } catch (error) {
    return fail(error);
  }
}

// -------------------------------------------------------------------- lookup

/**
 * Variant search for the line pickers. A read, but it runs from the client as
 * the person types, so it goes through the same authorization as any action.
 */
export async function searchVariantsAction(
  input: unknown,
): Promise<{ ok: true; results: VariantPick[] } | { ok: false; error: string }> {
  await authorizeAction("inventory.viewLevels");

  const parsed = variantSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Search could not be read." };

  const results = await searchVariantStock(parsed.data.query, parsed.data.warehouseId);
  return { ok: true, results };
}

/** Positions for lines already on a form, when its warehouse changes. */
export async function variantPositionsAction(
  input: unknown,
): Promise<{ ok: true; results: VariantPick[] } | { ok: false; error: string }> {
  await authorizeAction("inventory.viewLevels");

  const parsed = variantPositionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Positions could not be read." };

  const results = await variantStockByIds(parsed.data.ids, parsed.data.warehouseId);
  return { ok: true, results };
}
