import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createAdjustment } from "@/features/inventory/services/adjustments";
import {
  applyMovement,
  reserveStock,
  runStockTransaction,
} from "@/features/inventory/services/stock";
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
} from "@/features/inventory/services/transfers";
import { InsufficientStockError, InvalidTransitionError } from "@/lib/errors";

import {
  createFixture,
  createTestClient,
  expectLedgerInvariants,
  position,
  receive,
  settle,
} from "./helpers";

/**
 * Races. Each test fires several transactions at the same stock position at
 * once, on separate connections, and checks that the outcome is one of the
 * outcomes a strictly serial execution could have produced: never oversold,
 * never double counted, never a lost update, never a deadlock surfacing to
 * the user, and a ledger whose running balance still reads correctly.
 *
 * docs/PLAN.md section 6.4 lists the defences these exercise.
 */

const databaseUrl = inject("databaseUrl");

describe.skipIf(databaseUrl === "")("stock concurrency", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestClient(databaseUrl);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("sells exactly the units on the shelf when ten buyers race for five", async () => {
    const f = await createFixture(db, { variants: 1 });
    const [variant] = f.variants as [string];
    await receive(db, f, variant, f.warehouseA, 5);

    const { ok, failed } = await settle(
      Array.from({ length: 10 }, () =>
        runStockTransaction(db, (tx) =>
          applyMovement(tx, {
            variantId: variant,
            warehouseId: f.warehouseA,
            type: "SALE",
            reason: "CUSTOMER_SALE",
            qtyDelta: -1,
            actorId: f.userId,
          }),
        ),
      ),
    );

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(5);
    for (const error of failed) expect(error).toBeInstanceOf(InsufficientStockError);

    expect(await position(db, variant, f.warehouseA)).toEqual({ onHand: 0, reserved: 0 });

    // In ledger order the balances count down one at a time, whichever
    // transaction happened to win each lock.
    const balances = await db.stockMovement.findMany({
      where: { variantId: variant, type: "SALE" },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { balanceAfter: true },
    });
    expect(balances.map((row) => row.balanceAfter)).toEqual([4, 3, 2, 1, 0]);
    await expectLedgerInvariants(db, f.variants);
  });

  it("lets concurrent reservations promise no more than is available", async () => {
    const f = await createFixture(db, { variants: 1 });
    const [variant] = f.variants as [string];
    await receive(db, f, variant, f.warehouseA, 6);

    const { ok, failed } = await settle(
      Array.from({ length: 5 }, () =>
        runStockTransaction(db, (tx) =>
          reserveStock(tx, { variantId: variant, warehouseId: f.warehouseA, qty: 2 }),
        ),
      ),
    );

    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(2);
    expect(await position(db, variant, f.warehouseA)).toEqual({ onHand: 6, reserved: 6 });
  });

  it("gives concurrent adjustments unique, consecutive numbers and never oversells", async () => {
    const f = await createFixture(db, { variants: 1 });
    const [variant] = f.variants as [string];
    await receive(db, f, variant, f.warehouseA, 10);

    const { ok, failed } = await settle(
      Array.from({ length: 8 }, () =>
        runStockTransaction(db, (tx) =>
          createAdjustment(
            tx,
            {
              warehouseId: f.warehouseA,
              reason: "DAMAGE",
              note: "",
              lines: [{ variantId: variant, mode: "delta", quantity: -2 }],
            },
            { id: f.userId },
          ),
        ),
      ),
    );

    expect(ok).toHaveLength(5);
    expect(failed).toHaveLength(3);
    expect(await position(db, variant, f.warehouseA)).toEqual({ onHand: 0, reserved: 0 });

    const numbers = ok
      .map((result) => Number(result.reference.split("-")[2]))
      .sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(5);
    const first = numbers[0] ?? 0;
    expect(numbers).toEqual([first, first + 1, first + 2, first + 3, first + 4]);
    await expectLedgerInvariants(db, f.variants);
  });

  it("receives a transfer once when two people press Receive together", async () => {
    const f = await createFixture(db, { variants: 2 });
    const [v0, v1] = f.variants as [string, string];
    await receive(db, f, v0, f.warehouseA, 10);
    await receive(db, f, v1, f.warehouseA, 10);

    const transfer = await runStockTransaction(db, (tx) =>
      createTransfer(
        tx,
        {
          fromWarehouseId: f.warehouseA,
          toWarehouseId: f.warehouseB,
          note: "",
          dispatch: true,
          lines: [
            { variantId: v0, qty: 3 },
            { variantId: v1, qty: 4 },
          ],
        },
        { id: f.userId },
      ),
    );
    const items = await db.stockTransferItem.findMany({
      where: { transferId: transfer.id },
      select: { id: true, qty: true },
    });
    const lines = items.map((item) => ({ itemId: item.id, qtyReceived: item.qty }));

    const { ok, failed } = await settle(
      Array.from({ length: 3 }, () =>
        runStockTransaction(db, (tx) =>
          receiveTransfer(tx, { transferId: transfer.id, note: "", lines }, { id: f.userId }),
        ),
      ),
    );

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const error of failed) expect(error).toBeInstanceOf(InvalidTransitionError);

    expect(await position(db, v0, f.warehouseB)).toEqual({ onHand: 3, reserved: 0 });
    expect(await position(db, v1, f.warehouseB)).toEqual({ onHand: 4, reserved: 0 });
    expect(
      await db.stockMovement.count({
        where: { transferItem: { transferId: transfer.id }, type: "TRANSFER_IN" },
      }),
    ).toBe(2);
    await expectLedgerInvariants(db, f.variants);
  });

  it("does not deadlock when transfers cross in opposite directions", async () => {
    const f = await createFixture(db, { variants: 3 });
    const [v0, v1, v2] = f.variants as [string, string, string];
    for (const variant of f.variants) {
      await receive(db, f, variant, f.warehouseA, 50);
      await receive(db, f, variant, f.warehouseB, 50);
    }

    // A to B lists the SKUs one way round, B to A the other. Without a fixed
    // lock order these two shapes are the textbook deadlock. The drafts are
    // created first because creating one takes the document-number lock,
    // which would queue the transactions before they ever reached the stock.
    const draft = (from: string, to: string, order: string[]) =>
      runStockTransaction(db, (tx) =>
        createTransfer(
          tx,
          {
            fromWarehouseId: from,
            toWarehouseId: to,
            note: "",
            dispatch: false,
            lines: order.map((variantId) => ({ variantId, qty: 1 })),
          },
          { id: f.userId },
        ),
      );

    const drafts = [];
    for (let index = 0; index < 12; index += 1) {
      drafts.push(
        index % 2 === 0
          ? await draft(f.warehouseA, f.warehouseB, [v0, v1, v2])
          : await draft(f.warehouseB, f.warehouseA, [v2, v1, v0]),
      );
    }

    // No retries: a deadlock must not happen at all, not merely be recovered from.
    const { ok, failed } = await settle(
      drafts.map((transfer) =>
        runStockTransaction(db, (tx) => dispatchTransfer(tx, transfer.id, { id: f.userId }), {
          retries: 0,
        }),
      ),
    );

    expect(failed).toEqual([]);
    expect(ok).toHaveLength(12);

    // Six out of each side, nothing received yet: 50 - 6 in each warehouse.
    for (const variant of f.variants) {
      expect((await position(db, variant, f.warehouseA)).onHand).toBe(44);
      expect((await position(db, variant, f.warehouseB)).onHand).toBe(44);
    }
    await expectLedgerInvariants(db, f.variants);
  });

  it("keeps the moving average when receipts land in two warehouses at once", async () => {
    const f = await createFixture(db, { variants: 1 });
    const [variant] = f.variants as [string];

    // Whichever lands first seeds the average; the second weights against it.
    // Either order gives (10 x 100,000 + 10 x 200,000) / 20. A lost update
    // would leave the average at one receipt's cost instead.
    await Promise.all([
      receive(db, f, variant, f.warehouseA, 10, 100_000),
      receive(db, f, variant, f.warehouseB, 10, 200_000),
    ]);

    const row = await db.productVariant.findUniqueOrThrow({
      where: { id: variant },
      select: { avgCostCentavos: true },
    });
    expect(row.avgCostCentavos).toBe(150_000);
    await expectLedgerInvariants(db, f.variants);
  });

  it("applies a count against the shelf as it is, even while a sale lands", async () => {
    const f = await createFixture(db, { variants: 1 });
    const [variant] = f.variants as [string];
    await receive(db, f, variant, f.warehouseA, 10);

    await settle<unknown>([
      runStockTransaction(db, (tx) =>
        createAdjustment(
          tx,
          {
            warehouseId: f.warehouseA,
            reason: "COUNT_CORRECTION",
            note: "",
            lines: [{ variantId: variant, mode: "count", quantity: 7 }],
          },
          { id: f.userId },
        ),
      ),
      runStockTransaction(db, (tx) =>
        applyMovement(tx, {
          variantId: variant,
          warehouseId: f.warehouseA,
          type: "SALE",
          reason: "CUSTOMER_SALE",
          qtyDelta: -2,
          actorId: f.userId,
        }),
      ),
    ]);

    // Count then sale: 7 - 2 = 5. Sale then count: the count sees 8 and sets
    // 7. A count computed from a stale read could land anywhere else.
    const { onHand } = await position(db, variant, f.warehouseA);
    expect([5, 7]).toContain(onHand);
    await expectLedgerInvariants(db, f.variants);
  });
});
