"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { diffRecords, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatPeso } from "@/lib/money";
import { authorizeAction } from "@/lib/rbac/guard";

import { deleteExpenseSchema, expenseFormSchema, updateExpenseSchema } from "../schemas";
import { createExpense, deleteExpense, updateExpense } from "../services/expenses";

/**
 * Expense mutations. Managers and admins record and correct expenses; only
 * an admin may delete one, because a deleted expense silently changes every
 * P&L that ever included it. Every change is audited.
 */

type CreateResult = ActionResult & { expenseId?: string };

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Expense action failed", error);
  return { ok: false, error: "Something went wrong saving that expense." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

function revalidate() {
  revalidatePath("/expenses");
  revalidatePath("/reports", "layout");
  revalidatePath("/dashboard");
}

export async function createExpenseAction(input: unknown): Promise<CreateResult> {
  const { user } = await authorizeAction("expenses.manage");
  const parsed = expenseFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const expense = await db.$transaction(async (tx) => {
      const created = await createExpense(tx, parsed.data, user.id);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Expense",
        entityId: created.id,
        summary: `Recorded expense ${created.reference}: ${created.description}, ${formatPeso(created.amountCentavos)}.`,
        tx,
      });
      return created;
    });
    revalidate();
    return { ok: true, message: `${expense.reference} recorded.`, expenseId: expense.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateExpenseAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("expenses.manage");
  const parsed = updateExpenseSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const reference = await db.$transaction(async (tx) => {
      const { before, after } = await updateExpense(tx, parsed.data.expenseId, parsed.data.values);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Expense",
        entityId: after.id,
        summary: `Updated expense ${after.reference}.`,
        changes: diffRecords(before, after),
        tx,
      });
      return after.reference;
    });
    revalidate();
    return { ok: true, message: `${reference} saved.` };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteExpenseAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("expenses.delete");
  const parsed = deleteExpenseSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const removed = await db.$transaction(async (tx) => {
      const before = await deleteExpense(tx, parsed.data.expenseId);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "DELETE",
        entityType: "Expense",
        entityId: before.id,
        summary: `Deleted expense ${before.reference}: ${before.description}, ${formatPeso(before.amountCentavos)}.`,
        tx,
      });
      return before;
    });
    revalidate();
    return { ok: true, message: `${removed.reference} deleted.` };
  } catch (error) {
    return fail(error);
  }
}
