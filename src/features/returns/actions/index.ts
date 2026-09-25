"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/features/auth/actions";
import { runStockTransaction } from "@/features/inventory/services/stock";
import { PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { authorizeAction } from "@/lib/rbac/guard";
import { emptyToNull } from "@/lib/validation";

import { searchReturnableOrders } from "../queries";
import {
  completeReturnSchema,
  createReturnSchema,
  receiveReturnSchema,
  returnDecisionSchema,
} from "../schemas";
import { completeReturn, createReturn, decideReturn, receiveReturn } from "../services/returns";

/**
 * Return mutations. Raising, approving, receiving and completing are
 * separate permissions because they are separate jobs: sales raises it, a
 * manager decides, the warehouse inspects, and the refund is a manager's call.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Return action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

async function revalidateReturn(returnId: string) {
  const record = await db.return.findUnique({ where: { id: returnId }, select: { orderId: true } });
  for (const path of [
    "/returns",
    `/returns/${returnId}`,
    ...(record ? [`/orders/${record.orderId}`] : []),
    "/orders",
    "/inventory",
    "/inventory/ledger",
    "/customers",
  ]) {
    revalidatePath(path);
  }
}

export async function createReturnAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("returns.create");
  const parsed = createReturnSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const created = await createReturn(
        tx,
        {
          orderId: parsed.data.orderId,
          reason: parsed.data.reason,
          notes: emptyToNull(parsed.data.notes),
          lines: parsed.data.lines,
        },
        user,
      );
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Return",
        entityId: created.id,
        summary: `Raised ${created.rmaNumber}: ${created.units} unit${created.units === 1 ? "" : "s"}, about ${formatPeso(created.estimateCentavos)} to refund. ${parsed.data.reason}`,
        changes: { status: { from: null, to: "REQUESTED" } },
        tx,
      });
      return created;
    });

    await revalidateReturn(result.id);
    return {
      ok: true,
      id: result.id,
      message: `${result.rmaNumber} raised. A manager approves it before the goods come back.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function decideReturnAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("returns.approve");
  const parsed = returnDecisionSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const decided = await decideReturn(tx, parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "Return",
        entityId: parsed.data.returnId,
        summary: `${parsed.data.decision === "APPROVED" ? "Approved" : "Rejected"} ${decided.rmaNumber}.${parsed.data.note ? ` ${parsed.data.note}` : ""}`,
        changes: { status: { from: decided.from, to: parsed.data.decision } },
        tx,
      });
      return decided;
    });

    await revalidateReturn(parsed.data.returnId);
    return {
      ok: true,
      message:
        parsed.data.decision === "APPROVED"
          ? `${result.rmaNumber} approved. The warehouse can receive the goods.`
          : `${result.rmaNumber} rejected.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function receiveReturnAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("returns.receive");
  const parsed = receiveReturnSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const received = await receiveReturn(tx, parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "Return",
        entityId: parsed.data.returnId,
        summary: `Received ${received.rmaNumber}: ${parsed.data.lines.length - received.writeOffs} line${
          parsed.data.lines.length - received.writeOffs === 1 ? "" : "s"
        } to restock, ${received.writeOffs} to write off.`,
        changes: { status: { from: "APPROVED", to: "RECEIVED" } },
        tx,
      });
      return received;
    });

    await revalidateReturn(parsed.data.returnId);
    return {
      ok: true,
      message: `${result.rmaNumber} received. Complete it to restock and refund.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function completeReturnAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("returns.refund");
  const parsed = completeReturnSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const completed = await completeReturn(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "Return",
        entityId: parsed.data.returnId,
        summary: `Completed ${completed.rmaNumber}: ${completed.restockedUnits} restocked, ${completed.writtenOffUnits} written off, ${
          completed.refund
            ? `${formatPeso(completed.refund.amountCentavos)} refunded by ${PAYMENT_METHOD_LABEL[parsed.data.method]}`
            : "nothing left to refund"
        }.`,
        changes: {
          status: { from: "RECEIVED", to: "COMPLETED" },
          ...(completed.refund?.statusChange
            ? { orderStatus: { from: completed.refund.statusChange.from, to: "REFUNDED" } }
            : {}),
        },
        tx,
      });
      return completed;
    });

    await revalidateReturn(parsed.data.returnId);
    return {
      ok: true,
      message: result.refund
        ? `${result.rmaNumber} completed. ${formatPeso(result.refund.amountCentavos)} refunded${
            result.refund.statusChange
              ? `; ${result.refund.orderNumber} is now refunded in full`
              : ""
          }.`
        : `${result.rmaNumber} completed. The order had nothing left to refund.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export type ReturnableOrderPick = { id: string; label: string; detail: string; meta: string };

export async function searchReturnableOrdersAction(
  input: unknown,
): Promise<{ ok: true; results: ReturnableOrderPick[] } | { ok: false; error: string }> {
  await authorizeAction("returns.create");
  const parsed = z.object({ query: z.string().trim().max(80) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Search could not be read." };
  const rows = await searchReturnableOrders(parsed.data.query);
  return {
    ok: true,
    results: rows.map((row) => ({
      id: row.id,
      label: row.orderNumber,
      detail: `${row.customer?.displayName ?? "Walk-in"}, ${formatDate(row.placedAt)}`,
      meta: "",
    })),
  };
}
