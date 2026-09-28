import type { ExpenseCategory } from "@prisma/client";

import { pesosToCentavos } from "../../src/lib/money";
import { vatFromGross } from "../../src/lib/vat";
import type { SeedContext } from "./lib/context";
import { chance, intBetween, pick } from "./lib/helpers";

/**
 * Twelve months of operating expenses, so the profit and loss view has a real
 * cost side rather than just COGS.
 *
 * Sized for a retailer of this turnover: operating costs land near a third
 * of net sales, so a 40-odd percent gross margin leaves a thin single-digit
 * operating profit, with the slow months after the holidays dipping below it.
 *
 * Recurring lines (rent, salaries, utilities) land every month with small
 * variation. Advertising follows the sales calendar, because a retailer spends
 * hardest into 11.11 and 12.12.
 */

type ExpensePlan = {
  category: ExpenseCategory;
  description: string;
  basePhp: number;
  variance: number;
  vatable: boolean;
};

const MONTHLY: ExpensePlan[] = [
  {
    category: "RENT",
    description: "Warehouse and showroom rent, Quezon City",
    basePhp: 118000,
    variance: 0,
    vatable: true,
  },
  {
    category: "RENT",
    description: "Cebu hub storage rent",
    basePhp: 38500,
    variance: 0,
    vatable: true,
  },
  {
    category: "SALARIES",
    description: "Payroll, retail and warehouse staff",
    basePhp: 236000,
    variance: 0.06,
    vatable: false,
  },
  {
    category: "UTILITIES",
    description: "Meralco and water",
    basePhp: 24800,
    variance: 0.22,
    vatable: true,
  },
  {
    category: "UTILITIES",
    description: "Fibre internet and mobile plans",
    basePhp: 12800,
    variance: 0.04,
    vatable: true,
  },
  {
    category: "SOFTWARE",
    description: "Accounting, helpdesk and design subscriptions",
    basePhp: 18600,
    variance: 0.08,
    vatable: true,
  },
  {
    category: "SHIPPING",
    description: "Courier consolidated billing",
    basePhp: 54000,
    variance: 0.35,
    vatable: true,
  },
  {
    category: "SUPPLIES",
    description: "Packaging, bubble wrap and cartons",
    basePhp: 21400,
    variance: 0.3,
    vatable: true,
  },
];

/** Ad spend multiplier by calendar month, peaking into the double-day sales. */
const AD_SPEND_BY_MONTH: Record<number, number> = {
  1: 0.6,
  2: 0.7,
  3: 0.8,
  4: 0.8,
  5: 0.9,
  6: 1.0,
  7: 1.0,
  8: 1.2,
  9: 1.5,
  10: 1.7,
  11: 2.6,
  12: 2.2,
};

export function buildFinance(ctx: SeedContext): void {
  const { tables } = ctx;

  let counter = 0;
  const cursor = new Date(ctx.windowStart);
  cursor.setUTCDate(1);

  while (cursor <= ctx.now) {
    const month = cursor.getUTCMonth() + 1;
    const year = cursor.getUTCFullYear();

    for (const plan of MONTHLY) {
      counter += 1;
      const multiplier = 1 + (chance(0.5) ? 1 : -1) * plan.variance * Math.random();
      const amount = pesosToCentavos(Math.round(plan.basePhp * multiplier));
      const incurredAt = new Date(Date.UTC(year, month - 1, intBetween(1, 5), 2, 0, 0));
      if (incurredAt > ctx.now) continue;

      tables.expenses.push({
        id: `exp_${String(counter).padStart(6, "0")}`,
        reference: `EXP-${year}-${String(counter).padStart(4, "0")}`,
        category: plan.category,
        description: plan.description,
        amountCentavos: amount,
        vatCentavos: plan.vatable ? vatFromGross(amount) : 0,
        vendor: vendorFor(plan.category),
        incurredAt,
        createdById: ctx.users.manager.id,
        createdAt: incurredAt,
        updatedAt: incurredAt,
      });
    }

    // Advertising, scaled to the season.
    counter += 1;
    const adMultiplier = AD_SPEND_BY_MONTH[month] ?? 1;
    const adAmount = pesosToCentavos(
      Math.round(52000 * adMultiplier * (0.9 + Math.random() * 0.2)),
    );
    const adDate = new Date(Date.UTC(year, month - 1, intBetween(2, 9), 2, 0, 0));
    if (adDate <= ctx.now) {
      tables.expenses.push({
        id: `exp_${String(counter).padStart(6, "0")}`,
        reference: `EXP-${year}-${String(counter).padStart(4, "0")}`,
        category: "ADS",
        description:
          month === 11 || month === 12
            ? "Double day campaign, marketplace and social ads"
            : "Marketplace and social ads",
        amountCentavos: adAmount,
        vatCentavos: vatFromGross(adAmount),
        vendor: pick(["Shopee Ads", "Lazada Sponsored", "Meta Ads", "TikTok Ads"]),
        incurredAt: adDate,
        createdById: ctx.users.manager.id,
        createdAt: adDate,
        updatedAt: adDate,
      });
    }

    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
}

function vendorFor(category: ExpenseCategory): string {
  switch (category) {
    case "RENT":
      return pick(["Ayala Property Management", "Cebu Landco Holdings", "Ortigas Estates"]);
    case "UTILITIES":
      return pick(["Meralco", "Maynilad", "PLDT Enterprise", "Converge ICT"]);
    case "SALARIES":
      return "TechGear PH Payroll";
    case "SHIPPING":
      return pick(["J and T Express", "LBC Express", "Flash Express", "Ninja Van"]);
    case "SUPPLIES":
      return pick(["Pacific Packaging", "Manila Carton Supply"]);
    case "SOFTWARE":
      return pick(["Xero", "Freshdesk", "Adobe", "Google Workspace"]);
    default:
      return "Assorted";
  }
}
