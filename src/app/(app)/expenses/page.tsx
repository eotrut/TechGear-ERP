import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";

import { BarList } from "@/components/charts/bar-list";
import { ListFilters } from "@/components/data-table/list-filters";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ExpensesTable } from "@/features/expenses/components/expenses-table";
import { EXPENSE_PAGE_SIZE, expensesByCategory, listExpenses } from "@/features/expenses/queries";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  expenseFiltersSchema,
} from "@/features/expenses/schemas";
import { RangePicker } from "@/features/reports/components/range-picker";
import {
  ComparisonNote,
  formatShare,
  KpiGrid,
  ReportSection,
} from "@/features/reports/components/report-kit";
import { paramReader, readRange, withParams } from "@/features/reports/schemas";
import { describeWindow, manilaDay } from "@/features/reports/services/date-range";
import { formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Expenses" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("expenses.view");
  const params = await searchParams;
  const read = paramReader(params);
  const now = new Date();
  const range = readRange(params, now, "90d");
  const filters = expenseFiltersSchema.parse({
    category: read("category"),
    search: read("search"),
    page: read("page"),
  });

  const [list, byCategory] = await Promise.all([
    listExpenses(filters, range),
    expensesByCategory(range),
  ]);
  const canManage = can(user.role, "expenses.manage");
  const spent = byCategory.reduce((sum, row) => sum + row.amountCentavos, 0);
  const vat = byCategory.reduce((sum, row) => sum + row.vatCentavos, 0);
  const receipts = byCategory.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <PageHeader
          className="pb-0"
          title="Expenses"
          description="Operating costs as the receipts show them. Each one lands in the profit and loss net of VAT, and its input VAT in the VAT summary."
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <RangePicker
                preset={range.preset}
                fromDay={range.fromDay}
                toDay={range.toDay}
                summary={describeWindow(range)}
                today={manilaDay(now)}
              />
              {canManage ? (
                <Button asChild variant="primary" size="md">
                  <Link href="/expenses/new">
                    <Plus aria-hidden />
                    Record an expense
                  </Link>
                </Button>
              ) : null}
            </div>
          }
        />
        <ComparisonNote text={`${describeWindow(range)}. Manila calendar days.`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <KpiGrid
          columns={3}
          items={[
            { label: "Spent", value: formatPeso(spent), hint: `${receipts} receipts` },
            { label: "Input VAT", value: formatPeso(vat), hint: "Claimable on the VAT return" },
            {
              label: "Net of VAT",
              value: formatPeso(spent - vat),
              hint: "What the P&L carries",
              href: `/reports/pl${withParams(params, { category: undefined, search: undefined, page: undefined })}`,
            },
          ]}
        />
        <ReportSection title="By category">
          <BarList
            caption="Expenses by category"
            items={byCategory
              .filter((row) => row.amountCentavos > 0)
              .map((row) => ({
                key: row.category,
                label: EXPENSE_CATEGORY_LABEL[row.category],
                value: row.amountCentavos,
                display: formatPeso(row.amountCentavos),
                detail: formatShare(row.amountCentavos, spent),
                href: `/expenses${withParams(params, { category: row.category, page: undefined })}`,
              }))}
          />
        </ReportSection>
      </div>

      <ExpensesTable
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageCount={list.pageCount}
        pageSize={EXPENSE_PAGE_SIZE}
        canManage={canManage}
        filtered={Boolean(filters.category || filters.search)}
        toolbar={
          <ListFilters
            key="expense-filters"
            keep={["range", "from", "to"]}
            fields={[
              {
                kind: "search",
                name: "search",
                label: "Search",
                placeholder: "Reference, description or vendor",
              },
              {
                kind: "select",
                name: "category",
                label: "Category",
                allLabel: "Every category",
                options: EXPENSE_CATEGORIES.map((category) => ({
                  value: category,
                  label: EXPENSE_CATEGORY_LABEL[category],
                })),
              },
            ]}
          />
        }
      />
    </div>
  );
}
