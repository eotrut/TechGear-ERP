import { Prisma, type ExpenseCategory } from "@prisma/client";

import { aggregateCentavos } from "@/lib/money";

import { bucketKeys, bucketOf, type DateRange, type Granularity, type Window } from "./date-range";
import {
  IS_REPLACEMENT,
  manilaDaySql,
  REALISED_SQL,
  RESTOCKED_CTE,
  within,
  type Client,
} from "./measures";
import { addComponents, emptyComponents, type PlComponents } from "./pl-rules";
import { salesDaily } from "./sales";

/**
 * Profit and loss, and the VAT summary. Both are built from rows per Manila
 * day, so a statement's total is exactly the sum of the months in its chart.
 */

type DayAmount = { day: string; amount: bigint | null };

type Bounds = Pick<Window, "from" | "to">;

async function expensesByDay(client: Client, window: Bounds) {
  return client.$queryRaw<
    {
      day: string;
      category: ExpenseCategory;
      net: bigint | null;
      vat: bigint | null;
      vatable_net: bigint | null;
    }[]
  >`
    SELECT ${manilaDaySql(Prisma.sql`"incurredAt"`)} AS day, category,
           SUM("amountCentavos" - "vatCentavos")::bigint AS net,
           SUM("vatCentavos")::bigint AS vat,
           SUM(CASE WHEN "vatCentavos" > 0 THEN "amountCentavos" - "vatCentavos" ELSE 0 END)::bigint
             AS vatable_net
    FROM "Expense"
    WHERE ${within(Prisma.sql`"incurredAt"`, window)}
    GROUP BY 1, 2
  `;
}

/** Cost of units shipped free against a warranty claim (D-20). */
async function warrantyCostByDay(client: Client, window: Bounds) {
  return client.$queryRaw<DayAmount[]>`
    SELECT ${manilaDaySql(Prisma.sql`o."placedAt"`)} AS day, SUM(o."costTotalCentavos")::bigint AS amount
    FROM "Order" o
    WHERE o.status IN (${REALISED_SQL}) AND ${IS_REPLACEMENT}
      AND ${within(Prisma.sql`o."placedAt"`, window)}
    GROUP BY 1
  `;
}

/**
 * Fully refunded orders are not sales (D-44), so their cost is not COGS. What
 * came back to the shelf cost nothing; what did not is a loss, dated like the
 * order so it lands in the same month as the sale it undid.
 */
async function refundedLossByDay(client: Client, window: Bounds) {
  return client.$queryRaw<DayAmount[]>`
    WITH ${RESTOCKED_CTE}
    SELECT ${manilaDaySql(Prisma.sql`o."placedAt"`)} AS day,
           SUM(o."costTotalCentavos" - COALESCE(r.cost, 0))::bigint AS amount
    FROM "Order" o
    LEFT JOIN restocked r ON r.order_id = o.id
    WHERE o.status = 'REFUNDED' AND NOT ${IS_REPLACEMENT}
      AND ${within(Prisma.sql`o."placedAt"`, window)}
    GROUP BY 1
  `;
}

/** Stock adjustments at cost, losses positive. A count that found units is a gain. */
async function adjustmentsByDay(client: Client, window: Bounds) {
  return client.$queryRaw<DayAmount[]>`
    SELECT ${manilaDaySql(Prisma.sql`"occurredAt"`)} AS day,
           SUM(-"qtyDelta"::bigint * "unitCostCentavos")::bigint AS amount
    FROM "StockMovement"
    WHERE type = 'ADJUSTMENT' AND ${within(Prisma.sql`"occurredAt"`, window)}
    GROUP BY 1
  `;
}

/** Every P&L component for every day in the window that had any. */
export async function profitByDay(
  client: Client,
  window: Bounds,
): Promise<Map<string, PlComponents>> {
  const [sales, expenses, warranty, refunded, adjustments] = await Promise.all([
    salesDaily(client, window),
    expensesByDay(client, window),
    warrantyCostByDay(client, window),
    refundedLossByDay(client, window),
    adjustmentsByDay(client, window),
  ]);

  const days = new Map<string, PlComponents>();
  const at = (day: string) => {
    let entry = days.get(day);
    if (!entry) {
      entry = emptyComponents();
      days.set(day, entry);
    }
    return entry;
  };

  for (const row of sales) {
    const entry = at(row.day);
    entry.netSales += row.netSales;
    entry.cogs += row.cogs;
  }
  for (const row of expenses) at(row.day).expenses[row.category] += aggregateCentavos(row.net);
  for (const row of warranty) at(row.day).warrantyReplacements += aggregateCentavos(row.amount);
  for (const row of refunded) at(row.day).refundedStockLoss += aggregateCentavos(row.amount);
  for (const row of adjustments) at(row.day).inventoryAdjustments += aggregateCentavos(row.amount);

  return days;
}

export type PlBucket = { key: string; components: PlComponents };

function foldPl(
  days: Map<string, PlComponents>,
  window: Window,
  granularity: Granularity,
): { total: PlComponents; buckets: PlBucket[] } {
  const buckets = new Map<string, PlBucket>(
    bucketKeys(window, granularity).map((key) => [key, { key, components: emptyComponents() }]),
  );
  const total = emptyComponents();
  for (const [day, components] of days) {
    addComponents(total, components);
    const bucket = buckets.get(bucketOf(day, granularity));
    if (bucket) addComponents(bucket.components, components);
  }
  return { total, buckets: [...buckets.values()] };
}

export async function profitAndLoss(client: Client, range: DateRange) {
  const [current, previous] = await Promise.all([
    profitByDay(client, range),
    profitByDay(client, range.previous),
  ]);
  const folded = foldPl(current, range, range.granularity);
  return {
    total: folded.total,
    buckets: folded.buckets,
    previous: foldPl(previous, range.previous, range.granularity).total,
  };
}

// ------------------------------------------------------------------ VAT

export type VatFigures = {
  vatableSales: number;
  outputVat: number;
  purchasesNet: number;
  inputVatPurchases: number;
  expensesNet: number;
  inputVatExpenses: number;
};

export type VatBucket = VatFigures & { key: string; netPayable: number };

function emptyVat(): VatFigures {
  return {
    vatableSales: 0,
    outputVat: 0,
    purchasesNet: 0,
    inputVatPurchases: 0,
    expensesNet: 0,
    inputVatExpenses: 0,
  };
}

/**
 * Output VAT from the sales base, input VAT from supplier bills (by issue
 * date, drafts and voided bills excluded) and from expenses. Net payable is
 * output less input, what a quarterly 2550Q would carry before any carryover.
 */
export async function vatSummary(client: Client, range: DateRange) {
  const [sales, bills, expenses] = await Promise.all([
    salesDaily(client, range),
    client.$queryRaw<{ day: string; net: bigint | null; vat: bigint | null }[]>`
      SELECT ${manilaDaySql(Prisma.sql`"issueDate"`)} AS day,
             SUM("subtotalCentavos")::bigint AS net, SUM("vatCentavos")::bigint AS vat
      FROM "SupplierBill"
      WHERE status NOT IN ('DRAFT', 'VOID') AND ${within(Prisma.sql`"issueDate"`, range)}
      GROUP BY 1
    `,
    expensesByDay(client, range),
  ]);

  const buckets = new Map<string, VatBucket>(
    bucketKeys(range, range.granularity).map((key) => [key, { key, ...emptyVat(), netPayable: 0 }]),
  );
  const bucket = (day: string) => buckets.get(bucketOf(day, range.granularity));

  for (const row of sales) {
    const b = bucket(row.day);
    if (!b) continue;
    b.vatableSales += row.netSales;
    b.outputVat += row.vat;
  }
  for (const row of bills) {
    const b = bucket(row.day);
    if (!b) continue;
    b.purchasesNet += aggregateCentavos(row.net);
    b.inputVatPurchases += aggregateCentavos(row.vat);
  }
  for (const row of expenses) {
    const b = bucket(row.day);
    if (!b) continue;
    b.expensesNet += aggregateCentavos(row.vatable_net);
    b.inputVatExpenses += aggregateCentavos(row.vat);
  }

  const rows = [...buckets.values()].map((b) => ({
    ...b,
    netPayable: b.outputVat - b.inputVatPurchases - b.inputVatExpenses,
  }));
  const total = rows.reduce(
    (sum, row) => ({
      vatableSales: sum.vatableSales + row.vatableSales,
      outputVat: sum.outputVat + row.outputVat,
      purchasesNet: sum.purchasesNet + row.purchasesNet,
      inputVatPurchases: sum.inputVatPurchases + row.inputVatPurchases,
      expensesNet: sum.expensesNet + row.expensesNet,
      inputVatExpenses: sum.inputVatExpenses + row.inputVatExpenses,
      netPayable: sum.netPayable + row.netPayable,
    }),
    { ...emptyVat(), netPayable: 0 },
  );
  return { rows, total };
}
