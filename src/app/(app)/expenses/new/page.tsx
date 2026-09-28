import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ExpenseForm } from "@/features/expenses/components/expense-form";
import { manilaDay } from "@/features/reports/services/date-range";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Record an expense" };

export default async function NewExpensePage() {
  await requirePermission("expenses.manage");
  const today = manilaDay(new Date());

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
      <PageHeader
        title="Record an expense"
        description="Enter it as the receipt shows it. The reference is numbered for the year the expense belongs to."
      />
      <ExpenseForm
        today={today}
        defaults={{
          category: "OTHER",
          description: "",
          vendor: "",
          amount: "",
          vatable: true,
          incurredOn: today,
        }}
      />
    </div>
  );
}
