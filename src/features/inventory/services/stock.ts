import type { Prisma, PrismaClient, StockMovementType, StockReason } from "@prisma/client";

import { notify } from "@/features/notifications/services/notify";
import { DomainError, InsufficientStockError, NotFoundError } from "@/lib/errors";
import { movingAverageCost } from "@/lib/stock-math";

import {
  assertMovementShape,
  MOVEMENT_RULES,
  stockAlertCrossing,
  type StockAlert,
} from "./movement-rules";

/**
 * The stock service. The only code in the application that writes StockLevel.
 *
 * StockMovement is the append-only truth; StockLevel is a cache of it that
 * lets list pages avoid summing the ledger. Every write to the cache happens
 * here, in the same transaction as the movement that justifies it.
 * docs/PLAN.md section 6.
 *
 * Concurrency, in the order the defences apply:
 *
 *  1. Variant row locks. Every function locks the ProductVariant row before
 *     touching any of its stock. That one lock guards the variant's positions
 *     in every warehouse and its moving-average cost, so two receipts cannot
 *     both read the old average and one of them lose its update. Flows that
 *     touch several variants call `lockVariants` first, which takes all of
 *     them in one statement in a fixed order, so two transfers of the same
 *     SKUs in opposite directions queue instead of deadlocking.
 *
 *  2. Conditional atomic decrement. The UPDATE that takes stock out carries
 *     the stock check in its WHERE clause, so there is no gap between reading
 *     a quantity and writing it. No row back means not enough stock.
 *
 *  3. The CHECK constraint on StockLevel (onHand >= 0, 0 <= reserved <=
 *     onHand), for any future code path that forgets 1 and 2.
 *
 *  4. `runStockTransaction` retries once on a deadlock or serialization
 *     failure, with jitter, before letting the error surface.
 *
 * Ledger ordering. A movement's `occurredAt` is taken from the database clock
 * after the variant lock is held, and forced strictly later than the
 * variant's previous movement. Taking the time before the lock would let a
 * transaction that waited stamp itself earlier than the one it waited for,
 * and the running balance on the ledger page would read out of order.
 *
 * No `next/headers`, no `auth()`, no `@/lib/db`: every function takes the
 * transaction client, so the seed, the actions and the tests share this code.
 */

type Tx = Prisma.TransactionClient;

export type MovementRefs = {
  orderItemId?: string;
  purchaseReceiptItemId?: string;
  returnItemId?: string;
  adjustmentItemId?: string;
  transferItemId?: string;
};

export type MovementInput = {
  variantId: string;
  warehouseId: string;
  type: StockMovementType;
  reason: StockReason;
  /** Signed: positive into the warehouse, negative out of it. */
  qtyDelta: number;
  /** Required where MOVEMENT_RULES says the cost is supplied. */
  unitCostCentavos?: number;
  /** SALE only: take the units out of the reservation made when the order went PENDING. */
  fromReserved?: boolean;
  note?: string | null;
  actorId: string | null;
  refs?: MovementRefs;
};

export type MovementResult = {
  id: string;
  variantId: string;
  warehouseId: string;
  qtyDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  reservedAfter: number;
  unitCostCentavos: number;
  avgCostAfterCentavos: number;
  occurredAt: Date;
  alert: StockAlert | null;
};

export type LockedVariant = {
  id: string;
  sku: string;
  avgCostCentavos: number;
  reorderLevel: number;
};

// ------------------------------------------------------------------- locking

/**
 * Lock every named variant, in one statement, in a fixed byte order. Call this
 * at the top of any flow that moves more than one variant. `COLLATE "C"` pins
 * the order to raw bytes so it cannot differ between databases with different
 * default collations.
 */
export async function lockVariants(
  tx: Tx,
  variantIds: readonly string[],
): Promise<Map<string, LockedVariant>> {
  const ids = [...new Set(variantIds)];
  if (ids.length === 0) return new Map();

  const rows = await tx.$queryRaw<LockedVariant[]>`
    SELECT id, sku, "avgCostCentavos", "reorderLevel"
    FROM "ProductVariant"
    WHERE id = ANY(${ids}::text[])
    ORDER BY id COLLATE "C"
    FOR UPDATE
  `;

  const found = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new NotFoundError(
      missing.length === 1
        ? "One of those product variants no longer exists."
        : `${missing.length} of those product variants no longer exist.`,
    );
  }
  return found;
}

async function lockVariant(tx: Tx, variantId: string): Promise<LockedVariant> {
  // Re-locking a row this transaction already holds is a no-op, so this is
  // safe after lockVariants, and it re-reads the average in case an earlier
  // movement in the same transaction moved it.
  const locked = await lockVariants(tx, [variantId]);
  const variant = locked.get(variantId);
  if (!variant) throw new NotFoundError("That product variant no longer exists.");
  return variant;
}

/**
 * The timestamp for this variant's next movement: the database clock in UTC,
 * but never earlier than one millisecond after the variant's latest movement.
 * Only meaningful while the variant row lock is held.
 */
async function nextOccurredAt(tx: Tx, variantId: string): Promise<Date> {
  const [row] = await tx.$queryRaw<{ at: Date }[]>`
    SELECT GREATEST(
      date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC'),
      COALESCE(MAX("occurredAt") + interval '1 millisecond', '-infinity'::timestamp)
    ) AS at
    FROM "StockMovement"
    WHERE "variantId" = ${variantId}
  `;
  if (!row) throw new Error("Could not read the database clock.");
  return new Date(row.at);
}

async function warehouseCode(tx: Tx, warehouseId: string): Promise<string> {
  const warehouse = await tx.warehouse.findUnique({
    where: { id: warehouseId },
    select: { code: true },
  });
  return warehouse?.code ?? "that warehouse";
}

async function readPosition(
  tx: Tx,
  variantId: string,
  warehouseId: string,
): Promise<{ onHand: number; reserved: number }> {
  const level = await tx.stockLevel.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId } },
    select: { onHand: true, reserved: true },
  });
  return level ?? { onHand: 0, reserved: 0 };
}

async function raiseAlert(
  tx: Tx,
  alert: StockAlert,
  variant: LockedVariant,
  warehouseId: string,
  availableAfter: number,
): Promise<void> {
  const code = await warehouseCode(tx, warehouseId);
  const out = alert === "OUT_OF_STOCK";

  await notify(tx, {
    type: alert,
    title: out ? `Out of stock: ${variant.sku}` : `Low stock: ${variant.sku}`,
    body: out
      ? `${variant.sku} has nothing left to sell in ${code}.`
      : `${variant.sku} is down to ${availableAfter} available in ${code}, reorder point ${variant.reorderLevel}.`,
    link: `/inventory/alerts?warehouseId=${warehouseId}`,
  });
}

// ----------------------------------------------------------------- movements

/**
 * Apply one movement: validate its shape, lock the variant, update the cached
 * level with the stock check inside the UPDATE itself, move the average if the
 * type calls for it, and append the ledger row. Throws InsufficientStockError
 * without writing anything when stock is short; the caller's transaction then
 * rolls back every earlier line with it.
 */
export async function applyMovement(tx: Tx, input: MovementInput): Promise<MovementResult> {
  assertMovementShape(input);

  const rule = MOVEMENT_RULES[input.type];
  const { variantId, warehouseId, qtyDelta } = input;

  const variant = await lockVariant(tx, variantId);
  const occurredAt = await nextOccurredAt(tx, variantId);

  let onHandAfter: number;
  let reservedAfter: number;
  let availableBefore: number;

  if (qtyDelta > 0) {
    // Inbound. The variant lock means no one else can be creating this row.
    const level = await tx.stockLevel.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      create: { variantId, warehouseId, onHand: qtyDelta, reserved: 0 },
      update: { onHand: { increment: qtyDelta } },
      select: { onHand: true, reserved: true },
    });
    onHandAfter = level.onHand;
    reservedAfter = level.reserved;
    availableBefore = level.onHand - qtyDelta - level.reserved;
  } else if (qtyDelta < 0) {
    const qty = -qtyDelta;

    // The WHERE clause is the stock check. A sale consumes its reservation;
    // everything else may only take what is not promised to a pending order.
    const rows = input.fromReserved
      ? await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
          UPDATE "StockLevel"
             SET "onHand" = "onHand" - ${qty}, "reserved" = "reserved" - ${qty},
                 "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
           WHERE "variantId" = ${variantId} AND "warehouseId" = ${warehouseId}
             AND "onHand" >= ${qty} AND "reserved" >= ${qty}
          RETURNING "onHand", "reserved"
        `
      : await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
          UPDATE "StockLevel"
             SET "onHand" = "onHand" - ${qty}, "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
           WHERE "variantId" = ${variantId} AND "warehouseId" = ${warehouseId}
             AND "onHand" - "reserved" >= ${qty}
          RETURNING "onHand", "reserved"
        `;

    const level = rows[0];
    if (!level) {
      const position = await readPosition(tx, variantId, warehouseId);
      const available = input.fromReserved
        ? Math.min(position.onHand, position.reserved)
        : position.onHand - position.reserved;
      throw new InsufficientStockError(
        variant.sku,
        await warehouseCode(tx, warehouseId),
        qty,
        Math.max(0, available),
      );
    }

    onHandAfter = level.onHand;
    reservedAfter = level.reserved;
    availableBefore = input.fromReserved
      ? level.onHand - level.reserved
      : level.onHand + qty - level.reserved;
  } else {
    // A write-off records a cost without moving a unit.
    const position = await readPosition(tx, variantId, warehouseId);
    onHandAfter = position.onHand;
    reservedAfter = position.reserved;
    availableBefore = position.onHand - position.reserved;
  }

  const unitCostCentavos =
    rule.cost === "supplied" ? (input.unitCostCentavos ?? 0) : variant.avgCostCentavos;

  let avgCostAfterCentavos = variant.avgCostCentavos;

  if (rule.recomputesAverage) {
    // Total on hand across every warehouse before this movement: one average
    // per variant, global (decision D-8). Stable because the variant is locked.
    const [totals] = await tx.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM("onHand"), 0)::int AS total
      FROM "StockLevel" WHERE "variantId" = ${variantId}
    `;
    const totalBefore = (totals?.total ?? 0) - qtyDelta;

    avgCostAfterCentavos = movingAverageCost(
      totalBefore,
      variant.avgCostCentavos,
      qtyDelta,
      unitCostCentavos,
    );

    await tx.productVariant.update({
      where: { id: variantId },
      data: {
        avgCostCentavos: avgCostAfterCentavos,
        ...(input.type === "RECEIPT" ? { lastCostCentavos: unitCostCentavos } : {}),
      },
      select: { id: true },
    });
  }

  const movement = await tx.stockMovement.create({
    data: {
      variantId,
      warehouseId,
      type: input.type,
      reason: input.reason,
      qtyDelta,
      balanceAfter: onHandAfter,
      unitCostCentavos,
      avgCostAfterCentavos,
      note: input.note ?? null,
      actorId: input.actorId,
      occurredAt,
      createdAt: occurredAt,
      orderItemId: input.refs?.orderItemId ?? null,
      purchaseReceiptItemId: input.refs?.purchaseReceiptItemId ?? null,
      returnItemId: input.refs?.returnItemId ?? null,
      adjustmentItemId: input.refs?.adjustmentItemId ?? null,
      transferItemId: input.refs?.transferItemId ?? null,
    },
    select: { id: true },
  });

  const availableAfter = onHandAfter - reservedAfter;
  const alert = stockAlertCrossing(availableBefore, availableAfter, variant.reorderLevel);
  if (alert) await raiseAlert(tx, alert, variant, warehouseId, availableAfter);

  return {
    id: movement.id,
    variantId,
    warehouseId,
    qtyDelta,
    balanceBefore: onHandAfter - qtyDelta,
    balanceAfter: onHandAfter,
    reservedAfter,
    unitCostCentavos,
    avgCostAfterCentavos,
    occurredAt,
    alert,
  };
}

// -------------------------------------------------------------- reservations

/**
 * Promise units to a pending order. Reservation writes no movement, because
 * nothing has physically moved; it narrows what is available to everyone else.
 */
export async function reserveStock(
  tx: Tx,
  input: { variantId: string; warehouseId: string; qty: number },
): Promise<{ onHand: number; reserved: number; alert: StockAlert | null }> {
  const { variantId, warehouseId, qty } = input;
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw new DomainError(`Reserve a positive whole quantity, received ${qty}.`);
  }

  const variant = await lockVariant(tx, variantId);
  const rows = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
    UPDATE "StockLevel"
       SET "reserved" = "reserved" + ${qty},
           "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
     WHERE "variantId" = ${variantId} AND "warehouseId" = ${warehouseId}
       AND "onHand" - "reserved" >= ${qty}
    RETURNING "onHand", "reserved"
  `;

  const level = rows[0];
  if (!level) {
    const position = await readPosition(tx, variantId, warehouseId);
    throw new InsufficientStockError(
      variant.sku,
      await warehouseCode(tx, warehouseId),
      qty,
      Math.max(0, position.onHand - position.reserved),
    );
  }

  const availableAfter = level.onHand - level.reserved;
  const alert = stockAlertCrossing(availableAfter + qty, availableAfter, variant.reorderLevel);
  if (alert) await raiseAlert(tx, alert, variant, warehouseId, availableAfter);

  return { onHand: level.onHand, reserved: level.reserved, alert };
}

/** Give a reservation back, when a pending order is cancelled. */
export async function releaseStock(
  tx: Tx,
  input: { variantId: string; warehouseId: string; qty: number },
): Promise<{ onHand: number; reserved: number }> {
  const { variantId, warehouseId, qty } = input;
  if (!Number.isSafeInteger(qty) || qty <= 0) {
    throw new DomainError(`Release a positive whole quantity, received ${qty}.`);
  }

  const variant = await lockVariant(tx, variantId);
  const rows = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
    UPDATE "StockLevel"
       SET "reserved" = "reserved" - ${qty},
           "updatedAt" = clock_timestamp() AT TIME ZONE 'UTC'
     WHERE "variantId" = ${variantId} AND "warehouseId" = ${warehouseId}
       AND "reserved" >= ${qty}
    RETURNING "onHand", "reserved"
  `;

  const level = rows[0];
  if (!level) {
    const position = await readPosition(tx, variantId, warehouseId);
    throw new DomainError(
      `${variant.sku} has only ${position.reserved} reserved in ${await warehouseCode(
        tx,
        warehouseId,
      )}, so ${qty} cannot be released.`,
    );
  }
  return level;
}

// -------------------------------------------------------------- transactions

/** Interactive transaction limits from docs/PLAN.md section 6.4. */
export const STOCK_TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 5_000 } as const;

const RETRYABLE_SQLSTATES = new Set(["40P01", "40001"]);

/**
 * Deadlock (40P01) and serialization failure (40001) are safe to retry: the
 * database rolled the whole transaction back. Prisma reports them in several
 * shapes depending on where they surfaced, so look in each.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object") break;
    const candidate = current as {
      code?: unknown;
      meta?: { code?: unknown };
      message?: unknown;
      cause?: unknown;
    };

    if (candidate.code === "P2034") return true;
    if (typeof candidate.code === "string" && RETRYABLE_SQLSTATES.has(candidate.code)) return true;
    if (typeof candidate.meta?.code === "string" && RETRYABLE_SQLSTATES.has(candidate.meta.code)) {
      return true;
    }
    if (
      typeof candidate.message === "string" &&
      /deadlock detected|could not serialize access/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Run a stock-moving unit of work in one interactive transaction, retrying
 * once on deadlock or serialization failure. Takes the client as an argument
 * so tests can point it at their own database.
 */
export async function runStockTransaction<T>(
  client: PrismaClient,
  work: (tx: Tx) => Promise<T>,
  { retries = 1 }: { retries?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await client.$transaction(work, STOCK_TRANSACTION_OPTIONS);
    } catch (error) {
      if (attempt >= retries || !isRetryableTransactionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 80));
    }
  }
}
