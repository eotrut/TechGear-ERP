import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { runStockTransaction } from "@/features/inventory/services/stock";
import type { PurchaseOrderInput } from "@/features/purchasing/schemas";
import {
  createSupplierBill,
  recordSupplierPayment,
  voidSupplierBill,
} from "@/features/purchasing/services/bills";
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  savePurchaseOrder,
  sendPurchaseOrder,
} from "@/features/purchasing/services/purchase-orders";
import { receivePurchaseOrder } from "@/features/purchasing/services/receiving";
import { DomainError, InvalidTransitionError } from "@/lib/errors";
import { manilaDayKey } from "@/lib/format";
import { toPesoInput } from "@/lib/money";

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
 * Purchasing against a real Postgres: a PO through its whole status flow,
 * partial and full receiving that writes RECEIPT movements and moves the
 * moving-average cost, rejects at the dock, concurrent receipts of the same
 * PO, and supplier bills with payments that can never overpay. The stock
 * ledger invariants are re-checked after every flow that moves stock.
 */

const databaseUrl = inject("databaseUrl");

describe.skipIf(databaseUrl === "")("purchasing", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = createTestClient(databaseUrl);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function makeSupplier(terms: "NET_30" | "COD" = "NET_30") {
    const tag = randomBytes(4).toString("hex").toUpperCase();
    return db.supplier.create({
      data: { code: `SUP-${tag}`, name: `Supplier ${tag}`, leadTimeDays: 7, paymentTerms: terms },
      select: { id: true, name: true },
    });
  }

  /** A sent PO for the fixture's variants, into warehouse A unless told otherwise. */
  async function makePo(
    f: Fixture,
    supplierId: string,
    lines: { variant: string; qty: number; cost: number }[],
    {
      intent = "send",
      warehouseId = f.warehouseA,
    }: { intent?: "send" | "draft"; warehouseId?: string } = {},
  ) {
    const input: PurchaseOrderInput = {
      supplierId,
      warehouseId,
      expectedDate: "",
      shipping: "",
      notes: "",
      intent,
      lines: lines.map((line) => ({
        variantId: line.variant,
        qty: line.qty,
        unitCost: toPesoInput(line.cost),
      })),
    };
    return runStockTransaction(db, (tx) => savePurchaseOrder(tx, input, { id: f.userId }));
  }

  async function poItems(purchaseOrderId: string) {
    return db.purchaseOrderItem.findMany({
      where: { purchaseOrderId },
      select: { id: true, variantId: true, qtyOrdered: true, qtyReceived: true },
      orderBy: { id: "asc" },
    });
  }

  /** The PO's line for a variant; the first line when there is only one. */
  async function lineOf(purchaseOrderId: string, variantId?: string) {
    const items = await poItems(purchaseOrderId);
    const item = variantId ? items.find((row) => row.variantId === variantId) : items[0];
    if (!item) throw new Error("PO line missing");
    return item;
  }

  function receiveLines(
    f: Fixture,
    purchaseOrderId: string,
    lines: { itemId: string; qtyReceived: number; qtyRejected?: number; cost: number }[],
    note = "",
  ) {
    return runStockTransaction(db, (tx) =>
      receivePurchaseOrder(
        tx,
        {
          purchaseOrderId,
          note,
          lines: lines.map((line) => ({
            itemId: line.itemId,
            qtyReceived: line.qtyReceived,
            qtyRejected: line.qtyRejected ?? 0,
            unitCost: toPesoInput(line.cost),
          })),
        },
        { id: f.userId },
      ),
    );
  }

  async function avgCost(variantId: string) {
    const row = await db.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { avgCostCentavos: true, lastCostCentavos: true },
    });
    return row;
  }

  // ------------------------------------------------------------- receiving

  describe("receiving", () => {
    it("receives in two deliveries: stock, cost, status and the ledger all follow", async () => {
      const f = await createFixture(db, { variants: 2 });
      const [kb, mouse] = f.variants as [string, string];
      const supplier = await makeSupplier();
      // Somebody who pays bills, so the deliveries have an audience.
      const manager = await db.user.create({
        data: {
          email: `mgr-${randomBytes(4).toString("hex")}@test.techgear.ph`,
          name: "Receiving manager",
          passwordHash: "not-a-real-hash",
          role: "MANAGER",
        },
        select: { id: true },
      });

      // Existing stock: 40 keyboards at 1,500.00.
      await receive(db, f, kb, f.warehouseA, 40, 150_000);

      const po = await makePo(f, supplier.id, [
        { variant: kb, qty: 30, cost: 180_000 },
        { variant: mouse, qty: 10, cost: 60_000 },
      ]);
      expect(po.status).toBe("SENT");
      const kbItem = await lineOf(po.id, kb);
      const mouseItem = await lineOf(po.id, mouse);

      // First delivery: 20 keyboards arrive at a better price than ordered.
      const first = await receiveLines(f, po.id, [
        { itemId: kbItem.id, qtyReceived: 20, cost: 174_000 },
      ]);
      expect(first.statusBefore).toBe("SENT");
      expect(first.statusAfter).toBe("PARTIALLY_RECEIVED");
      expect(first.reference).toMatch(/^GRN-\d{4}-\d{4}$/);
      // (40 * 1500 + 20 * 1740) / 60 = 1580
      expect(first.lines[0]).toMatchObject({
        avgCostBeforeCentavos: 150_000,
        avgCostAfterCentavos: 158_000,
        balanceAfter: 60,
      });
      expect(await position(db, kb, f.warehouseA)).toEqual({ onHand: 60, reserved: 0 });
      expect(await avgCost(kb)).toEqual({ avgCostCentavos: 158_000, lastCostCentavos: 174_000 });

      // The movement points back at the receipt line.
      const movement = await db.stockMovement.findFirstOrThrow({
        where: { variantId: kb, type: "RECEIPT", purchaseReceiptItem: { receiptId: first.id } },
        select: {
          qtyDelta: true,
          unitCostCentavos: true,
          avgCostAfterCentavos: true,
          reason: true,
        },
      });
      expect(movement).toEqual({
        qtyDelta: 20,
        unitCostCentavos: 174_000,
        avgCostAfterCentavos: 158_000,
        reason: "PURCHASE_RECEIPT",
      });

      // Second delivery: the balance of both lines.
      const second = await receiveLines(f, po.id, [
        { itemId: kbItem.id, qtyReceived: 10, cost: 180_000 },
        { itemId: mouseItem.id, qtyReceived: 10, cost: 60_000 },
      ]);
      expect(second.statusBefore).toBe("PARTIALLY_RECEIVED");
      expect(second.statusAfter).toBe("RECEIVED");
      expect(second.reference).not.toBe(first.reference);
      // (60 * 1580 + 10 * 1800) / 70 = 1611.43 -> 1611.43 rounds to 161,143
      expect(second.lines.find((line) => line.sku === f.skus[0])?.avgCostAfterCentavos).toBe(
        161_143,
      );
      // First stock of the mouse seeds its average.
      expect((await avgCost(mouse)).avgCostCentavos).toBe(60_000);

      const items = await poItems(po.id);
      expect(items.every((item) => item.qtyReceived === item.qtyOrdered)).toBe(true);
      const header = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        select: { status: true, _count: { select: { receipts: true } } },
      });
      expect(header).toEqual({ status: "RECEIVED", _count: { receipts: 2 } });

      // One announcement per delivery, to each person who pays bills.
      const deliveries = await db.notification.count({
        where: { type: "PO_RECEIVED", link: `/purchasing/${po.id}`, userId: manager.id },
      });
      expect(deliveries).toBe(2);

      await expectLedgerInvariants(db, f.variants);
    });

    it("averages against stock in every warehouse, not only the receiving one", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();

      await receive(db, f, kb, f.warehouseB, 10, 100_000);
      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 30, cost: 140_000 }]);
      const item = await lineOf(po.id);

      const result = await receiveLines(f, po.id, [
        { itemId: item.id, qtyReceived: 30, cost: 140_000 },
      ]);
      // (10 * 1000 + 30 * 1400) / 40 = 1300, decision D-8.
      expect(result.lines[0]?.avgCostAfterCentavos).toBe(130_000);
      expect(await position(db, kb, f.warehouseA)).toEqual({ onHand: 30, reserved: 0 });
      expect(await position(db, kb, f.warehouseB)).toEqual({ onHand: 10, reserved: 0 });
      await expectLedgerInvariants(db, f.variants);
    });

    it("keeps rejected units out of stock and outstanding on the PO", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();
      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 20, cost: 100_000 }]);
      const item = await lineOf(po.id);

      // A reject needs a reason on the form; the service records it either way.
      const result = await receiveLines(
        f,
        po.id,
        [{ itemId: item.id, qtyReceived: 15, qtyRejected: 5, cost: 100_000 }],
        "Five with dead switches on arrival",
      );
      expect(result.acceptedUnits).toBe(15);
      expect(result.rejectedUnits).toBe(5);
      expect(result.statusAfter).toBe("PARTIALLY_RECEIVED");
      expect(await position(db, kb, f.warehouseA)).toEqual({ onHand: 15, reserved: 0 });

      // The five rejected are still owed: a replacement shipment can bring them in.
      const after = await lineOf(po.id);
      expect(after.qtyReceived).toBe(15);
      const replacement = await receiveLines(f, po.id, [
        { itemId: item.id, qtyReceived: 5, cost: 100_000 },
      ]);
      expect(replacement.statusAfter).toBe("RECEIVED");

      // 5 rejected of 25 that arrived across both deliveries.
      const rates = await db.supplier.findUniqueOrThrow({
        where: { id: supplier.id },
        select: { defectRateBps: true, onTimeRateBps: true },
      });
      expect(rates.defectRateBps).toBe(2000);
      // Both deliveries arrived today, well inside the 7-day lead time.
      expect(rates.onTimeRateBps).toBe(10_000);
      await expectLedgerInvariants(db, f.variants);
    });

    it("leaves the status alone when a whole delivery is rejected", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();
      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 4, cost: 100_000 }]);
      const item = await lineOf(po.id);

      const result = await receiveLines(
        f,
        po.id,
        [{ itemId: item.id, qtyReceived: 0, qtyRejected: 4, cost: 0 }],
        "Wrong model shipped",
      );
      expect(result.statusAfter).toBe("SENT");
      expect(await position(db, kb, f.warehouseA)).toEqual({ onHand: 0, reserved: 0 });
      expect(await db.stockMovement.count({ where: { variantId: kb } })).toBe(0);
    });

    it("refuses a draft, an over-receipt and a finished PO, and writes nothing", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();

      const draft = await makePo(f, supplier.id, [{ variant: kb, qty: 5, cost: 100_000 }], {
        intent: "draft",
      });
      const draftItem = await lineOf(draft.id);
      await expect(
        receiveLines(f, draft.id, [{ itemId: draftItem.id, qtyReceived: 5, cost: 100_000 }]),
      ).rejects.toThrow(/still a draft/);

      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 5, cost: 100_000 }]);
      const item = await lineOf(po.id);
      await expect(
        receiveLines(f, po.id, [{ itemId: item.id, qtyReceived: 6, cost: 100_000 }]),
      ).rejects.toThrow(DomainError);
      expect(await db.purchaseReceipt.count({ where: { purchaseOrderId: po.id } })).toBe(0);
      expect(await position(db, kb, f.warehouseA)).toEqual({ onHand: 0, reserved: 0 });

      await receiveLines(f, po.id, [{ itemId: item.id, qtyReceived: 5, cost: 100_000 }]);
      await expect(
        receiveLines(f, po.id, [{ itemId: item.id, qtyReceived: 1, cost: 100_000 }]),
      ).rejects.toThrow(/received, so nothing more/);
      await expectLedgerInvariants(db, f.variants);
    });

    it("lets two people receive the same balance at once without doubling it", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();
      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 12, cost: 100_000 }]);
      const item = await lineOf(po.id);

      const { ok, failed } = await settle(
        Array.from({ length: 4 }, () =>
          receiveLines(f, po.id, [{ itemId: item.id, qtyReceived: 12, cost: 100_000 }]),
        ),
      );
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(3);
      for (const error of failed) expect(error).toBeInstanceOf(DomainError);

      expect(await position(db, kb, f.warehouseA)).toEqual({ onHand: 12, reserved: 0 });
      const after = await lineOf(po.id);
      expect(after.qtyReceived).toBe(12);
      await expectLedgerInvariants(db, f.variants);
    });
  });

  // ------------------------------------------------------------- lifecycle

  describe("lifecycle", () => {
    it("edits a draft, then refuses edits once sent", async () => {
      const f = await createFixture(db, { variants: 2 });
      const [a, b] = f.variants as [string, string];
      const supplier = await makeSupplier();
      const draft = await makePo(f, supplier.id, [{ variant: a, qty: 5, cost: 100_000 }], {
        intent: "draft",
      });
      expect(draft.status).toBe("DRAFT");

      const input: PurchaseOrderInput = {
        id: draft.id,
        supplierId: supplier.id,
        warehouseId: f.warehouseA,
        expectedDate: "",
        shipping: "250",
        notes: "",
        intent: "draft",
        lines: [
          { variantId: a, qty: 8, unitCost: "1000" },
          { variantId: b, qty: 2, unitCost: "450.50" },
        ],
      };
      const edited = await runStockTransaction(db, (tx) =>
        savePurchaseOrder(tx, input, { id: f.userId }),
      );
      expect(edited).toMatchObject({
        id: draft.id,
        poNumber: draft.poNumber,
        created: false,
        lines: 2,
        units: 10,
      });
      const header = await db.purchaseOrder.findUniqueOrThrow({
        where: { id: draft.id },
        select: {
          subtotalCentavos: true,
          shippingCentavos: true,
          vatCentavos: true,
          totalCentavos: true,
        },
      });
      // 8 * 1000 + 2 * 450.50 = 8901.00; VAT on 8901 + 250 freight = 1098.12
      expect(header).toEqual({
        subtotalCentavos: 890_100,
        shippingCentavos: 25_000,
        vatCentavos: 109_812,
        totalCentavos: 1_024_912,
      });

      await runStockTransaction(db, (tx) => sendPurchaseOrder(tx, draft.id, { id: f.userId }));
      await expect(
        runStockTransaction(db, (tx) => savePurchaseOrder(tx, input, { id: f.userId })),
      ).rejects.toThrow(/has been sent/);
      await expect(
        runStockTransaction(db, (tx) => sendPurchaseOrder(tx, draft.id, { id: f.userId })),
      ).rejects.toBeInstanceOf(InvalidTransitionError);
    });

    it("cancels before delivery, and refuses once anything has arrived", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();

      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 5, cost: 100_000 }]);
      const cancelled = await runStockTransaction(db, (tx) =>
        cancelPurchaseOrder(tx, { purchaseOrderId: po.id, reason: "Supplier out of stock" }),
      );
      expect(cancelled.from).toBe("SENT");

      const other = await makePo(f, supplier.id, [{ variant: kb, qty: 5, cost: 100_000 }]);
      const item = await lineOf(other.id);
      await receiveLines(f, other.id, [{ itemId: item.id, qtyReceived: 2, cost: 100_000 }]);
      await expect(
        runStockTransaction(db, (tx) =>
          cancelPurchaseOrder(tx, { purchaseOrderId: other.id, reason: "Changed our mind" }),
        ),
      ).rejects.toThrow(/cannot be un-received/);
    });

    it("closes a partial order short only with a reason, then refuses deliveries", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();
      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 10, cost: 100_000 }]);
      const item = await lineOf(po.id);
      await receiveLines(f, po.id, [{ itemId: item.id, qtyReceived: 7, cost: 100_000 }]);

      await expect(
        runStockTransaction(db, (tx) =>
          closePurchaseOrder(tx, { purchaseOrderId: po.id, reason: "" }),
        ),
      ).rejects.toThrow(/Say why/);
      const closed = await runStockTransaction(db, (tx) =>
        closePurchaseOrder(tx, { purchaseOrderId: po.id, reason: "Model discontinued" }),
      );
      expect(closed).toMatchObject({ from: "PARTIALLY_RECEIVED", shortUnits: 3 });

      await expect(
        receiveLines(f, po.id, [{ itemId: item.id, qtyReceived: 3, cost: 100_000 }]),
      ).rejects.toThrow(/closed/);
    });
  });

  // ------------------------------------------------------------------ bills

  describe("bills and payments", () => {
    async function receivedPo(f: Fixture, supplierId: string) {
      const [kb] = f.variants as [string];
      const po = await makePo(f, supplierId, [{ variant: kb, qty: 10, cost: 100_000 }]);
      const item = await lineOf(po.id);
      await receiveLines(f, po.id, [{ itemId: item.id, qtyReceived: 10, cost: 100_000 }]);
      return po;
    }

    const today = () => manilaDayKey(new Date());

    it("bills a received PO on the supplier's terms and refuses the same invoice twice", async () => {
      const f = await createFixture(db, { variants: 1 });
      const supplier = await makeSupplier("NET_30");
      const po = await receivedPo(f, supplier.id);

      const bill = await runStockTransaction(db, (tx) =>
        createSupplierBill(tx, {
          supplierId: supplier.id,
          purchaseOrderId: po.id,
          supplierReference: "INV-10442",
          issueDate: today(),
          dueDate: "",
          subtotal: "10000",
          notes: "",
        }),
      );
      expect(bill.billNumber).toMatch(/^SB-\d{4}-\d{4}$/);
      expect(bill.totalCentavos).toBe(1_120_000);
      const stored = await db.supplierBill.findUniqueOrThrow({
        where: { id: bill.id },
        select: { status: true, issueDate: true, dueDate: true },
      });
      expect(stored.status).toBe("OPEN");
      expect((stored.dueDate.getTime() - stored.issueDate.getTime()) / 86_400_000).toBe(30);

      await expect(
        runStockTransaction(db, (tx) =>
          createSupplierBill(tx, {
            supplierId: supplier.id,
            purchaseOrderId: po.id,
            supplierReference: "inv-10442",
            issueDate: today(),
            dueDate: "",
            subtotal: "10000",
            notes: "",
          }),
        ),
      ).rejects.toThrow(/already recorded/);
    });

    it("refuses to bill a PO nothing has arrived against", async () => {
      const f = await createFixture(db, { variants: 1 });
      const [kb] = f.variants as [string];
      const supplier = await makeSupplier();
      const po = await makePo(f, supplier.id, [{ variant: kb, qty: 10, cost: 100_000 }]);
      await expect(
        runStockTransaction(db, (tx) =>
          createSupplierBill(tx, {
            supplierId: supplier.id,
            purchaseOrderId: po.id,
            supplierReference: "INV-1",
            issueDate: today(),
            dueDate: "",
            subtotal: "100",
            notes: "",
          }),
        ),
      ).rejects.toThrow(/once goods have arrived/);
    });

    it("pays in two parts, refuses overpayment, and cannot void a paid bill", async () => {
      const f = await createFixture(db, { variants: 1 });
      const supplier = await makeSupplier();
      const po = await receivedPo(f, supplier.id);
      const bill = await runStockTransaction(db, (tx) =>
        createSupplierBill(tx, {
          supplierId: supplier.id,
          purchaseOrderId: po.id,
          supplierReference: `INV-${po.poNumber}`,
          issueDate: today(),
          dueDate: "",
          subtotal: "10000",
          notes: "",
        }),
      );

      const pay = (amount: string) =>
        runStockTransaction(db, (tx) =>
          recordSupplierPayment(
            tx,
            {
              billId: bill.id,
              amount,
              method: "BANK_TRANSFER",
              reference: "BDO-778812",
              paidOn: today(),
            },
            { id: f.userId },
          ),
        );

      const first = await pay("5000");
      expect(first).toMatchObject({ statusAfter: "PARTIALLY_PAID", balanceAfterCentavos: 620_000 });
      await expect(pay("6200.01")).rejects.toThrow(/overpay/);
      await expect(
        runStockTransaction(db, (tx) =>
          voidSupplierBill(tx, { billId: bill.id, reason: "Duplicate" }),
        ),
      ).rejects.toThrow(/has payments/);
      const second = await pay("6200");
      expect(second).toMatchObject({ statusAfter: "PAID", balanceAfterCentavos: 0 });
      await expect(pay("1")).rejects.toThrow(/already paid/);
    });

    it("never lets simultaneous payments overpay a bill", async () => {
      const f = await createFixture(db, { variants: 1 });
      const supplier = await makeSupplier();
      const po = await receivedPo(f, supplier.id);
      const bill = await runStockTransaction(db, (tx) =>
        createSupplierBill(tx, {
          supplierId: supplier.id,
          purchaseOrderId: po.id,
          supplierReference: `INV-R-${po.poNumber}`,
          issueDate: today(),
          dueDate: "",
          subtotal: "1000",
          notes: "",
        }),
      );

      // Total is 1,120.00; five people each try to pay 400.00 at once.
      const { ok } = await settle(
        Array.from({ length: 5 }, () =>
          runStockTransaction(db, (tx) =>
            recordSupplierPayment(
              tx,
              { billId: bill.id, amount: "400", method: "CASH", reference: "", paidOn: today() },
              { id: f.userId },
            ),
          ),
        ),
      );
      expect(ok).toHaveLength(2);
      const stored = await db.supplierBill.findUniqueOrThrow({
        where: { id: bill.id },
        select: { amountPaidCentavos: true, status: true, _count: { select: { payments: true } } },
      });
      expect(stored).toEqual({
        amountPaidCentavos: 80_000,
        status: "PARTIALLY_PAID",
        _count: { payments: 2 },
      });
    });

    it("voids an unpaid bill, which frees its invoice number", async () => {
      const f = await createFixture(db, { variants: 1 });
      const supplier = await makeSupplier();
      const po = await receivedPo(f, supplier.id);
      const input = {
        supplierId: supplier.id,
        purchaseOrderId: po.id,
        supplierReference: `INV-V-${po.poNumber}`,
        issueDate: today(),
        dueDate: "",
        subtotal: "1000",
        notes: "",
      };
      const bill = await runStockTransaction(db, (tx) => createSupplierBill(tx, input));
      const voided = await runStockTransaction(db, (tx) =>
        voidSupplierBill(tx, { billId: bill.id, reason: "Keyed against the wrong PO" }),
      );
      expect(voided.from).toBe("OPEN");
      // Re-entering the same invoice after a void is the correction path.
      await expect(
        runStockTransaction(db, (tx) => createSupplierBill(tx, input)),
      ).resolves.toBeTruthy();
    });
  });
});
