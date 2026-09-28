import type { ExpenseCategory } from "@prisma/client";

import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL } from "@/features/expenses/schemas";

/**
 * The profit and loss statement, assembled from its components. Pure, so the
 * arithmetic that turns ledger totals into a statement is unit tested apart
 * from the SQL that fetches them.
 *
 *   Net sales                        VAT exclusive, from the sales base (D-44)
 *   Cost of goods sold
 *   Gross profit                     equals the gross profit report, always
 *   Operating expenses               each category net of input VAT
 *   Warranty replacements            cost of units shipped free (D-20)
 *   Refunded orders, stock lost      cost a full refund did not bring back
 *   Inventory adjustments            damage, loss, theft, samples, count fixes
 *   Operating profit
 *
 * Everything is VAT exclusive: VAT collected and VAT paid are owed to and
 * claimed from the BIR, so neither is income or cost. The VAT summary report
 * carries them instead.
 */

export type PlComponents = {
  netSales: number;
  cogs: number;
  expenses: Record<ExpenseCategory, number>;
  warrantyReplacements: number;
  refundedStockLoss: number;
  inventoryAdjustments: number;
};

export type PlLineKind = "income" | "cost" | "subtotal" | "total";

export type PlLine = {
  key: string;
  label: string;
  kind: PlLineKind;
  /** Signed as it affects profit: income positive, costs negative. */
  amount: number;
  /** A hint under the label, for the lines whose meaning is not obvious. */
  note?: string;
};

export type PlStatement = {
  lines: PlLine[];
  netSales: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingProfit: number;
};

export function emptyComponents(): PlComponents {
  return {
    netSales: 0,
    cogs: 0,
    expenses: Object.fromEntries(EXPENSE_CATEGORIES.map((category) => [category, 0])) as Record<
      ExpenseCategory,
      number
    >,
    warrantyReplacements: 0,
    refundedStockLoss: 0,
    inventoryAdjustments: 0,
  };
}

export function addComponents(into: PlComponents, other: PlComponents): PlComponents {
  into.netSales += other.netSales;
  into.cogs += other.cogs;
  for (const category of EXPENSE_CATEGORIES) into.expenses[category] += other.expenses[category];
  into.warrantyReplacements += other.warrantyReplacements;
  into.refundedStockLoss += other.refundedStockLoss;
  into.inventoryAdjustments += other.inventoryAdjustments;
  return into;
}

export function operatingProfitOf(c: PlComponents): number {
  return assembleStatement(c).operatingProfit;
}

export function assembleStatement(c: PlComponents): PlStatement {
  const grossProfit = c.netSales - c.cogs;

  const expenseLines: PlLine[] = EXPENSE_CATEGORIES.map((category) => ({
    key: `expense.${category}`,
    label: EXPENSE_CATEGORY_LABEL[category],
    kind: "cost" as const,
    amount: -c.expenses[category],
  }));

  const stockLines: PlLine[] = [
    {
      key: "warranty",
      label: "Warranty replacements",
      kind: "cost",
      amount: -c.warrantyReplacements,
      note: "Cost of units shipped free against a claim",
    },
    {
      key: "refunded",
      label: "Refunded orders, stock not recovered",
      kind: "cost",
      amount: -c.refundedStockLoss,
      note: "Cost of units a full refund did not bring back to the shelf",
    },
    {
      key: "adjustments",
      label: "Inventory adjustments",
      kind: "cost",
      amount: -c.inventoryAdjustments,
      note: "Damage, loss, theft, samples and count corrections, at cost",
    },
  ];

  const operatingExpenses = [...expenseLines, ...stockLines].reduce(
    (sum, line) => sum - line.amount,
    0,
  );
  const operatingProfit = grossProfit - operatingExpenses;

  return {
    netSales: c.netSales,
    grossProfit,
    operatingExpenses,
    operatingProfit,
    lines: [
      { key: "netSales", label: "Net sales", kind: "income", amount: c.netSales },
      { key: "cogs", label: "Cost of goods sold", kind: "cost", amount: -c.cogs },
      { key: "grossProfit", label: "Gross profit", kind: "subtotal", amount: grossProfit },
      ...expenseLines,
      ...stockLines,
      {
        key: "operatingExpenses",
        label: "Total operating expenses",
        kind: "subtotal",
        amount: -operatingExpenses,
      },
      {
        key: "operatingProfit",
        label: "Operating profit",
        kind: "total",
        amount: operatingProfit,
      },
    ],
  };
}
