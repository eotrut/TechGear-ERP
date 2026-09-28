import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { DeleteExpenseButton } from "@/features/expenses/components/delete-expense-button";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { getExpense } from "@/features/expenses/queries";
import { EXPENSE_CATEGORY_LABEL } from "@/features/expenses/schemas";
import { expenseFormValues } from "@/features/expenses/services/expenses";
import { manilaDay } from "@/features/reports/services/date-range";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Expense" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requirePermission("expenses.view");
  const { id } = await params;
  const expense = await getExpense(id);
  if (!expense) notFound();

  const canManage = can(user.role, "expenses.manage");
  const canDelete = can(user.role, "expenses.delete");

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
      <PageHeader
        title={expense.reference}
        description={`${EXPENSE_CATEGORY_LABEL[expense.category]}. Recorded by ${expense.createdBy.name} on ${formatDateTime(expense.createdAt)}${
          expense.updatedAt.getTime() - expense.createdAt.getTime() > 1000
            ? `, last changed ${formatDateTime(expense.updatedAt)}`
            : ""
        }.`}
        actions={
          canDelete ? (
            <DeleteExpenseButton expenseId={expense.id} reference={expense.reference} />
          ) : null
        }
      />
      <ExpenseForm
        expenseId={expense.id}
        today={manilaDay(new Date())}
        defaults={expenseFormValues(expense)}
        readOnly={!canManage}
      />
    </div>
  );
}
