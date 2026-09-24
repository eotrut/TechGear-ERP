import { randomBytes } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect } from "vitest";

import { applyMovement, runStockTransaction } from "@/features/inventory/services/stock";

/**
 * Fixtures for the database suite. Every call makes its own warehouses,
 * variants and user with a random suffix, so tests never share a stock
 * position and can run in any order against the same database.
 */

export function createTestClient(databaseUrl: string): PrismaClient {
  // A pool wide enough that every concurrent transaction in a race test gets
  // its own connection; otherwise the pool, not the locks, would serialise them.
  const adapter = new PrismaPg({ connectionString: databaseUrl, max: 24 });
  return new PrismaClient({ adapter });
}

export type Fixture = {
  userId: string;
  warehouseA: string;
  warehouseB: string;
  variants: string[];
  skus: string[];
};

export async function createFixture(
  db: PrismaClient,
  {
    variants: variantCount = 3,
    reorderLevel = 5,
  }: { variants?: number; reorderLevel?: number } = {},
): Promise<Fixture> {
  const tag = randomBytes(4).toString("hex");

  const user = await db.user.create({
    data: {
      email: `wh-${tag}@test.techgear.ph`,
      name: `Warehouse ${tag}`,
      passwordHash: "not-a-real-hash",
      role: "WAREHOUSE",
    },
    select: { id: true },
  });

  const [warehouseA, warehouseB] = await Promise.all(
    ["A", "B"].map((suffix) =>
      db.warehouse.create({
        data: { code: `T${suffix}-${tag}`.toUpperCase(), name: `Test ${suffix} ${tag}` },
        select: { id: true },
      }),
    ),
  );

  const category = await db.category.create({
    data: { name: `Cat ${tag}`, slug: `cat-${tag}` },
    select: { id: true },
  });
  const brand = await db.brand.create({
    data: { name: `Brand ${tag}`, slug: `brand-${tag}` },
    select: { id: true },
  });
  const product = await db.product.create({
    data: {
      name: `Product ${tag}`,
      slug: `product-${tag}`,
      categoryId: category.id,
      brandId: brand.id,
    },
    select: { id: true },
  });

  const skus: string[] = [];
  const variantIds: string[] = [];
  for (let index = 0; index < variantCount; index += 1) {
    const sku = `TST-${tag}-${index}`.toUpperCase();
    const variant = await db.productVariant.create({
      data: {
        productId: product.id,
        name: `Variant ${index}`,
        optionSummary: `Variant ${index}`,
        sku,
        priceCentavos: 250_000,
        reorderLevel,
        reorderQty: 20,
      },
      select: { id: true },
    });
    skus.push(sku);
    variantIds.push(variant.id);
  }

  if (!warehouseA || !warehouseB) throw new Error("fixture warehouses missing");
  return {
    userId: user.id,
    warehouseA: warehouseA.id,
    warehouseB: warehouseB.id,
    variants: variantIds,
    skus,
  };
}

/** Put stock on a shelf the way the app does: a costed receipt. */
export async function receive(
  db: PrismaClient,
  fixture: Fixture,
  variantId: string,
  warehouseId: string,
  qty: number,
  unitCostCentavos = 100_000,
) {
  return runStockTransaction(db, (tx) =>
    applyMovement(tx, {
      variantId,
      warehouseId,
      type: "RECEIPT",
      reason: "PURCHASE_RECEIPT",
      qtyDelta: qty,
      unitCostCentavos,
      actorId: fixture.userId,
    }),
  );
}

export async function position(db: PrismaClient, variantId: string, warehouseId: string) {
  const level = await db.stockLevel.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId } },
    select: { onHand: true, reserved: true },
  });
  return level ?? { onHand: 0, reserved: 0 };
}

/** Run every promise and sort the outcomes into successes and failures. */
export async function settle<T>(work: Promise<T>[]) {
  const results = await Promise.allSettled(work);
  return {
    ok: results
      .filter((r): r is PromiseFulfilledResult<Awaited<T>> => r.status === "fulfilled")
      .map((r) => r.value),
    failed: results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason as Error),
  };
}

/**
 * The ledger invariants from docs/PLAN.md section 6.5, checked for the given
 * variants. The same checks `npm run db:verify` runs against the seed.
 */
export async function expectLedgerInvariants(db: PrismaClient, variantIds: string[]) {
  // 1. Sum of movements equals the cached on-hand for every position.
  const drift = await db.$queryRaw<{ variantId: string; onHand: number; summed: number }[]>`
    SELECT sl."variantId", sl."onHand", COALESCE(SUM(sm."qtyDelta"), 0)::int AS summed
    FROM "StockLevel" sl
    LEFT JOIN "StockMovement" sm
      ON sm."variantId" = sl."variantId" AND sm."warehouseId" = sl."warehouseId"
    WHERE sl."variantId" = ANY(${variantIds}::text[])
    GROUP BY sl."variantId", sl."warehouseId", sl."onHand"
    HAVING sl."onHand" <> COALESCE(SUM(sm."qtyDelta"), 0)
  `;
  expect(drift, "StockLevel drifted from the ledger").toEqual([]);

  // 2. Running balance is consistent at every point, in occurredAt order.
  const breaks = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM (
      SELECT id, "balanceAfter",
             SUM("qtyDelta") OVER (
               PARTITION BY "variantId", "warehouseId"
               ORDER BY "occurredAt", id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS running
      FROM "StockMovement"
      WHERE "variantId" = ANY(${variantIds}::text[])
    ) t WHERE "balanceAfter" <> running
  `;
  expect(breaks, "running balance reads out of order").toEqual([]);

  // Timestamps are strictly increasing per variant, so the order is never a tie.
  const ties = await db.$queryRaw<{ variantId: string }[]>`
    SELECT "variantId" FROM "StockMovement"
    WHERE "variantId" = ANY(${variantIds}::text[])
    GROUP BY "variantId", "occurredAt" HAVING COUNT(*) > 1
  `;
  expect(ties, "two movements share a timestamp").toEqual([]);

  // 3. Never negative, reservations within on-hand.
  const negative = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "StockLevel"
    WHERE "variantId" = ANY(${variantIds}::text[])
      AND ("onHand" < 0 OR reserved < 0 OR reserved > "onHand")
  `;
  expect(negative).toEqual([]);
  const negativeBalance = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "StockMovement"
    WHERE "variantId" = ANY(${variantIds}::text[]) AND "balanceAfter" < 0
  `;
  expect(negativeBalance).toEqual([]);

  // 5. The variant's average matches its latest movement.
  const avgDrift = await db.$queryRaw<{ id: string }[]>`
    SELECT latest."variantId" AS id FROM (
      SELECT DISTINCT ON (sm."variantId") sm."variantId", sm."avgCostAfterCentavos"
      FROM "StockMovement" sm
      WHERE sm."variantId" = ANY(${variantIds}::text[])
      ORDER BY sm."variantId", sm."occurredAt" DESC, sm.id DESC
    ) latest
    JOIN "ProductVariant" v ON v.id = latest."variantId"
    WHERE v."avgCostCentavos" <> latest."avgCostAfterCentavos"
  `;
  expect(avgDrift, "moving average drifted from the ledger").toEqual([]);
}
