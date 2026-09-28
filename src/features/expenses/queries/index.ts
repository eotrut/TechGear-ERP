import type { ExpenseCategory, Prisma } from "@prisma/client";

import type { Window } from "@/features/reports/services/date-range";
import { db } from "@/lib/db";

import { EXPENSE_CATEGORIES, type ExpenseFilters } from "../schemas";

export const EXPENSE_PAGE_SIZE = 25;

export type ExpenseRow = {
  id: string;
  reference: string;
  category: ExpenseCategory;
  description: string;
  vendor: string | null;
  amountCentavos: number;
  vatCentavos: number;
  incurredAt: string;
  createdByName: string;
};

function whereFor(filters: ExpenseFilters, window: Pick<Window, "from" | "to">) {
  const where: Prisma.ExpenseWhereInput = {
    incurredAt: { gte: window.from, lt: window.to },
  };
  if (filters.category) where.category = filters.category;
  if (filters.search) {
    where.OR = [
      { reference: { contains: filters.search, mode: "insensitive" } },
      { description: { contains: filters.search, mode: "insensitive" } },
      { vendor: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return where;
}

/** One page of expenses in the range, newest first, with the matching total. */
export async function listExpenses(filters: ExpenseFilters, window: Pick<Window, "from" | "to">) {
  const where = whereFor(filters, window);
  const [rows, total, sums] = await Promise.all([
    db.expense.findMany({
      where,
      orderBy: [{ incurredAt: "desc" }, { reference: "desc" }],
      skip: (filters.page - 1) * EXPENSE_PAGE_SIZE,
      take: EXPENSE_PAGE_SIZE,
      select: {
        id: true,
        reference: true,
        category: true,
        description: true,
        vendor: true,
        amountCentavos: true,
        vatCentavos: true,
        incurredAt: true,
        createdBy: { select: { name: true } },
      },
    }),
    db.expense.count({ where }),
    db.expense.aggregate({ where, _sum: { amountCentavos: true, vatCentavos: true } }),
  ]);

  return {
    rows: rows.map((row): ExpenseRow => ({
      id: row.id,
      reference: row.reference,
      category: row.category,
      description: row.description,
      vendor: row.vendor,
      amountCentavos: row.amountCentavos,
      vatCentavos: row.vatCentavos,
      incurredAt: row.incurredAt.toISOString(),
      createdByName: row.createdBy.name,
    })),
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / EXPENSE_PAGE_SIZE)),
    amountCentavos: sums._sum.amountCentavos ?? 0,
    vatCentavos: sums._sum.vatCentavos ?? 0,
  };
}

/** Spend per category in the range, every category present, largest first. */
export async function expensesByCategory(window: Pick<Window, "from" | "to">) {
  const groups = await db.expense.groupBy({
    by: ["category"],
    where: { incurredAt: { gte: window.from, lt: window.to } },
    _sum: { amountCentavos: true, vatCentavos: true },
    _count: { _all: true },
  });
  return EXPENSE_CATEGORIES.map((category) => {
    const group = groups.find((g) => g.category === category);
    return {
      category,
      count: group?._count._all ?? 0,
      amountCentavos: group?._sum.amountCentavos ?? 0,
      vatCentavos: group?._sum.vatCentavos ?? 0,
    };
  }).sort((a, b) => b.amountCentavos - a.amountCentavos);
}

export async function getExpense(id: string) {
  return db.expense.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      category: true,
      description: true,
      vendor: true,
      amountCentavos: true,
      vatCentavos: true,
      incurredAt: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { name: true } },
    },
  });
}
