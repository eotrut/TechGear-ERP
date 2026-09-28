import { Prisma, type StockMovementType } from "@prisma/client";

import { aggregateCentavos } from "@/lib/money";

import { bucketKeys, bucketOf, type DateRange } from "./date-range";
import { manilaDaySql, utc, within, type Client } from "./measures";

/**
 * Inventory reports, read from the ledger rather than the StockLevel cache.
 * The cache only knows now; the ledger knows every day, so a valuation can be
 * taken as of any date. As of today the two must agree, and `db:verify`
 * checks that they do.
 */

export type ValuationRow = {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  optionSummary: string;
  categoryName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  qty: number;
  avgCostCentavos: number;
  valueCentavos: number;
};

/**
 * On hand and moving-average cost for every position at the end of `asOf`
 * (exclusive instant). Each position's balance is its last movement's
 * `balanceAfter`; each variant's cost is its last movement's average, the
 * global average of decision D-8.
 */
export async function valuationAsOf(client: Client, asOf: Date): Promise<ValuationRow[]> {
  const rows = await client.$queryRaw<
    {
      variant_id: string;
      sku: string;
      product_id: string;
      product_name: string;
      option_summary: string;
      category_name: string;
      warehouse_id: string;
      warehouse_code: string;
      warehouse_name: string;
      qty: number;
      avg_cost: number;
      value: bigint;
    }[]
  >`
    WITH positions AS (
      SELECT DISTINCT ON (m."variantId", m."warehouseId")
             m."variantId" AS variant_id, m."warehouseId" AS warehouse_id, m."balanceAfter" AS qty
      FROM "StockMovement" m
      WHERE m."occurredAt" < ${utc(asOf)}::timestamp
      ORDER BY m."variantId", m."warehouseId", m."occurredAt" DESC, m."createdAt" DESC, m.id DESC
    ),
    costs AS (
      SELECT DISTINCT ON (m."variantId") m."variantId" AS variant_id, m."avgCostAfterCentavos" AS avg_cost
      FROM "StockMovement" m
      WHERE m."occurredAt" < ${utc(asOf)}::timestamp
      ORDER BY m."variantId", m."occurredAt" DESC, m."createdAt" DESC, m.id DESC
    )
    SELECT p.variant_id, v.sku, pr.id AS product_id, pr.name AS product_name,
           v."optionSummary" AS option_summary, c.name AS category_name,
           w.id AS warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
           p.qty, k.avg_cost, (p.qty::bigint * k.avg_cost)::bigint AS value
    FROM positions p
    JOIN costs k ON k.variant_id = p.variant_id
    JOIN "ProductVariant" v ON v.id = p.variant_id
    JOIN "Product" pr ON pr.id = v."productId"
    JOIN "Category" c ON c.id = pr."categoryId"
    JOIN "Warehouse" w ON w.id = p.warehouse_id
    WHERE p.qty > 0
    ORDER BY value DESC, v.sku
  `;
  return rows.map((row) => ({
    variantId: row.variant_id,
    sku: row.sku,
    productId: row.product_id,
    productName: row.product_name,
    optionSummary: row.option_summary,
    categoryName: row.category_name,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    qty: row.qty,
    avgCostCentavos: row.avg_cost,
    valueCentavos: aggregateCentavos(row.value),
  }));
}

/** Inventory at cost right now, from the StockLevel cache. The dashboard tile. */
export async function inventoryValueNow(
  client: Client,
): Promise<{ value: number; units: number; skus: number }> {
  const [row] = await client.$queryRaw<
    { value: bigint | null; units: bigint | null; skus: bigint }[]
  >`
    SELECT SUM(sl."onHand"::bigint * v."avgCostCentavos")::bigint AS value,
           SUM(sl."onHand")::bigint AS units,
           COUNT(DISTINCT sl."variantId") FILTER (WHERE sl."onHand" > 0)::bigint AS skus
    FROM "StockLevel" sl JOIN "ProductVariant" v ON v.id = sl."variantId"
  `;
  return {
    value: aggregateCentavos(row?.value),
    units: Number(row?.units ?? 0),
    skus: Number(row?.skus ?? 0),
  };
}

// ---------------------------------------------------------- stock movement

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "SALE",
  "RETURN",
  "ADJUSTMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "WRITE_OFF",
] as const satisfies readonly StockMovementType[];

export type MovementTypeRow = {
  type: StockMovementType;
  movements: number;
  unitsIn: number;
  unitsOut: number;
  /** Signed value at the movement's own cost: stock in positive, out negative. */
  valueCentavos: number;
};

export type MovementBucket = { key: string; unitsIn: number; unitsOut: number };

export async function movementSummary(
  client: Client,
  range: DateRange,
  warehouseId?: string,
): Promise<{ byType: MovementTypeRow[]; buckets: MovementBucket[] }> {
  const warehouse = warehouseId ? Prisma.sql`AND "warehouseId" = ${warehouseId}` : Prisma.empty;
  const rows = await client.$queryRaw<
    {
      day: string;
      type: StockMovementType;
      movements: bigint;
      units_in: bigint | null;
      units_out: bigint | null;
      value: bigint | null;
    }[]
  >`
    SELECT ${manilaDaySql(Prisma.sql`"occurredAt"`)} AS day, type,
           COUNT(*)::bigint AS movements,
           SUM(GREATEST("qtyDelta", 0))::bigint AS units_in,
           SUM(GREATEST(-"qtyDelta", 0))::bigint AS units_out,
           SUM(CASE WHEN type = 'WRITE_OFF' THEN -"unitCostCentavos"::bigint
                    ELSE "qtyDelta"::bigint * "unitCostCentavos" END)::bigint AS value
    FROM "StockMovement"
    WHERE ${within(Prisma.sql`"occurredAt"`, range)} ${warehouse}
    GROUP BY 1, 2
  `;

  const byType = new Map<StockMovementType, MovementTypeRow>(
    MOVEMENT_TYPES.map((type) => [
      type,
      { type, movements: 0, unitsIn: 0, unitsOut: 0, valueCentavos: 0 },
    ]),
  );
  const buckets = new Map<string, MovementBucket>(
    bucketKeys(range, range.granularity).map((key) => [key, { key, unitsIn: 0, unitsOut: 0 }]),
  );

  for (const row of rows) {
    const t = byType.get(row.type);
    if (t) {
      t.movements += Number(row.movements);
      t.unitsIn += Number(row.units_in ?? 0);
      t.unitsOut += Number(row.units_out ?? 0);
      t.valueCentavos += aggregateCentavos(row.value);
    }
    // Transfers move stock between shelves, not in or out of the business.
    if (!warehouseId && (row.type === "TRANSFER_IN" || row.type === "TRANSFER_OUT")) continue;
    const b = buckets.get(bucketOf(row.day, range.granularity));
    if (b) {
      b.unitsIn += Number(row.units_in ?? 0);
      b.unitsOut += Number(row.units_out ?? 0);
    }
  }

  return { byType: [...byType.values()], buckets: [...buckets.values()] };
}

// ------------------------------------------------------------ slow-moving

export type SlowMovingRow = {
  variantId: string;
  sku: string;
  productId: string;
  productName: string;
  optionSummary: string;
  categoryName: string;
  onHand: number;
  avgCostCentavos: number;
  valueCentavos: number;
  lastSoldAt: Date | null;
  /** Days since the last sale, or since the stock arrived if it never sold. */
  idleDays: number;
};

/**
 * Stock on hand that has not sold in `days`. A variant that never sold is
 * measured from its first receipt, so a line that landed yesterday is not
 * called slow.
 */
export async function slowMoving(
  client: Client,
  days: number,
  now: Date,
  warehouseId?: string,
): Promise<SlowMovingRow[]> {
  const warehouse = warehouseId ? Prisma.sql`AND sl."warehouseId" = ${warehouseId}` : Prisma.empty;
  const movementWarehouse = warehouseId
    ? Prisma.sql`AND m."warehouseId" = ${warehouseId}`
    : Prisma.empty;
  const rows = await client.$queryRaw<
    {
      variant_id: string;
      sku: string;
      product_id: string;
      product_name: string;
      option_summary: string;
      category_name: string;
      on_hand: bigint;
      avg_cost: number;
      value: bigint;
      last_sold: Date | null;
      idle_days: number;
    }[]
  >`
    WITH stock AS (
      SELECT sl."variantId" AS variant_id, SUM(sl."onHand")::bigint AS on_hand
      FROM "StockLevel" sl
      WHERE sl."onHand" > 0 ${warehouse}
      GROUP BY sl."variantId"
    ),
    activity AS (
      SELECT m."variantId" AS variant_id,
             MAX(m."occurredAt") FILTER (WHERE m.type = 'SALE') AS last_sold,
             MIN(m."occurredAt") FILTER (WHERE m."qtyDelta" > 0) AS first_in
      FROM "StockMovement" m
      WHERE m."variantId" IN (SELECT variant_id FROM stock) ${movementWarehouse}
      GROUP BY m."variantId"
    )
    SELECT s.variant_id, v.sku, p.id AS product_id, p.name AS product_name,
           v."optionSummary" AS option_summary, c.name AS category_name,
           s.on_hand, v."avgCostCentavos" AS avg_cost,
           (s.on_hand * v."avgCostCentavos")::bigint AS value,
           a.last_sold,
           FLOOR(EXTRACT(EPOCH FROM (${utc(now)}::timestamp - COALESCE(a.last_sold, a.first_in))) / 86400)::int
             AS idle_days
    FROM stock s
    JOIN activity a ON a.variant_id = s.variant_id
    JOIN "ProductVariant" v ON v.id = s.variant_id
    JOIN "Product" p ON p.id = v."productId"
    JOIN "Category" c ON c.id = p."categoryId"
    WHERE COALESCE(a.last_sold, a.first_in) < ${utc(now)}::timestamp - make_interval(days => ${days}::int)
    ORDER BY value DESC, v.sku
  `;
  return rows.map((row) => ({
    variantId: row.variant_id,
    sku: row.sku,
    productId: row.product_id,
    productName: row.product_name,
    optionSummary: row.option_summary,
    categoryName: row.category_name,
    onHand: Number(row.on_hand),
    avgCostCentavos: row.avg_cost,
    valueCentavos: aggregateCentavos(row.value),
    lastSoldAt: row.last_sold,
    idleDays: row.idle_days,
  }));
}
