import { config as loadEnv } from "dotenv";
import pg from "pg";

/**
 * Direct reads against the app's database. A flow is only proven when the
 * rows changed, not when a page rendered, so every spec checks here.
 */
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  allowExitOnIdle: true,
});

export async function one<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await pool.query<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function all<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}

export type Position = { onHand: number; reserved: number };

/** One variant's position in one warehouse, zero when it has never had stock there. */
export async function positionOf(variantId: string, warehouseCode: string): Promise<Position> {
  const row = await one<Position>(
    `SELECT sl."onHand", sl.reserved
       FROM "StockLevel" sl JOIN "Warehouse" w ON w.id = sl."warehouseId"
      WHERE sl."variantId" = $1 AND w.code = $2`,
    [variantId, warehouseCode],
  );
  return row ?? { onHand: 0, reserved: 0 };
}
