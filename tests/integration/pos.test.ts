import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runStockTransaction } from "@/features/inventory/services/stock";
import type { Tender } from "@/features/orders/services/order-rules";
import type { PosSaleValues } from "@/features/pos/schemas";
import { ringUpSale } from "@/features/pos/services/register";
import { saleDraft, saleTenders } from "@/features/pos/services/sale";
import { DomainError, InsufficientStockError } from "@/lib/errors";

import {
  createFixture,
  createTestClient,
  expectLedgerInvariants,
  position,
  receive,
  type Fixture,
} from "./helpers";

/**
 * The register against a real Postgres. A sale is the order service end to
 * end: stock leaves through SALE movements, the payments are written with the
 * change, the order ends completed with every step on its timeline, and a
 * refusal writes nothing.
 */

const databaseUrl = inject("databaseUrl");

// Fixture variants are priced at PHP 2,500.00.
const PRICE = 250_000;

describe.skipIf(databaseUrl === "")("point of sale", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestClient(databaseUrl);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  function values(f: Fixture, extra: Partial<PosSaleValues> = {}): PosSaleValues {
    return {
      warehouseId: f.warehouseA,
      customerId: "",
      lines: [],
      discountType: "NONE",
      discountValue: "",
      promoCode: "",
      tenders: [],
      ...extra,
    };
  }

  function sale(
    f: Fixture,
    lines: { variant: number; qty: number }[],
    tenders: Tender[],
    extra: Partial<PosSaleValues> = {},
    capBps: number | null = null,
  ) {
    const draft = saleDraft(
      values(f, {
        ...extra,
        lines: lines.map((line) => ({
          variantId: f.variants[line.variant] as string,
          qty: line.qty,
        })),
      }),
    );
    return runStockTransaction(db, (tx) =>
      ringUpSale(tx, { draft, tenders }, { id: f.userId }, { discountCapBps: capBps }),
    );
  }

  it("takes stock off the shelf, records cash with change, and completes the order", async () => {
    const f = await createFixture(db);
    await receive(db, f, f.variants[0]!, f.warehouseA, 10, 120_000);
    await receive(db, f, f.variants[1]!, f.warehouseA, 5, 90_000);

    const total = PRICE * 3;
    const result = await sale(
      f,
      [
        { variant: 0, qty: 2 },
        { variant: 1, qty: 1 },
      ],
      [{ method: "CASH", amountCentavos: total, tenderedCentavos: total + 50_000 }],
    );

    expect(result.status).toBe("COMPLETED");
    expect(result.changeCentavos).toBe(50_000);
    expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 8, reserved: 0 });
    expect(await position(db, f.variants[1]!, f.warehouseA)).toEqual({ onHand: 4, reserved: 0 });

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.id },
      select: {
        channel: true,
        status: true,
        totalCentavos: true,
        amountPaidCentavos: true,
        costTotalCentavos: true,
        completedAt: true,
        salespersonId: true,
        payments: { select: { method: true, tenderedCentavos: true, changeCentavos: true } },
        statusEvents: { orderBy: { createdAt: "asc" }, select: { toStatus: true } },
        items: { select: { movements: { select: { type: true, qtyDelta: true } } } },
      },
    });
    expect(order.channel).toBe("POS");
    expect(order.totalCentavos).toBe(total);
    expect(order.amountPaidCentavos).toBe(total);
    expect(order.costTotalCentavos).toBe(2 * 120_000 + 90_000);
    expect(order.completedAt).not.toBeNull();
    expect(order.salespersonId).toBe(f.userId);
    expect(order.payments).toEqual([
      { method: "CASH", tenderedCentavos: total + 50_000, changeCentavos: 50_000 },
    ]);
    expect(order.statusEvents.map((event) => event.toStatus)).toEqual([
      "DRAFT",
      "PENDING",
      "PAID",
      "PACKED",
      "SHIPPED",
      "DELIVERED",
      "COMPLETED",
    ]);
    expect(order.items.flatMap((item) => item.movements)).toEqual(
      expect.arrayContaining([
        { type: "SALE", qtyDelta: -2 },
        { type: "SALE", qtyDelta: -1 },
      ]),
    );
    await expectLedgerInvariants(db, f.variants);
  });

  it("splits a payment between GCash and cash", async () => {
    const f = await createFixture(db);
    await receive(db, f, f.variants[0]!, f.warehouseA, 3);

    const tenders = saleTenders(
      values(f, {
        tenders: [
          { method: "GCASH", amount: "1,500.00", tendered: "", reference: "GC-88120431" },
          { method: "CASH", amount: "1000", tendered: "1000", reference: "" },
        ],
      }),
    );
    const result = await sale(f, [{ variant: 0, qty: 1 }], tenders);

    const payments = await db.payment.findMany({
      where: { orderId: result.id },
      orderBy: { amountCentavos: "desc" },
      select: { method: true, amountCentavos: true, reference: true },
    });
    expect(payments).toEqual([
      { method: "GCASH", amountCentavos: 150_000, reference: "GC-88120431" },
      { method: "CASH", amountCentavos: 100_000, reference: null },
    ]);
  });

  it("refuses a sale the shelf cannot cover and writes nothing", async () => {
    const f = await createFixture(db);
    await receive(db, f, f.variants[0]!, f.warehouseA, 2);
    const before = await db.order.count();

    await expect(
      sale(f, [{ variant: 0, qty: 3 }], [{ method: "CASH", amountCentavos: PRICE * 3 }]),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    expect(await db.order.count()).toBe(before);
    expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 2, reserved: 0 });
    await expectLedgerInvariants(db, f.variants);
  });

  it("holds a capped cashier to the discount limit", async () => {
    const f = await createFixture(db);
    await receive(db, f, f.variants[0]!, f.warehouseA, 5);

    await expect(
      sale(
        f,
        [{ variant: 0, qty: 1 }],
        [{ method: "CASH", amountCentavos: 212_500 }],
        { discountType: "PERCENT", discountValue: "15" },
        1000,
      ),
    ).rejects.toThrow(/Your limit is 10 percent/);

    const allowed = await sale(
      f,
      [{ variant: 0, qty: 1 }],
      [{ method: "CASH", amountCentavos: 225_000 }],
      { discountType: "PERCENT", discountValue: "10" },
      1000,
    );
    expect(allowed.totalCentavos).toBe(225_000);
    expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 4, reserved: 0 });
  });

  it("refuses cash on delivery at the counter", async () => {
    const f = await createFixture(db);
    await receive(db, f, f.variants[0]!, f.warehouseA, 5);
    await expect(
      sale(f, [{ variant: 0, qty: 1 }], [{ method: "COD", amountCentavos: PRICE }]),
    ).rejects.toBeInstanceOf(DomainError);
    expect(await position(db, f.variants[0]!, f.warehouseA)).toEqual({ onHand: 5, reserved: 0 });
  });
});
