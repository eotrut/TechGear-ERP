import type { ExpenseCategory } from "@prisma/client";
import { z } from "zod";

import { pageParam, requiredPeso, text } from "@/lib/validation";

/** Expense schemas, shared by the expense form and its server actions. */

export const EXPENSE_CATEGORIES = [
  "RENT",
  "SALARIES",
  "ADS",
  "SHIPPING",
  "UTILITIES",
  "SUPPLIES",
  "SOFTWARE",
  "OTHER",
] as const satisfies readonly ExpenseCategory[];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  RENT: "Rent",
  SALARIES: "Salaries and wages",
  ADS: "Advertising",
  SHIPPING: "Shipping and couriers",
  UTILITIES: "Utilities",
  SUPPLIES: "Packaging and supplies",
  SOFTWARE: "Software",
  OTHER: "Other",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const expenseFormSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES, { message: "Pick a category." }),
    description: text(160, { min: 3, required: "Say what the expense was for." }),
    vendor: text(120),
    /** VAT inclusive, as the receipt shows it. */
    amount: requiredPeso,
    /**
     * Whether the amount carries 12% input VAT. Salaries and most government
     * fees do not; rent, utilities and ad spend from a VAT-registered vendor do.
     */
    vatable: z.boolean(),
    incurredOn: z.string().regex(DATE, "Pick the date on the receipt."),
  })
  .superRefine((value, ctx) => {
    if (value.amount.trim().startsWith("-")) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "An expense is money out. Enter it as a positive amount.",
      });
    }
  });

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

export const updateExpenseSchema = z.object({
  expenseId: z.string().trim().min(1).max(64),
  values: expenseFormSchema,
});

export const deleteExpenseSchema = z.object({
  expenseId: z.string().trim().min(1).max(64),
});

export const expenseFiltersSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional().catch(undefined),
  search: z.string().trim().max(80).optional().catch(undefined),
  page: pageParam,
});

export type ExpenseFilters = z.infer<typeof expenseFiltersSchema>;
