import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Read paths for the register. One statement each, with the shelf position
 * for the register's store and the product's primary image joined in, so a
 * scan is one round trip however many tiles come back.
 */

export type RegisterItem = {
  id: string;
  sku: string;
  barcode: string | null;
  productName: string;
  optionSummary: string;
  priceCentavos: number;
  onHand: number;
  reserved: number;
  imageUrl: string | null;
};

const SELECT_ITEM = Prisma.sql`
  v.id, v.sku, v.barcode, p.name AS "productName", v."optionSummary", v."priceCentavos",
  COALESCE(sl."onHand", 0)::int AS "onHand", COALESCE(sl.reserved, 0)::int AS reserved,
  img.url AS "imageUrl"
`;

const PRIMARY_IMAGE = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT url FROM "ProductImage"
    WHERE "productId" = p.id
    ORDER BY "isPrimary" DESC, "sortOrder" ASC
    LIMIT 1
  ) img ON TRUE
`;

const ON_SALE = Prisma.sql`
  v."deletedAt" IS NULL AND p."deletedAt" IS NULL AND v."isActive" AND p.status = 'ACTIVE'
`;

/**
 * Search as the cashier types or scans. An exact SKU or barcode ranks first,
 * which is what lets Enter after a scan add the right item without looking;
 * then anything the store can still sell, then the rest by name.
 */
export async function registerSearch(query: string, warehouseId: string): Promise<RegisterItem[]> {
  const like = `%${query}%`;
  return db.$queryRaw<RegisterItem[]>`
    SELECT ${SELECT_ITEM}
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    LEFT JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId}
    ${PRIMARY_IMAGE}
    WHERE ${ON_SALE}
      AND (v.sku ILIKE ${like} OR v.barcode = ${query} OR p.name ILIKE ${like}
           OR v."optionSummary" ILIKE ${like})
    ORDER BY (v.sku ILIKE ${query} OR v.barcode = ${query}) DESC,
             (COALESCE(sl."onHand", 0) - COALESCE(sl.reserved, 0) > 0) DESC,
             p.name ASC, v.sku ASC
    LIMIT 24
  `;
}

/**
 * What this counter sells most, over the last 90 days, among items the store
 * still has: the grid a cashier sees before typing anything. The window is
 * computed in UTC inside the database, because "OrderItem" timestamps are
 * stored as UTC and the session runs in Manila time.
 */
export async function quickPicks(warehouseId: string): Promise<RegisterItem[]> {
  return db.$queryRaw<RegisterItem[]>`
    WITH sold AS (
      SELECT oi."variantId", SUM(oi.qty)::int AS units
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.channel = 'POS'
        AND o.status IN ('PAID', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED')
        AND o."placedAt" >= (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '90 days'
      GROUP BY oi."variantId"
    )
    SELECT ${SELECT_ITEM}
    FROM sold
    JOIN "ProductVariant" v ON v.id = sold."variantId"
    JOIN "Product" p ON p.id = v."productId"
    JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = ${warehouseId}
    ${PRIMARY_IMAGE}
    WHERE ${ON_SALE} AND sl."onHand" - sl.reserved > 0
    ORDER BY sold.units DESC, v.sku ASC
    LIMIT 12
  `;
}
