import type { ExpenseCategory, Prisma } from "@prisma/client";

import { DomainError } from "@/lib/errors";
import { parseManilaDate, toManilaDateTimeInput } from "@/lib/format";
import { parsePesoInput, toPesoInput } from "@/lib/money";
import { nextReference } from "@/lib/numbering";
import { vatFromGross } from "@/lib/vat";

import type { ExpenseFormValues } from "../schemas";

/**
 * Operating expenses. An expense is entered as the receipt shows it, VAT
 * inclusive; when the vendor is VAT registered the 12% inside it is split out
 * here, once, so the P&L can take the cost net and the VAT summary can claim
 * the input VAT. Nothing else ever recomputes it.
 */

type Tx = Prisma.TransactionClient;

export type ExpenseData = {
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  amountCentavos: number;
  vatCentavos: number;
  incurredAt: Date;
};

export function expenseDataFrom(values: ExpenseFormValues, now: Date = new Date()): ExpenseData {
  const amountCentavos = parsePesoInput(values.amount);
  if (amountCentavos === null || amountCentavos <= 0) {
    throw new DomainError("Enter the amount on the receipt, above zero.");
  }
  const incurredAt = parseManilaDate(values.incurredOn);
  if (!incurredAt) throw new DomainError("Pick the date on the receipt.");
  if (incurredAt.getTime() > now.getTime()) {
    throw new DomainError("An expense cannot be dated in the future.");
  }
  return {
    category: values.category,
    description: values.description,
    vendor: values.vendor.trim() === "" ? null : values.vendor.trim(),
    amountCentavos,
    vatCentavos: values.vatable ? vatFromGross(amountCentavos) : 0,
    incurredAt,
  };
}

/** The form's view of a stored expense. */
export function expenseFormValues(expense: {
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  amountCentavos: number;
  vatCentavos: number;
  incurredAt: Date;
}): ExpenseFormValues {
  return {
    category: expense.category,
    description: expense.description,
    vendor: expense.vendor ?? "",
    amount: toPesoInput(expense.amountCentavos),
    vatable: expense.vatCentavos > 0,
    incurredOn: toManilaDateTimeInput(expense.incurredAt).slice(0, 10),
  };
}

const RETURNED = {
  id: true,
  reference: true,
  category: true,
  description: true,
  vendor: true,
  amountCentavos: true,
  vatCentavos: true,
  incurredAt: true,
} as const;

export async function createExpense(tx: Tx, values: ExpenseFormValues, createdById: string) {
  const data = expenseDataFrom(values);
  // The reference follows the year the expense belongs to, not the year it was keyed.
  const reference = await nextReference(tx, "EXP", data.incurredAt);
  return tx.expense.create({ data: { ...data, reference, createdById }, select: RETURNED });
}

export async function updateExpense(tx: Tx, expenseId: string, values: ExpenseFormValues) {
  const before = await tx.expense.findUnique({ where: { id: expenseId }, select: RETURNED });
  if (!before) throw new DomainError("That expense no longer exists.");
  const after = await tx.expense.update({
    where: { id: expenseId },
    data: expenseDataFrom(values),
    select: RETURNED,
  });
  return { before, after };
}

export async function deleteExpense(tx: Tx, expenseId: string) {
  const before = await tx.expense.findUnique({ where: { id: expenseId }, select: RETURNED });
  if (!before) throw new DomainError("That expense no longer exists.");
  await tx.expense.delete({ where: { id: expenseId } });
  return before;
}
