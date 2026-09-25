import { faker } from "@faker-js/faker";

import {
  billStatusAfterPayment,
  dueDateFor,
  priceBill,
  unbilledSubtotal,
} from "../../src/features/purchasing/services/bill-rules";
import {
  expectedDateFor,
  pricePurchaseOrder,
} from "../../src/features/purchasing/services/purchase-rules";
import {
  supplierPerformance,
  type Delivery,
} from "../../src/features/suppliers/services/performance-rules";
import { manilaYear, startOfManilaDay } from "../../src/lib/format";
import { formatReference } from "../../src/lib/numbering";
import type { SeedContext } from "./lib/context";
import { addDays, atBusinessHour, chance, clampToNow, intBetween, pick } from "./lib/helpers";

/**
 * Opening stock plus a year of purchasing.
 *
 * Runs before sales so every variant has inventory before anything is sold,
 * which is what keeps the ledger from ever going negative.
 */

/**
 * Units to stock at launch, by price tier, scaled by how well the SKU sells.
 *
 * Sized so that a year of demand turns the inventory roughly three to four
 * times, which is what peripherals retail actually looks like. Stocking a year
 * of cover would make the inventory valuation report larger than annual
 * revenue, which reads as invented.
 */
function openingQtyFor(priceCentavos: number, popularity: number): number {
  const pesos = priceCentavos / 100;
  const base = pesos < 600 ? 150 : pesos < 2000 ? 75 : pesos < 6000 ? 36 : 18;
  return Math.max(8, Math.round(base * Math.min(popularity, 1.8)));
}

export function buildOpeningStock(ctx: SeedContext): void {
  const { ledger, warehouses, variants } = ctx;
  const openedAt = addDays(ctx.windowStart, -30);
  const main = warehouses[0];
  const hub = warehouses[1];
  if (!main || !hub) throw new Error("Expected two seeded warehouses");

  for (const variant of variants) {
    const total = openingQtyFor(variant.priceCentavos, variant.popularity);
    // The Manila warehouse carries the bulk; Cebu is a smaller satellite.
    const cebuQty = Math.max(4, Math.round(total * 0.3));
    const manilaQty = total - cebuQty;

    ledger.receive({
      variantId: variant.id,
      warehouseId: main.id,
      qty: manilaQty,
      unitCostCentavos: variant.baseCostCentavos,
      type: "RECEIPT",
      reason: "OPENING_BALANCE",
      occurredAt: openedAt,
      actorId: ctx.users.warehouse.id,
      note: "Opening balance at go-live",
    });

    ledger.receive({
      variantId: variant.id,
      warehouseId: hub.id,
      qty: cebuQty,
      unitCostCentavos: variant.baseCostCentavos,
      type: "RECEIPT",
      reason: "OPENING_BALANCE",
      occurredAt: openedAt,
      actorId: ctx.users.warehouse.id,
      note: "Opening balance at go-live",
    });
  }
}

/**
 * 15 purchase orders across the year, in every status the flow allows, each
 * placed a set number of days before the run date so the recent ones are
 * always recent. The two closed ones differ on purpose: one arrived in full
 * and was closed as housekeeping, the other was closed short with a reason.
 *
 * `pay` pins how two recent bills stand, so the payables aging always has
 * debt past due whatever day the seed runs; every other bill is paid on
 * roughly the supplier's terms.
 */
type PoPlan = {
  plan:
    "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CLOSED_SHORT" | "CANCELLED";
  daysAgo: number;
  pay?: "none" | "part";
};

const PO_PLAN: readonly PoPlan[] = [
  { plan: "RECEIVED", daysAgo: 338 },
  { plan: "CLOSED", daysAgo: 306 },
  { plan: "RECEIVED", daysAgo: 275 },
  { plan: "CLOSED_SHORT", daysAgo: 243 },
  { plan: "RECEIVED", daysAgo: 212 },
  { plan: "CANCELLED", daysAgo: 186 },
  { plan: "RECEIVED", daysAgo: 157 },
  { plan: "RECEIVED", daysAgo: 118 },
  { plan: "RECEIVED", daysAgo: 84 },
  { plan: "PARTIALLY_RECEIVED", daysAgo: 63, pay: "part" },
  { plan: "RECEIVED", daysAgo: 47, pay: "none" },
  { plan: "PARTIALLY_RECEIVED", daysAgo: 29 },
  { plan: "SENT", daysAgo: 22 },
  { plan: "SENT", daysAgo: 6 },
  { plan: "DRAFT", daysAgo: 2 },
];

type DeliveryLine = { accepted: number; rejected: number };

/**
 * How often each supplier's first truck lands after the expected date, in
 * directory order. The importers with three-week lead times slip most; the
 * Metro Manila distributors rarely do.
 */
const LATE_ODDS = [0.12, 0.3, 0.1, 0.45, 0.2, 0.35, 0.15, 0.25];

/**
 * A year of purchasing, built with the rules the app enforces: totals from
 * pricePurchaseOrder, rejects that stay owed until a later delivery brings
 * them in, bills that match what arrived, due dates from the supplier's
 * terms, numbers per Manila calendar year, and supplier rates measured from
 * the deliveries with the same function the receiving service uses.
 */
export function buildPurchasing(ctx: SeedContext): void {
  const { tables, variants, warehouses } = ctx;
  const main = warehouses[0];
  if (!main) throw new Error("Expected a default warehouse");

  const supplierById = new Map(tables.suppliers.map((row) => [String(row.id), row]));
  const deliveriesBySupplier = new Map<string, Delivery[]>();
  let receiptCounter = 0;
  let receiptItemCounter = 0;
  let billCounter = 0;
  let paymentCounter = 0;

  PO_PLAN.forEach(({ plan, daysAgo, pay }, index) => {
    const status = plan === "CLOSED_SHORT" ? "CLOSED" : plan;
    const shortClose = plan === "CLOSED_SHORT";
    const poId = `po_${String(index + 1).padStart(6, "0")}`;
    const supplierId = ctx.supplierIds[index % ctx.supplierIds.length];
    const supplier = supplierId ? supplierById.get(supplierId) : undefined;
    if (!supplierId || !supplier) throw new Error("Expected seeded suppliers");

    const orderDate = atBusinessHour(addDays(ctx.now, -daysAgo - intBetween(0, 2)));
    const expectedDate = startOfManilaDay(expectedDateFor(orderDate, supplier.leadTimeDays ?? 7));

    const chosen = faker.helpers.arrayElements(variants, intBetween(9, 20));
    const priced = pricePurchaseOrder(
      chosen.map((variant, lineIndex) => ({
        itemId: `poi_${poId}_${lineIndex}`,
        variant,
        qty: orderQtyFor(variant.priceCentavos),
        // Supplier pricing drifts, which is what makes the moving average move.
        unitCostCentavos: Math.round(
          variant.baseCostCentavos * faker.number.float({ min: 0.92, max: 1.09 }),
        ),
      })),
      intBetween(0, 3) === 0 ? 0 : intBetween(45000, 320000),
    );
    const lastLine = priced.lines.length - 1;

    const isDraft = status === "DRAFT";
    const receives =
      status === "RECEIVED" || status === "CLOSED" || status === "PARTIALLY_RECEIVED";

    // ------------------------------------------------ what arrives, and when
    const deliveries: { at: Date; lines: DeliveryLine[] }[] = [];
    // About half the suppliers' trucks arrive clean and complete; the rest
    // carry dock rejects, ship light, or both.
    const qcIssues = chance(0.35);
    const splitShipment = chance(0.25);
    if (receives) {
      const firstAt = clampToNow(
        atBusinessHour(
          addDays(
            expectedDate,
            chance(LATE_ODDS[index % LATE_ODDS.length] ?? 0.25)
              ? intBetween(1, 4)
              : -intBetween(0, 3),
          ),
        ),
        ctx.now,
      );
      const first = priced.lines.map((line, lineIndex): DeliveryLine => {
        if (
          status === "PARTIALLY_RECEIVED" &&
          lineIndex >= Math.max(1, Math.floor(priced.lines.length / 2))
        ) {
          return { accepted: 0, rejected: 0 };
        }
        // The short-closed PO's last line only ever ships two thirds.
        if (shortClose && lineIndex === lastLine) {
          return { accepted: line.qty - Math.ceil(line.qty / 3), rejected: 0 };
        }
        const rejected =
          qcIssues && chance(0.2) ? intBetween(1, Math.max(1, Math.floor(line.qty * 0.06))) : 0;
        // A few lines ship light on the first truck.
        const held =
          status !== "PARTIALLY_RECEIVED" && splitShipment && chance(0.3)
            ? Math.floor(line.qty * 0.3)
            : 0;
        return { accepted: line.qty - rejected - held, rejected };
      });
      deliveries.push({ at: firstAt, lines: first });

      // The balance and the replacements for rejects, on a second truck.
      if (status !== "PARTIALLY_RECEIVED") {
        const second = priced.lines.map((line, lineIndex): DeliveryLine => ({
          accepted:
            shortClose && lineIndex === lastLine ? 0 : line.qty - (first[lineIndex]?.accepted ?? 0),
          rejected: 0,
        }));
        if (second.some((line) => line.accepted > 0)) {
          deliveries.push({
            at: clampToNow(atBusinessHour(addDays(firstAt, intBetween(2, 6))), ctx.now),
            lines: second,
          });
        }
      }
    }

    const receivedByLine = priced.lines.map((_, lineIndex) =>
      deliveries.reduce((sum, delivery) => sum + (delivery.lines[lineIndex]?.accepted ?? 0), 0),
    );
    const shortUnits = priced.lines.reduce(
      (sum, line, lineIndex) => sum + line.qty - (receivedByLine[lineIndex] ?? 0),
      0,
    );
    const lastDeliveryAt = deliveries[deliveries.length - 1]?.at ?? null;

    tables.purchaseOrders.push({
      id: poId,
      poNumber: "", // numbered below, in date order
      supplierId,
      warehouseId: main.id,
      status,
      orderDate,
      expectedDate,
      sentAt: isDraft ? null : orderDate,
      closedAt:
        status === "CLOSED" && lastDeliveryAt
          ? clampToNow(addDays(lastDeliveryAt, intBetween(1, 6)), ctx.now)
          : null,
      cancelledAt: status === "CANCELLED" ? addDays(orderDate, intBetween(2, 11)) : null,
      subtotalCentavos: priced.subtotalCentavos,
      discountCentavos: 0,
      shippingCentavos: priced.shippingCentavos,
      vatCentavos: priced.vatCentavos,
      totalCentavos: priced.totalCentavos,
      notes:
        status === "CANCELLED"
          ? "Cancelled: supplier could not commit to the delivery window."
          : shortClose
            ? `Closed short by ${shortUnits} units: the brand discontinued the colourway and the balance will not ship.`
            : null,
      createdById: ctx.users.manager.id,
      approvedById: isDraft ? null : ctx.users.admin.id,
      createdAt: orderDate,
      updatedAt: lastDeliveryAt ?? orderDate,
    });

    priced.lines.forEach((line, lineIndex) => {
      tables.purchaseOrderItems.push({
        id: line.itemId,
        purchaseOrderId: poId,
        variantId: line.variant.id,
        qtyOrdered: line.qty,
        qtyReceived: receivedByLine[lineIndex] ?? 0,
        unitCostCentavos: line.unitCostCentavos,
        discountCentavos: 0,
        lineTotalCentavos: line.lineTotalCentavos,
      });
    });

    // ------------------------------------------------------------ receipts
    let receivedValue = 0;
    deliveries.forEach((delivery, deliveryIndex) => {
      receiptCounter += 1;
      const receiptId = `rcp_${String(receiptCounter).padStart(6, "0")}`;
      const rejectedHere = delivery.lines.reduce((sum, line) => sum + line.rejected, 0);

      tables.purchaseReceipts.push({
        id: receiptId,
        reference: "", // numbered below
        purchaseOrderId: poId,
        receivedById: ctx.users.warehouse.id,
        receivedAt: delivery.at,
        note:
          rejectedHere > 0
            ? `${rejectedHere} units refused at the dock: crushed cartons and units that failed the bench test.`
            : deliveryIndex > 0
              ? "Balance of the order, with replacements for anything refused."
              : status === "PARTIALLY_RECEIVED"
                ? "Balance of the order still in transit."
                : null,
      });

      let accepted = 0;
      delivery.lines.forEach((entry, lineIndex) => {
        const line = priced.lines[lineIndex];
        if (!line || entry.accepted + entry.rejected === 0) return;
        receiptItemCounter += 1;
        const receiptItemId = `rci_${String(receiptItemCounter).padStart(6, "0")}`;
        tables.purchaseReceiptItems.push({
          id: receiptItemId,
          receiptId,
          purchaseOrderItemId: line.itemId,
          qtyReceived: entry.accepted,
          unitCostCentavos: line.unitCostCentavos,
          qtyRejected: entry.rejected,
        });
        accepted += entry.accepted;
        receivedValue += entry.accepted * line.unitCostCentavos;

        if (entry.accepted > 0) {
          // Queued, not applied. Stock cannot be sold before it lands, so the
          // sales builder drains this by date as it walks through the year.
          ctx.pendingReceipts.push({
            occurredAt: delivery.at,
            variantId: line.variant.id,
            warehouseId: main.id,
            qty: entry.accepted,
            unitCostCentavos: line.unitCostCentavos,
            receiptItemId,
            actorId: ctx.users.warehouse.id,
          });
        }
      });

      const list = deliveriesBySupplier.get(supplierId) ?? [];
      list.push({
        receivedAt: delivery.at,
        expectedDate,
        sentAt: orderDate,
        qtyReceived: accepted,
        qtyRejected: rejectedHere,
      });
      deliveriesBySupplier.set(supplierId, list);
    });

    // ----------------------------------------------------- bill and payments
    if (!lastDeliveryAt) return;

    billCounter += 1;
    const billId = `bil_${String(billCounter).padStart(6, "0")}`;
    const issueDate = startOfManilaDay(
      clampToNow(addDays(lastDeliveryAt, intBetween(0, 3)), ctx.now),
    );
    const dueDate = dueDateFor(issueDate, supplier.paymentTerms ?? "NET_30");
    const totals = priceBill(
      unbilledSubtotal({
        receivedValueCentavos: receivedValue,
        shippingCentavos: priced.shippingCentavos,
        billedSubtotalCentavos: 0,
      }),
    );

    // Older bills are settled; recent ones are still open, which is what gives
    // the payables aging something to show.
    const ageDays = Math.round((ctx.now.getTime() - dueDate.getTime()) / 86_400_000);
    const fullyPaid = pay ? false : ageDays > 20 || (ageDays > -10 && chance(0.3));
    const partiallyPaid = pay ? pay === "part" : !fullyPaid && chance(0.45);
    // Deposits and instalments land on whole pesos, as bank transfers do.
    const share = (percent: number) => Math.round((totals.totalCentavos * percent) / 10_000) * 100;

    const payments: { amount: number; at: Date }[] = [];
    if (fullyPaid && chance(0.35)) {
      const deposit = share(intBetween(35, 60));
      payments.push({ amount: deposit, at: addDays(issueDate, intBetween(2, 8)) });
      payments.push({
        amount: totals.totalCentavos - deposit,
        at: addDays(issueDate, intBetween(9, 20)),
      });
    } else if (fullyPaid) {
      payments.push({ amount: totals.totalCentavos, at: addDays(issueDate, intBetween(2, 14)) });
    } else if (partiallyPaid) {
      payments.push({
        amount: share(intBetween(30, 60)),
        at: addDays(issueDate, intBetween(1, 8)),
      });
    }

    let paid = 0;
    for (const payment of payments) {
      paymentCounter += 1;
      paid += payment.amount;
      tables.supplierPayments.push({
        id: `spm_${String(paymentCounter).padStart(6, "0")}`,
        billId,
        amountCentavos: payment.amount,
        method: pick(["BANK_TRANSFER", "BANK_TRANSFER", "BANK_TRANSFER", "GCASH", "CASH"]),
        reference: `${pick(["BDO", "BPI", "MBTC", "UB"])} ${faker.string.numeric(4)} ${faker.string.numeric(4)}`,
        paidAt: clampToNow(atBusinessHour(payment.at), ctx.now),
        createdById: ctx.users.manager.id,
      });
    }

    tables.supplierBills.push({
      id: billId,
      billNumber: "", // numbered below
      supplierReference: `SI-${faker.string.numeric(6)}`,
      supplierId,
      purchaseOrderId: poId,
      status: billStatusAfterPayment(totals.totalCentavos, paid),
      issueDate,
      dueDate,
      ...totals,
      amountPaidCentavos: paid,
      notes: null,
      createdAt: issueDate,
      updatedAt: issueDate,
    });
  });

  // Numbers restart each Manila calendar year and run in date order, as
  // nextReference allocates them live (decision D-37).
  numberByYear(
    tables.purchaseOrders,
    (row) => row.orderDate as Date,
    "PO",
    (row, reference) => {
      row.poNumber = reference;
    },
  );
  numberByYear(
    tables.purchaseReceipts,
    (row) => row.receivedAt as Date,
    "GRN",
    (row, reference) => {
      row.reference = reference;
    },
  );
  numberByYear(
    tables.supplierBills,
    (row) => row.issueDate as Date,
    "SB",
    (row, reference) => {
      row.billNumber = reference;
    },
  );

  // Scorecards measured from the deliveries above, never typed in.
  for (const supplier of tables.suppliers) {
    const performance = supplierPerformance(deliveriesBySupplier.get(String(supplier.id)) ?? []);
    supplier.onTimeRateBps = performance.onTimeRateBps ?? 0;
    supplier.defectRateBps = performance.defectRateBps ?? 0;
  }
}

function numberByYear<T>(
  rows: T[],
  dateOf: (row: T) => Date,
  kind: "PO" | "GRN" | "SB",
  assign: (row: T, reference: string) => void,
): void {
  const sequence = new Map<number, number>();
  const ordered = [...rows].sort((a, b) => dateOf(a).getTime() - dateOf(b).getTime());
  for (const row of ordered) {
    const year = manilaYear(dateOf(row));
    const next = (sequence.get(year) ?? 0) + 1;
    sequence.set(year, next);
    assign(row, formatReference(kind, year, next));
  }
}

function orderQtyFor(priceCentavos: number): number {
  const pesos = priceCentavos / 100;
  if (pesos < 600) return intBetween(70, 190);
  if (pesos < 2000) return intBetween(35, 95);
  if (pesos < 6000) return intBetween(16, 44);
  return intBetween(7, 20);
}
