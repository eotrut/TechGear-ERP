import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runStockTransaction } from "@/features/inventory/services/stock";
import {
  advanceOrder,
  cancelOrder,
  createOrder,
  payOrder,
  recordRefund,
  type OrderDraft,
} from "@/features/orders/services/orders";
import type { Tender } from "@/features/orders/services/order-rules";
import {
  completeReturn,
  createReturn,
  decideReturn,
  receiveReturn,
} from "@/features/returns/services/returns";
import {
  createClaim,
  refundClaim,
  replaceClaim,
  reviewClaim,
} from "@/features/warranty/services/warranty";
import { DomainError, InsufficientStockError, InvalidTransitionError } from "@/lib/errors";
import { vatFromGross } from "@/lib/vat";

import {
  createFixture,
  createTestClient,
  expectLedgerInvariants,
  position,
  receive,
  settle,
  type Fixture,
} from "./helpers";

/**
 * Orders against a real Postgres: placement in one transaction, reservations,
 * payment turning them into SALE movements, overselling under concurrency,
 * cancellation, returns with restock and write-off, refunds, promo limits and
 * warranty replacements. The ledger invariants are re-checked after each.
 */

const databaseUrl = inject("databaseUrl");

// Fixture variants are priced at PHP 2,500.00.
const PRICE = 250_000;

// What the matrix gives a Manager and a salesperson over cancelling.
const MANAGER_GRANT = { scope: "all", canRefund: true } as const;
const SALES_GRANT = { scope: "own", canRefund: false } as const;

describe.skipIf(databaseUrl === "")("orders", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestClient(databaseUrl);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function customer() {
    const tag = randomBytes(4).toString("hex");
    return db.customer.create({
      data: { code: `CUS-T${tag}`, displayName: `Test Buyer ${tag}` },
      select: { id: true },
    });
  }

  function draft(
    f: Fixture,
    lines: { variant: number; qty: number }[],
    extra: Partial<OrderDraft> = {},
  ) {
    return {
      channel: "DIRECT",
      customerId: null,
      warehouseId: f.warehouseA,
      shippingAddressId: null,
      channelReference: null,
      shippingCentavos: 0,
      promoCode: null,
      manualDiscount: null,
      notes: null,
      lines: lines.map((line) => ({
        variantId: f.variants[line.variant] as string,
        qty: line.qty,
        discountCentavos: 0,
      })),
      ...extra,
    } satisfies OrderDraft;
  }

  const cash = (amount: number): Tender[] => [
    { method: "CASH", amountCentavos: amount, tenderedCentavos: amount },
  ];

  function place(
    f: Fixture,
    d: OrderDraft,
    intent: "draft" | "place" | "paid" = "place",
    tenders?: Tender[],
  ) {
    return runStockTransaction(db, (tx) =>
      createOrder(tx, d, { id: f.userId }, { intent, tenders, discountCapBps: null }),
    );
  }

  async function deliver(f: Fixture, orderId: string) {
    for (const to of ["PACKED", "SHIPPED", "DELIVERED"] as const) {
      await runStockTransaction(db, (tx) => advanceOrder(tx, orderId, to, { id: f.userId }));
    }
  }

  // ---------------------------------------------------------- placement

  describe("placement", () => {
    it("saves a draft without touching stock", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 10);

      const order = await place(f, draft(f, [{ variant: 0, qty: 3 }]), "draft");
      expect(order.status).toBe("DRAFT");
      expect(order.orderNumber).toMatch(/^SO-\d{4}-\d{6}$/);
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 10, reserved: 0 });
    });

    it("reserves on placement, then turns the reservation into a SALE at payment", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 10, 120_000);
      await receive(db, f, f.variants[1]!, f.warehouseA, 4, 80_000);

      const order = await place(
        f,
        draft(f, [
          { variant: 0, qty: 3 },
          { variant: 1, qty: 1 },
        ]),
      );
      expect(order.status).toBe("PENDING");
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 10, reserved: 3 });

      const total = 4 * PRICE;
      await runStockTransaction(db, (tx) =>
        payOrder(
          tx,
          order.id,
          [
            { method: "GCASH", amountCentavos: 600_000, reference: "GC0001" },
            { method: "CASH", amountCentavos: total - 600_000, tenderedCentavos: 500_000 },
          ],
          { id: f.userId },
        ),
      );

      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 7, reserved: 0 });
      expect(await position(db, f.variants[1]!, f.warehouseA)).toEqual({ onHand: 3, reserved: 0 });

      const saved = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: { orderBy: { skuSnapshot: "asc" } }, payments: true, statusEvents: true },
      });
      expect(saved.status).toBe("PAID");
      expect(saved.totalCentavos).toBe(total);
      expect(saved.vatCentavos).toBe(vatFromGross(total));
      expect(saved.amountPaidCentavos).toBe(total);
      expect(saved.payments).toHaveLength(2);
      expect(saved.payments.find((p) => p.method === "CASH")?.changeCentavos).toBe(100_000);
      // Cost snapshotted from the moving average at the moment of sale.
      expect(saved.items.map((item) => item.unitCostCentavos).sort((a, b) => a - b)).toEqual([
        80_000, 120_000,
      ]);
      expect(saved.costTotalCentavos).toBe(3 * 120_000 + 80_000);
      expect(saved.statusEvents.map((event) => event.toStatus).sort()).toEqual(
        ["DRAFT", "PENDING", "PAID"].sort(),
      );

      const sales = await db.stockMovement.findMany({
        where: { orderItem: { orderId: order.id }, type: "SALE" },
      });
      expect(sales.map((movement) => movement.qtyDelta).sort((a, b) => a - b)).toEqual([-3, -1]);
      await expectLedgerInvariants(db, f.variants);
    });

    it("places and pays in one transaction, and rolls all of it back when a line is short", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 5);
      await receive(db, f, f.variants[1]!, f.warehouseA, 1);
      const before = await db.order.count();

      await expect(
        place(
          f,
          draft(f, [
            { variant: 0, qty: 2 },
            { variant: 1, qty: 2 },
          ]),
          "paid",
          cash(4 * PRICE),
        ),
      ).rejects.toBeInstanceOf(InsufficientStockError);

      // Nothing survived: no order, no reservation on the first line, no payment.
      expect(await db.order.count()).toBe(before);
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 5, reserved: 0 });
      await expectLedgerInvariants(db, f.variants);
    });

    it("never promises the same unit twice under concurrency", async () => {
      const f = await createFixture(db);
      const [variant] = f.variants as [string];
      await receive(db, f, variant, f.warehouseA, 5);

      // Eight buyers each want two of the last five.
      const { ok, failed } = await settle(
        Array.from({ length: 8 }, () =>
          place(f, draft(f, [{ variant: 0, qty: 2 }]), "paid", cash(2 * PRICE)),
        ),
      );
      expect(ok).toHaveLength(2);
      expect(failed).toHaveLength(6);
      for (const error of failed) expect(error).toBeInstanceOf(InsufficientStockError);

      expect(await position(db, variant, f.warehouseA)).toEqual({ onHand: 1, reserved: 0 });
      await expectLedgerInvariants(db, f.variants);
    });

    it("refuses to pay less than is due, and refuses an illegal jump", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 5);
      const order = await place(f, draft(f, [{ variant: 0, qty: 1 }]));

      await expect(
        runStockTransaction(db, (tx) =>
          payOrder(tx, order.id, [{ method: "CARD", amountCentavos: PRICE - 1 }], { id: f.userId }),
        ),
      ).rejects.toThrow(/short/);
      await expect(
        runStockTransaction(db, (tx) => advanceOrder(tx, order.id, "SHIPPED", { id: f.userId })),
      ).rejects.toBeInstanceOf(InvalidTransitionError);
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 5, reserved: 1 });
    });

    it("prices from the catalogue, applies a promo, and enforces the discount cap", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 10);
      const code = `T${randomBytes(3).toString("hex").toUpperCase()}`;
      await db.promo.create({
        data: {
          code,
          description: "Test promo",
          type: "PERCENT",
          percentBps: 1000,
          startsAt: new Date(Date.now() - 86_400_000),
          endsAt: new Date(Date.now() + 86_400_000),
        },
      });

      const order = await place(
        f,
        draft(f, [{ variant: 0, qty: 2 }], { promoCode: code, shippingCentavos: 9_500 }),
      );
      const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(saved.discountCentavos).toBe(50_000);
      expect(saved.totalCentavos).toBe(2 * PRICE - 50_000 + 9_500);
      expect(saved.promoCodeSnapshot).toBe(code);
      expect(await db.promo.findUniqueOrThrow({ where: { code } })).toMatchObject({
        usageCount: 1,
      });

      await expect(
        runStockTransaction(db, (tx) =>
          createOrder(
            tx,
            draft(f, [{ variant: 0, qty: 1 }], { manualDiscount: { type: "PERCENT", bps: 1500 } }),
            { id: f.userId },
            { intent: "place", discountCapBps: 1000 },
          ),
        ),
      ).rejects.toThrow(/limit is 10 percent/);
    });

    it("holds a promo's usage limit under concurrency", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 20);
      const code = `L${randomBytes(3).toString("hex").toUpperCase()}`;
      await db.promo.create({
        data: {
          code,
          description: "Two uses only",
          type: "FIXED",
          amountCentavos: 10_000,
          usageLimit: 2,
          startsAt: new Date(Date.now() - 86_400_000),
          endsAt: new Date(Date.now() + 86_400_000),
        },
      });

      const { ok, failed } = await settle(
        Array.from({ length: 5 }, () =>
          place(f, draft(f, [{ variant: 0, qty: 1 }], { promoCode: code })),
        ),
      );
      expect(ok).toHaveLength(2);
      for (const error of failed) expect(error.message).toMatch(/used all 2/);
      expect(await db.promo.findUniqueOrThrow({ where: { code } })).toMatchObject({
        usageCount: 2,
      });
      expect(await db.promoRedemption.count({ where: { promo: { code } } })).toBe(2);
    });
  });

  // -------------------------------------------------------- cancellation

  describe("cancellation", () => {
    it("gives a pending order's reservation back, and its promo use", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 6);
      const order = await place(f, draft(f, [{ variant: 0, qty: 4 }]));

      const result = await runStockTransaction(db, (tx) =>
        cancelOrder(
          tx,
          { orderId: order.id, reason: "Customer changed their mind" },
          { id: f.userId },
          MANAGER_GRANT,
        ),
      );
      expect(result.refundedCentavos).toBe(0);
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 6, reserved: 0 });
      const movements = await db.stockMovement.count({ where: { variantId: f.variants[0]! } });
      expect(movements).toBe(1); // only the receipt: a reservation is not a movement
    });

    it("puts a paid order's goods back at their sale cost and refunds in full", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 6, 100_000);
      const order = await place(f, draft(f, [{ variant: 0, qty: 2 }]), "paid", cash(2 * PRICE));
      // A later receipt moves the average; the restock must still use 100,000.
      await receive(db, f, f.variants[0]!, f.warehouseA, 4, 160_000);

      const result = await runStockTransaction(db, (tx) =>
        cancelOrder(
          tx,
          { orderId: order.id, reason: "Out of delivery area" },
          { id: f.userId },
          MANAGER_GRANT,
        ),
      );
      expect(result.refundedCentavos).toBe(2 * PRICE);
      expect(result.restockedUnits).toBe(2);
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 10, reserved: 0 });

      const restock = await db.stockMovement.findFirstOrThrow({
        where: { orderItem: { orderId: order.id }, type: "RETURN" },
      });
      expect(restock.unitCostCentavos).toBe(100_000);

      const saved = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { refunds: true },
      });
      expect(saved.status).toBe("CANCELLED");
      expect(saved.amountRefundedCentavos).toBe(saved.amountPaidCentavos);
      expect(saved.refunds[0]?.method).toBe("CASH");
      await expectLedgerInvariants(db, f.variants);
    });

    it("refuses to cancel once shipped", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 3);
      const order = await place(f, draft(f, [{ variant: 0, qty: 1 }]), "paid", cash(PRICE));
      await runStockTransaction(db, (tx) => advanceOrder(tx, order.id, "PACKED", { id: f.userId }));
      await runStockTransaction(db, (tx) =>
        advanceOrder(tx, order.id, "SHIPPED", { id: f.userId }),
      );

      await expect(
        runStockTransaction(db, (tx) =>
          cancelOrder(
            tx,
            { orderId: order.id, reason: "Too late" },
            { id: f.userId },
            MANAGER_GRANT,
          ),
        ),
      ).rejects.toThrow(/Raise a return/);
    });

    it("re-checks a salesperson's grant under the lock, so a paid order is not refunded", async () => {
      // The action authorizes against a read taken before the lock. If the
      // order is paid in between, the service must still refuse.
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 3);
      const order = await place(f, draft(f, [{ variant: 0, qty: 1 }]), "paid", cash(PRICE));

      await expect(
        runStockTransaction(db, (tx) =>
          cancelOrder(
            tx,
            { orderId: order.id, reason: "Changed mind" },
            { id: f.userId },
            SALES_GRANT,
          ),
        ),
      ).rejects.toThrow(/has been paid/);

      const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(saved.status).toBe("PAID");
      expect(saved.amountRefundedCentavos).toBe(0);
    });

    it("lets a salesperson cancel only their own orders", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 3);
      const order = await place(f, draft(f, [{ variant: 0, qty: 1 }]));

      await expect(
        runStockTransaction(db, (tx) =>
          cancelOrder(
            tx,
            { orderId: order.id, reason: "Not mine" },
            { id: "someone-else" },
            SALES_GRANT,
          ),
        ),
      ).rejects.toThrow(/another salesperson/);

      const own = await runStockTransaction(db, (tx) =>
        cancelOrder(tx, { orderId: order.id, reason: "Mine" }, { id: f.userId }, SALES_GRANT),
      );
      expect(own.from).toBe("PENDING");
    });
  });

  // ------------------------------------------------------------- returns

  describe("returns", () => {
    it("restocks one line, writes off another, and refunds their share", async () => {
      const f = await createFixture(db);
      const buyer = await customer();
      await receive(db, f, f.variants[0]!, f.warehouseA, 10, 100_000);
      await receive(db, f, f.variants[1]!, f.warehouseA, 10, 90_000);

      const order = await place(
        f,
        draft(
          f,
          [
            { variant: 0, qty: 3 },
            { variant: 1, qty: 1 },
          ],
          { customerId: buyer.id, manualDiscount: { type: "FIXED", centavos: 10_001 } },
        ),
        "paid",
        cash(4 * PRICE - 10_001),
      );
      await deliver(f, order.id);

      const items = await db.orderItem.findMany({ where: { orderId: order.id } });
      const keyboard = items.find((item) => item.variantId === f.variants[0])!;
      const mouse = items.find((item) => item.variantId === f.variants[1])!;

      const rma = await runStockTransaction(db, (tx) =>
        createReturn(
          tx,
          {
            orderId: order.id,
            reason: "Wrong switches ordered",
            notes: null,
            lines: [
              { orderItemId: keyboard.id, qty: 2 },
              { orderItemId: mouse.id, qty: 1 },
            ],
          },
          { id: f.userId },
        ),
      );
      expect(rma.rmaNumber).toMatch(/^RMA-\d{4}-\d{4}$/);

      // The same units cannot go into a second return while this one is open.
      await expect(
        runStockTransaction(db, (tx) =>
          createReturn(
            tx,
            {
              orderId: order.id,
              reason: "Second attempt",
              notes: null,
              lines: [{ orderItemId: keyboard.id, qty: 2 }],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/Only 1/);

      // Completing before it is received is refused by the status machine.
      await expect(
        runStockTransaction(db, (tx) =>
          completeReturn(
            tx,
            { returnId: rma.id, method: "GCASH", reference: "RF1", refundShipping: false },
            { id: f.userId },
          ),
        ),
      ).rejects.toBeInstanceOf(InvalidTransitionError);

      await runStockTransaction(db, (tx) =>
        decideReturn(tx, { returnId: rma.id, decision: "APPROVED", note: "" }),
      );
      const returnItems = await db.returnItem.findMany({ where: { returnId: rma.id } });
      await runStockTransaction(db, (tx) =>
        receiveReturn(tx, {
          returnId: rma.id,
          lines: returnItems.map((item) => ({
            returnItemId: item.id,
            disposition: item.orderItemId === keyboard.id ? "RESTOCK" : "WRITE_OFF",
            conditionNote: item.orderItemId === keyboard.id ? "" : "Cracked shell",
          })),
        }),
      );

      const result = await runStockTransaction(db, (tx) =>
        completeReturn(
          tx,
          { returnId: rma.id, method: "GCASH", reference: "RF123", refundShipping: false },
          { id: f.userId },
        ),
      );
      expect(result.restockedUnits).toBe(2);
      expect(result.writtenOffUnits).toBe(1);

      // Restocked units are back on the shelf; the written-off one is not.
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 9, reserved: 0 });
      expect(await position(db, f.variants[1]!, f.warehouseA)).toEqual({ onHand: 9, reserved: 0 });
      const writeOff = await db.stockMovement.findFirstOrThrow({
        where: { variantId: f.variants[1]!, type: "WRITE_OFF" },
      });
      expect(writeOff).toMatchObject({ qtyDelta: 0, unitCostCentavos: 90_000 });

      const expected = Math.round((keyboard.lineTotalCentavos * 2) / 3) + mouse.lineTotalCentavos;
      expect(result.refund?.amountCentavos).toBe(expected);

      const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(saved.amountRefundedCentavos).toBe(expected);
      // One keyboard is still with the customer: partly refunded, still delivered.
      expect(saved.status).toBe("DELIVERED");
      await expectLedgerInvariants(db, f.variants);
    });

    it("marks the order refunded when the last unit comes home", async () => {
      const f = await createFixture(db);
      const buyer = await customer();
      await receive(db, f, f.variants[0]!, f.warehouseA, 5);
      const order = await place(
        f,
        draft(f, [{ variant: 0, qty: 2 }], { customerId: buyer.id }),
        "paid",
        cash(2 * PRICE),
      );
      await deliver(f, order.id);
      const [item] = await db.orderItem.findMany({ where: { orderId: order.id } });

      const rma = await runStockTransaction(db, (tx) =>
        createReturn(
          tx,
          {
            orderId: order.id,
            reason: "Did not suit",
            notes: null,
            lines: [{ orderItemId: item!.id, qty: 2 }],
          },
          { id: f.userId },
        ),
      );
      await runStockTransaction(db, (tx) =>
        decideReturn(tx, { returnId: rma.id, decision: "APPROVED", note: "" }),
      );
      const [returnItem] = await db.returnItem.findMany({ where: { returnId: rma.id } });
      await runStockTransaction(db, (tx) =>
        receiveReturn(tx, {
          returnId: rma.id,
          lines: [{ returnItemId: returnItem!.id, disposition: "RESTOCK", conditionNote: "" }],
        }),
      );
      const result = await runStockTransaction(db, (tx) =>
        completeReturn(
          tx,
          { returnId: rma.id, method: "BANK_TRANSFER", reference: "", refundShipping: true },
          { id: f.userId },
        ),
      );

      expect(result.refund?.statusChange).toEqual({ from: "DELIVERED", to: "REFUNDED" });
      const saved = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(saved.status).toBe("REFUNDED");
      expect(saved.amountRefundedCentavos).toBe(saved.amountPaidCentavos);
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 5, reserved: 0 });
    });

    it("refuses a return on an order that has not been delivered", async () => {
      const f = await createFixture(db);
      const buyer = await customer();
      await receive(db, f, f.variants[0]!, f.warehouseA, 5);
      const order = await place(
        f,
        draft(f, [{ variant: 0, qty: 1 }], { customerId: buyer.id }),
        "paid",
        cash(PRICE),
      );
      const [item] = await db.orderItem.findMany({ where: { orderId: order.id } });
      await expect(
        runStockTransaction(db, (tx) =>
          createReturn(
            tx,
            {
              orderId: order.id,
              reason: "Too early",
              notes: null,
              lines: [{ orderItemId: item!.id, qty: 1 }],
            },
            { id: f.userId },
          ),
        ),
      ).rejects.toThrow(/Cancel it instead/);
    });

    it("caps a manual refund at what was paid", async () => {
      const f = await createFixture(db);
      await receive(db, f, f.variants[0]!, f.warehouseA, 5);
      const order = await place(f, draft(f, [{ variant: 0, qty: 1 }]), "paid", cash(PRICE));
      await deliver(f, order.id);

      const partial = await runStockTransaction(db, (tx) =>
        recordRefund(
          tx,
          {
            orderId: order.id,
            amountCentavos: 50_000,
            method: "GCASH",
            reason: "Goodwill for a late delivery",
          },
          { id: f.userId },
        ),
      );
      expect(partial.statusChange).toBeNull();
      await expect(
        runStockTransaction(db, (tx) =>
          recordRefund(
            tx,
            { orderId: order.id, amountCentavos: PRICE, method: "GCASH", reason: "Too much" },
            { id: f.userId },
          ),
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  // ------------------------------------------------------------ warranty

  describe("warranty", () => {
    it("ships a replacement as a zero-value order with a real SALE at average cost", async () => {
      const f = await createFixture(db);
      const buyer = await customer();
      await receive(db, f, f.variants[0]!, f.warehouseA, 5, 110_000);
      const order = await place(
        f,
        draft(f, [{ variant: 0, qty: 1 }], { customerId: buyer.id }),
        "paid",
        cash(PRICE),
      );
      await deliver(f, order.id);
      const [item] = await db.orderItem.findMany({ where: { orderId: order.id } });

      const claim = await runStockTransaction(db, (tx) =>
        createClaim(tx, {
          orderItemId: item!.id,
          issueDescription: "Spacebar stabiliser rattles badly",
          serialNumber: "SN123",
        }),
      );
      expect(claim.claimNumber).toMatch(/^WC-\d{4}-\d{4}$/);

      await expect(
        runStockTransaction(db, (tx) =>
          replaceClaim(
            tx,
            { claimId: claim.id, warehouseId: f.warehouseA, note: "" },
            { id: f.userId },
          ),
        ),
      ).rejects.toBeInstanceOf(InvalidTransitionError);

      for (const to of ["UNDER_REVIEW", "APPROVED"] as const) {
        await runStockTransaction(db, (tx) =>
          reviewClaim(tx, { claimId: claim.id, to, note: "" }, { id: f.userId }),
        );
      }
      const replaced = await runStockTransaction(db, (tx) =>
        replaceClaim(
          tx,
          { claimId: claim.id, warehouseId: f.warehouseA, note: "" },
          { id: f.userId },
        ),
      );

      const replacement = await db.order.findUniqueOrThrow({
        where: { id: replaced.orderId },
        include: { items: true, payments: true },
      });
      expect(replacement).toMatchObject({
        status: "PAID",
        totalCentavos: 0,
        amountPaidCentavos: 0,
      });
      expect(replacement.payments).toHaveLength(0);
      expect(replacement.costTotalCentavos).toBe(110_000);

      const movement = await db.stockMovement.findFirstOrThrow({
        where: { orderItem: { orderId: replaced.orderId } },
      });
      expect(movement).toMatchObject({
        type: "SALE",
        reason: "WARRANTY_REPLACEMENT",
        qtyDelta: -1,
      });
      expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 3, reserved: 0 });
      expect(await db.warrantyClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({
        status: "REPLACED",
        replacementOrderId: replaced.orderId,
      });
      await expectLedgerInvariants(db, f.variants);
    });

    it("refunds one unit and writes it off, and refuses a claim before delivery", async () => {
      const f = await createFixture(db);
      const buyer = await customer();
      await receive(db, f, f.variants[0]!, f.warehouseA, 5, 100_000);
      const order = await place(
        f,
        draft(f, [{ variant: 0, qty: 2 }], { customerId: buyer.id }),
        "paid",
        cash(2 * PRICE),
      );
      const [item] = await db.orderItem.findMany({ where: { orderId: order.id } });

      await expect(
        runStockTransaction(db, (tx) =>
          createClaim(tx, {
            orderItemId: item!.id,
            issueDescription: "Dead on arrival, no power",
            serialNumber: "",
          }),
        ),
      ).rejects.toThrow(/not been delivered/);

      await deliver(f, order.id);
      const claim = await runStockTransaction(db, (tx) =>
        createClaim(tx, {
          orderItemId: item!.id,
          issueDescription: "Dead on arrival, no power",
          serialNumber: "",
        }),
      );
      for (const to of ["UNDER_REVIEW", "APPROVED"] as const) {
        await runStockTransaction(db, (tx) =>
          reviewClaim(tx, { claimId: claim.id, to, note: "" }, { id: f.userId }),
        );
      }
      const result = await runStockTransaction(db, (tx) =>
        refundClaim(
          tx,
          { claimId: claim.id, method: "GCASH", reference: "RF9", note: "" },
          { id: f.userId },
        ),
      );

      expect(result.refund.amountCentavos).toBe(PRICE);
      expect(result.refund.statusChange).toBeNull();
      expect(await db.orderItem.findUniqueOrThrow({ where: { id: item!.id } })).toMatchObject({
        qtyReturned: 1,
      });
      const writeOff = await db.stockMovement.findFirstOrThrow({
        where: { orderItemId: item!.id, type: "WRITE_OFF" },
      });
      expect(writeOff).toMatchObject({ qtyDelta: 0, unitCostCentavos: 100_000 });
      await expectLedgerInvariants(db, f.variants);
    });
  });
});
