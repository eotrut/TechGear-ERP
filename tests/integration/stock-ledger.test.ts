import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createAdjustment } from "@/features/inventory/services/adjustments";
import {
  applyMovement,
  releaseStock,
  reserveStock,
  runStockTransaction,
} from "@/features/inventory/services/stock";
import {
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
} from "@/features/inventory/services/transfers";
import { DomainError, InsufficientStockError, InvalidTransitionError } from "@/lib/errors";
import { manilaYear } from "@/lib/format";
import { formatReference } from "@/lib/numbering";

import {
  createFixture,
  createTestClient,
  expectLedgerInvariants,
  position,
  receive,
  type Fixture,
} from "./helpers";

/**
 * The stock ledger against a real Postgres. These are the rules from
 * docs/PLAN.md section 6, exercised through the same service functions the
 * server actions call, with the ledger invariants re-checked after each one.
 */

const databaseUrl = inject("databaseUrl");

describe.skipIf(databaseUrl === "")("stock ledger", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestClient(databaseUrl);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // ------------------------------------------------------------ movements

  describe("movements", () => {
    it("creates the position on first receipt and seeds the moving average", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];

      const first = await receive(db, f, variant, f.warehouseA, 10, 100_000);
      expect(first.balanceBefore).toBe(0);
      expect(first.balanceAfter).toBe(10);
      expect(first.avgCostAfterCentavos).toBe(100_000);

      // Second receipt at a different cost, in a different warehouse: the
      // average is global per variant and weighted by units (decision D-8).
      const second = await receive(db, f, variant, f.warehouseB, 30, 140_000);
      expect(second.avgCostAfterCentavos).toBe(130_000);

      const row = await db.productVariant.findUniqueOrThrow({
        where: { id: variant },
        select: { avgCostCentavos: true, lastCostCentavos: true },
      });
      expect(row).toEqual({ avgCostCentavos: 130_000, lastCostCentavos: 140_000 });
      await expectLedgerInvariants(db, f.variants);
    });

    it("stamps movements in UTC, strictly later than the variant's previous one", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];

      const before = Date.now();
      const a = await receive(db, f, variant, f.warehouseA, 1);
      const b = await receive(db, f, variant, f.warehouseB, 1);
      const after = Date.now();

      // Within a few seconds of the app clock: a timezone slip would be 8 hours.
      expect(a.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(b.occurredAt.getTime()).toBeLessThanOrEqual(after + 5_000);
      expect(b.occurredAt.getTime()).toBeGreaterThan(a.occurredAt.getTime());
    });

    it("sells at the current average without moving it", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 10, 120_000);

      const sale = await runStockTransaction(db, (tx) =>
        applyMovement(tx, {
          variantId: variant,
          warehouseId: f.warehouseA,
          type: "SALE",
          reason: "CUSTOMER_SALE",
          qtyDelta: -4,
          actorId: f.userId,
        }),
      );
      expect(sale.unitCostCentavos).toBe(120_000);
      expect(sale.avgCostAfterCentavos).toBe(120_000);
      expect(sale.balanceAfter).toBe(6);
      await expectLedgerInvariants(db, f.variants);
    });

    it("refuses to go negative and writes nothing when it does", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 3);

      await expect(
        runStockTransaction(db, (tx) =>
          applyMovement(tx, {
            variantId: variant,
            warehouseId: f.warehouseA,
            type: "SALE",
            reason: "CUSTOMER_SALE",
            qtyDelta: -4,
            actorId: f.userId,
          }),
        ),
      ).rejects.toThrow(InsufficientStockError);

      expect(await position(db, variant, f.warehouseA)).toEqual({ onHand: 3, reserved: 0 });
      expect(await db.stockMovement.count({ where: { variantId: variant } })).toBe(1);
    });

    it("names the SKU, the warehouse and the shortfall", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 2);

      const error = await runStockTransaction(db, (tx) =>
        applyMovement(tx, {
          variantId: variant,
          warehouseId: f.warehouseA,
          type: "TRANSFER_OUT",
          reason: "TRANSFER",
          qtyDelta: -5,
          actorId: f.userId,
        }),
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InsufficientStockError);
      const insufficient = error as InsufficientStockError;
      expect(insufficient.sku).toBe(f.skus[0]);
      expect(insufficient.available).toBe(2);
      expect(insufficient.message).toContain("Short by 3");
    });

    it("never lets an outbound movement take reserved units", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 5);
      await runStockTransaction(db, (tx) =>
        reserveStock(tx, { variantId: variant, warehouseId: f.warehouseA, qty: 3 }),
      );

      // Only 2 are available; the other 3 are promised to a pending order.
      await expect(
        runStockTransaction(db, (tx) =>
          applyMovement(tx, {
            variantId: variant,
            warehouseId: f.warehouseA,
            type: "ADJUSTMENT",
            reason: "DAMAGE",
            qtyDelta: -3,
            actorId: f.userId,
          }),
        ),
      ).rejects.toThrow(InsufficientStockError);

      // The sale that the reservation was for consumes it.
      const sale = await runStockTransaction(db, (tx) =>
        applyMovement(tx, {
          variantId: variant,
          warehouseId: f.warehouseA,
          type: "SALE",
          reason: "CUSTOMER_SALE",
          qtyDelta: -3,
          fromReserved: true,
          actorId: f.userId,
        }),
      );
      expect(sale.balanceAfter).toBe(2);
      expect(sale.reservedAfter).toBe(0);
      await expectLedgerInvariants(db, f.variants);
    });

    it("releases a reservation, and refuses to release more than is held", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 4);
      await runStockTransaction(db, (tx) =>
        reserveStock(tx, { variantId: variant, warehouseId: f.warehouseA, qty: 4 }),
      );

      await expect(
        runStockTransaction(db, (tx) =>
          reserveStock(tx, { variantId: variant, warehouseId: f.warehouseA, qty: 1 }),
        ),
      ).rejects.toThrow(InsufficientStockError);

      await runStockTransaction(db, (tx) =>
        releaseStock(tx, { variantId: variant, warehouseId: f.warehouseA, qty: 4 }),
      );
      await expect(
        runStockTransaction(db, (tx) =>
          releaseStock(tx, { variantId: variant, warehouseId: f.warehouseA, qty: 1 }),
        ),
      ).rejects.toThrow(DomainError);
      expect(await position(db, variant, f.warehouseA)).toEqual({ onHand: 4, reserved: 0 });
    });

    it("re-weights the average when a return restocks at its original cost", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 10, 100_000);
      await receive(db, f, variant, f.warehouseA, 10, 200_000); // average 150,000

      const restock = await runStockTransaction(db, (tx) =>
        applyMovement(tx, {
          variantId: variant,
          warehouseId: f.warehouseA,
          type: "RETURN",
          reason: "CUSTOMER_RETURN",
          qtyDelta: 5,
          unitCostCentavos: 100_000,
          actorId: f.userId,
        }),
      );
      // (20 * 150,000 + 5 * 100,000) / 25
      expect(restock.avgCostAfterCentavos).toBe(140_000);
      await expectLedgerInvariants(db, f.variants);
    });

    it("books a write-off without touching on-hand", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 6);

      const writeOff = await runStockTransaction(db, (tx) =>
        applyMovement(tx, {
          variantId: variant,
          warehouseId: f.warehouseA,
          type: "WRITE_OFF",
          reason: "DAMAGE",
          qtyDelta: 0,
          unitCostCentavos: 90_000,
          actorId: f.userId,
        }),
      );
      expect(writeOff.balanceAfter).toBe(6);
      expect(writeOff.unitCostCentavos).toBe(90_000);
      expect(await position(db, variant, f.warehouseA)).toEqual({ onHand: 6, reserved: 0 });
      await expectLedgerInvariants(db, f.variants);
    });

    it("is backed by a CHECK constraint if anything bypasses the service", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 1);

      await expect(
        db.$executeRaw`UPDATE "StockLevel" SET "onHand" = -1 WHERE "variantId" = ${variant}`,
      ).rejects.toThrow(/StockLevel_nonnegative|check constraint/i);
      await expect(
        db.$executeRaw`UPDATE "StockLevel" SET reserved = 2 WHERE "variantId" = ${variant}`,
      ).rejects.toThrow(/StockLevel_nonnegative|check constraint/i);
    });

    it("raises a notification when stock crosses a threshold, once", async () => {
      const f = await createFixture(db, { reorderLevel: 5 });
      const [variant] = f.variants as [string];
      const sku = f.skus[0] as string;
      await receive(db, f, variant, f.warehouseA, 8);

      const sell = (qty: number) =>
        runStockTransaction(db, (tx) =>
          applyMovement(tx, {
            variantId: variant,
            warehouseId: f.warehouseA,
            type: "SALE",
            reason: "CUSTOMER_SALE",
            qtyDelta: -qty,
            actorId: f.userId,
          }),
        );

      expect((await sell(3)).alert).toBe("LOW_STOCK"); // 8 -> 5
      expect((await sell(2)).alert).toBeNull(); // 5 -> 3, already low
      expect((await sell(3)).alert).toBe("OUT_OF_STOCK"); // 3 -> 0

      // The fixture's warehouse user is in the audience, and hears each crossing once.
      const alerts = await db.notification.findMany({
        where: { title: { contains: sku }, userId: f.userId },
        select: { type: true },
        orderBy: { createdAt: "asc" },
      });
      expect(alerts.map((alert) => alert.type)).toEqual(["LOW_STOCK", "OUT_OF_STOCK"]);
    });
  });

  // ---------------------------------------------------------- adjustments

  describe("adjustments", () => {
    let f: Fixture;

    beforeAll(async () => {
      f = await createFixture(db, { variants: 4 });
      for (const variant of f.variants) await receive(db, f, variant, f.warehouseA, 20);
    });

    it("writes one document, one item per line and one movement per change", async () => {
      const [v0, v1] = f.variants as [string, string];
      const result = await runStockTransaction(db, (tx) =>
        createAdjustment(
          tx,
          {
            warehouseId: f.warehouseA,
            reason: "DAMAGE",
            note: "Forklift clipped the rack in aisle C.",
            lines: [
              { variantId: v0, mode: "delta", quantity: -2 },
              { variantId: v1, mode: "delta", quantity: -1 },
            ],
          },
          { id: f.userId },
        ),
      );

      expect(result.reference).toMatch(/^ADJ-\d{4}-\d{4}$/);
      expect(result.netUnits).toBe(-3);
      expect(result.lines.map((line) => line.balanceAfter)).toEqual([18, 19]);

      const stored = await db.stockAdjustment.findUniqueOrThrow({
        where: { id: result.id },
        select: { reason: true, items: { select: { movements: { select: { type: true } } } } },
      });
      expect(stored.reason).toBe("DAMAGE");
      expect(stored.items.flatMap((item) => item.movements)).toHaveLength(2);
      await expectLedgerInvariants(db, f.variants);
    });

    it("numbers documents consecutively", async () => {
      const make = () =>
        runStockTransaction(db, (tx) =>
          createAdjustment(
            tx,
            {
              warehouseId: f.warehouseA,
              reason: "SAMPLE",
              note: "",
              lines: [{ variantId: f.variants[2] as string, mode: "delta", quantity: -1 }],
            },
            { id: f.userId },
          ),
        );
      const first = await make();
      const second = await make();
      const sequence = (reference: string) => Number(reference.split("-")[2]);
      expect(sequence(second.reference)).toBe(sequence(first.reference) + 1);
    });

    it("continues after documents that exist without a counter, such as seeded ones", async () => {
      // The seed writes references directly and never touches the counter,
      // so the first number handed out in a year must floor on the table.
      const year = manilaYear(new Date());
      await db.stockAdjustment.create({
        data: {
          reference: formatReference("ADJ", year, 9001),
          warehouseId: f.warehouseA,
          reason: "COUNT_CORRECTION",
          actorId: f.userId,
        },
      });

      const next = await runStockTransaction(db, (tx) =>
        createAdjustment(
          tx,
          {
            warehouseId: f.warehouseA,
            reason: "SAMPLE",
            note: "",
            lines: [{ variantId: f.variants[2] as string, mode: "delta", quantity: -1 }],
          },
          { id: f.userId },
        ),
      );
      expect(next.reference).toBe(formatReference("ADJ", year, 9002));
    });

    it("computes a count's change from the live position, and keeps matching counts", async () => {
      const [, , , v3] = f.variants as [string, string, string, string];
      const [v0] = f.variants as [string];
      const onHand = (await position(db, v3, f.warehouseA)).onHand;
      const onHandV0 = (await position(db, v0, f.warehouseA)).onHand;

      const result = await runStockTransaction(db, (tx) =>
        createAdjustment(
          tx,
          {
            warehouseId: f.warehouseA,
            reason: "COUNT_CORRECTION",
            note: "Monthly count.",
            lines: [
              { variantId: v3, mode: "count", quantity: onHand + 2 },
              { variantId: v0, mode: "count", quantity: onHandV0 },
            ],
          },
          { id: f.userId },
        ),
      );

      const found = result.lines.find((line) => line.variantId === v3);
      const matched = result.lines.find((line) => line.variantId === v0);
      expect(found?.qtyDelta).toBe(2);
      expect(found?.countedQty).toBe(onHand + 2);
      // A count that agrees is recorded as confirmed but moves nothing.
      expect(matched?.qtyDelta).toBe(0);
      expect(matched?.movement).toBeNull();
      await expectLedgerInvariants(db, f.variants);
    });

    it("rolls every line back when one line fails", async () => {
      const [v0, v1] = f.variants as [string, string];
      const before = await Promise.all([
        position(db, v0, f.warehouseA),
        position(db, v1, f.warehouseA),
      ]);
      const documents = await db.stockAdjustment.count();

      await expect(
        runStockTransaction(db, (tx) =>
          createAdjustment(
            tx,
            {
              warehouseId: f.warehouseA,
              reason: "LOSS",
              note: "",
              lines: [
                { variantId: v0, mode: "delta", quantity: -1 },
                { variantId: v1, mode: "delta", quantity: -999 },
              ],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(DomainError);

      const after = await Promise.all([
        position(db, v0, f.warehouseA),
        position(db, v1, f.warehouseA),
      ]);
      expect(after).toEqual(before);
      expect(await db.stockAdjustment.count()).toBe(documents);
    });

    it("refuses a reason that contradicts the direction", async () => {
      const [v0] = f.variants as [string];
      const onHand = (await position(db, v0, f.warehouseA)).onHand;

      // A count that finds extra units cannot be filed as damage.
      await expect(
        runStockTransaction(db, (tx) =>
          createAdjustment(
            tx,
            {
              warehouseId: f.warehouseA,
              reason: "DAMAGE",
              note: "",
              lines: [{ variantId: v0, mode: "count", quantity: onHand + 1 }],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/can only remove stock/);
    });

    it("refuses a count below what pending orders have reserved", async () => {
      const [, v1] = f.variants as [string, string];
      await runStockTransaction(db, (tx) =>
        reserveStock(tx, { variantId: v1, warehouseId: f.warehouseA, qty: 3 }),
      );

      await expect(
        runStockTransaction(db, (tx) =>
          createAdjustment(
            tx,
            {
              warehouseId: f.warehouseA,
              reason: "COUNT_CORRECTION",
              note: "",
              lines: [{ variantId: v1, mode: "count", quantity: 2 }],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/reserved for pending orders/);

      await runStockTransaction(db, (tx) =>
        releaseStock(tx, { variantId: v1, warehouseId: f.warehouseA, qty: 3 }),
      );
    });

    it("refuses to adjust an inactive warehouse", async () => {
      await db.warehouse.update({ where: { id: f.warehouseB }, data: { isActive: false } });
      await expect(
        runStockTransaction(db, (tx) =>
          createAdjustment(
            tx,
            {
              warehouseId: f.warehouseB,
              reason: "COUNT_CORRECTION",
              note: "",
              lines: [{ variantId: f.variants[0] as string, mode: "count", quantity: 1 }],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/inactive/);
      await db.warehouse.update({ where: { id: f.warehouseB }, data: { isActive: true } });
    });
  });

  // ------------------------------------------------------------ transfers

  describe("transfers", () => {
    it("moves stock out on dispatch and in on receipt, cost neutral", async () => {
      const f = await createFixture(db, { variants: 2 });
      const [v0, v1] = f.variants as [string, string];
      await receive(db, f, v0, f.warehouseA, 10, 150_000);
      await receive(db, f, v1, f.warehouseA, 10, 90_000);

      const created = await runStockTransaction(db, (tx) =>
        createTransfer(
          tx,
          {
            fromWarehouseId: f.warehouseA,
            toWarehouseId: f.warehouseB,
            note: "Weekend rebalance.",
            dispatch: true,
            lines: [
              { variantId: v0, qty: 4 },
              { variantId: v1, qty: 6 },
            ],
          },
          { id: f.userId },
        ),
      );
      expect(created.status).toBe("IN_TRANSIT");
      expect(created.reference).toMatch(/^TRF-\d{4}-\d{4}$/);

      // In transit: gone from A, not yet in B.
      expect(await position(db, v0, f.warehouseA)).toEqual({ onHand: 6, reserved: 0 });
      expect(await position(db, v0, f.warehouseB)).toEqual({ onHand: 0, reserved: 0 });

      const items = await db.stockTransferItem.findMany({
        where: { transferId: created.id },
        select: { id: true, qty: true },
      });
      const received = await runStockTransaction(db, (tx) =>
        receiveTransfer(
          tx,
          {
            transferId: created.id,
            note: "",
            lines: items.map((item) => ({ itemId: item.id, qtyReceived: item.qty })),
          },
          { id: f.userId },
        ),
      );
      expect(received.status).toBe("RECEIVED");
      expect(received.shortUnits).toBe(0);
      expect(await position(db, v0, f.warehouseB)).toEqual({ onHand: 4, reserved: 0 });
      expect(await position(db, v1, f.warehouseB)).toEqual({ onHand: 6, reserved: 0 });

      // A transfer never moves what the stock cost (decision D-8).
      const costs = await db.productVariant.findMany({
        where: { id: { in: [v0, v1] } },
        select: { id: true, avgCostCentavos: true },
        orderBy: { sku: "asc" },
      });
      expect(costs.map((row) => row.avgCostCentavos)).toEqual([150_000, 90_000]);
      await expectLedgerInvariants(db, f.variants);
    });

    it("keeps a draft off the ledger until it is dispatched", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [v0] = f.variants as [string];
      await receive(db, f, v0, f.warehouseA, 5);

      const draft = await runStockTransaction(db, (tx) =>
        createTransfer(
          tx,
          {
            fromWarehouseId: f.warehouseA,
            toWarehouseId: f.warehouseB,
            note: "",
            dispatch: false,
            lines: [{ variantId: v0, qty: 5 }],
          },
          { id: f.userId },
        ),
      );
      expect(draft.status).toBe("DRAFT");
      expect(await position(db, v0, f.warehouseA)).toEqual({ onHand: 5, reserved: 0 });

      const dispatched = await runStockTransaction(db, (tx) =>
        dispatchTransfer(tx, draft.id, { id: f.userId }),
      );
      expect(dispatched.status).toBe("IN_TRANSIT");
      expect(await position(db, v0, f.warehouseA)).toEqual({ onHand: 0, reserved: 0 });
    });

    it("returns stock to the source when cancelled in transit", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [v0] = f.variants as [string];
      await receive(db, f, v0, f.warehouseA, 5);

      const transfer = await runStockTransaction(db, (tx) =>
        createTransfer(
          tx,
          {
            fromWarehouseId: f.warehouseA,
            toWarehouseId: f.warehouseB,
            note: "",
            dispatch: true,
            lines: [{ variantId: v0, qty: 3 }],
          },
          { id: f.userId },
        ),
      );
      await runStockTransaction(db, (tx) =>
        cancelTransfer(
          tx,
          { transferId: transfer.id, reason: "Courier did not show." },
          {
            id: f.userId,
          },
        ),
      );

      expect(await position(db, v0, f.warehouseA)).toEqual({ onHand: 5, reserved: 0 });
      const types = await db.stockMovement.findMany({
        where: { variantId: v0 },
        orderBy: { occurredAt: "asc" },
        select: { type: true, qtyDelta: true },
      });
      expect(types.map((row) => `${row.type}:${row.qtyDelta}`)).toEqual([
        "RECEIPT:5",
        "TRANSFER_OUT:-3",
        "TRANSFER_IN:3",
      ]);
      await expectLedgerInvariants(db, f.variants);
    });

    it("records a short receipt, and requires a note to do so", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [v0] = f.variants as [string];
      await receive(db, f, v0, f.warehouseA, 10);

      const transfer = await runStockTransaction(db, (tx) =>
        createTransfer(
          tx,
          {
            fromWarehouseId: f.warehouseA,
            toWarehouseId: f.warehouseB,
            note: "",
            dispatch: true,
            lines: [{ variantId: v0, qty: 6 }],
          },
          { id: f.userId },
        ),
      );
      const [item] = await db.stockTransferItem.findMany({
        where: { transferId: transfer.id },
        select: { id: true },
      });
      if (!item) throw new Error("transfer item missing");

      await expect(
        runStockTransaction(db, (tx) =>
          receiveTransfer(
            tx,
            { transferId: transfer.id, note: "", lines: [{ itemId: item.id, qtyReceived: 5 }] },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/Add a note/);

      await expect(
        runStockTransaction(db, (tx) =>
          receiveTransfer(
            tx,
            { transferId: transfer.id, note: "", lines: [{ itemId: item.id, qtyReceived: 7 }] },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/cannot be received/);

      const result = await runStockTransaction(db, (tx) =>
        receiveTransfer(
          tx,
          {
            transferId: transfer.id,
            note: "One carton crushed in transit.",
            lines: [{ itemId: item.id, qtyReceived: 5 }],
          },
          { id: f.userId },
        ),
      );
      expect(result.shortUnits).toBe(1);
      expect(await position(db, v0, f.warehouseB)).toEqual({ onHand: 5, reserved: 0 });
      const stored = await db.stockTransferItem.findUniqueOrThrow({
        where: { id: item.id },
        select: { qty: true, qtyReceived: true },
      });
      expect(stored).toEqual({ qty: 6, qtyReceived: 5 });
      await expectLedgerInvariants(db, f.variants);
    });

    it("rolls back the whole transfer when a line is short at dispatch", async () => {
      const f = await createFixture(db, { variants: 2 });
      const [v0, v1] = f.variants as [string, string];
      await receive(db, f, v0, f.warehouseA, 10);
      await receive(db, f, v1, f.warehouseA, 1);
      const transfers = await db.stockTransfer.count();

      await expect(
        runStockTransaction(db, (tx) =>
          createTransfer(
            tx,
            {
              fromWarehouseId: f.warehouseA,
              toWarehouseId: f.warehouseB,
              note: "",
              dispatch: true,
              lines: [
                { variantId: v0, qty: 5 },
                { variantId: v1, qty: 2 },
              ],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(InsufficientStockError);

      expect(await db.stockTransfer.count()).toBe(transfers);
      expect(await position(db, v0, f.warehouseA)).toEqual({ onHand: 10, reserved: 0 });
    });

    it("enforces the status machine", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [v0] = f.variants as [string];
      await receive(db, f, v0, f.warehouseA, 4);

      const draft = await runStockTransaction(db, (tx) =>
        createTransfer(
          tx,
          {
            fromWarehouseId: f.warehouseA,
            toWarehouseId: f.warehouseB,
            note: "",
            dispatch: false,
            lines: [{ variantId: v0, qty: 1 }],
          },
          { id: f.userId },
        ),
      );

      // A draft has not left, so it cannot arrive.
      await expect(
        runStockTransaction(db, (tx) =>
          receiveTransfer(tx, { transferId: draft.id, note: "", lines: [] }, { id: f.userId }),
        ),
      ).rejects.toThrow(InvalidTransitionError);

      await runStockTransaction(db, (tx) =>
        cancelTransfer(tx, { transferId: draft.id, reason: "Not needed." }, { id: f.userId }),
      );

      // Cancelled is terminal.
      await expect(
        runStockTransaction(db, (tx) => dispatchTransfer(tx, draft.id, { id: f.userId })),
      ).rejects.toThrow(InvalidTransitionError);
      expect(await db.stockMovement.count({ where: { variantId: v0 } })).toBe(1);
    });

    it("refuses a transfer to the warehouse it came from", async () => {
      const f = await createFixture(db, { variants: 1 });
      await expect(
        runStockTransaction(db, (tx) =>
          createTransfer(
            tx,
            {
              fromWarehouseId: f.warehouseA,
              toWarehouseId: f.warehouseA,
              note: "",
              dispatch: true,
              lines: [{ variantId: f.variants[0] as string, qty: 1 }],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/two different warehouses/);
    });
  });
});
