import type { StockReason, TransferStatus } from "@prisma/client";
import { faker } from "@faker-js/faker";

import { manilaYear } from "../../src/lib/format";
import { formatReference, type ReferenceKind } from "../../src/lib/numbering";

import type { SeedContext, VariantRef, WarehouseRef } from "./lib/context";
import { addDays, atBusinessHour, clampToNow, intBetween } from "./lib/helpers";

/**
 * Stock corrections and inter-warehouse transfers across the year, so the
 * adjustments and transfers pages have a history worth reading and every
 * transfer status appears at least once.
 *
 * These run after every other builder, which means the rest of the history
 * already exists when they are placed. Each outflow is sized with
 * `ledger.headroom`, the lowest balance the position reaches from that date
 * on, so a correction dated in March can never take stock that a sale in
 * July needed. The chronological replay would reject it if it did.
 *
 * Quantities are deliberately small. A shop writes off two dented switch
 * testers, not a hundred keyboards.
 */

type AdjustmentLine = { variant: VariantRef; qtyDelta: number; countedQty?: number; note?: string };

type AdjustmentPlan = {
  daysAgo: number;
  warehouse: WarehouseRef;
  reason: StockReason;
  note: string;
  /** Returns the lines, sized against the ledger at the adjustment's date. */
  lines: (at: Date) => AdjustmentLine[];
};

type TransferPlan = {
  daysAgo: number;
  from: WarehouseRef;
  to: WarehouseRef;
  status: TransferStatus;
  note: string;
  lines: number;
  /** Units short on the first line when received. */
  shortOnFirstLine?: number;
  receivingNote?: string;
  cancelNote?: string;
};

/** Sequence per document kind and Manila year, allocated in date order. */
function referenceAllocator() {
  const counters = new Map<string, number>();
  return (kind: ReferenceKind, at: Date): string => {
    const year = manilaYear(at);
    const key = `${kind}-${year}`;
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return formatReference(kind, year, next);
  };
}

export function buildStockCorrections(ctx: SeedContext): void {
  const { ledger, tables, warehouses } = ctx;
  const main = warehouses[0];
  const hub = warehouses[1];
  if (!main || !hub) return;

  const actorId = ctx.users.warehouse.id;
  const nextReference = referenceAllocator();
  const at = (daysAgo: number) => clampToNow(atBusinessHour(addDays(ctx.now, -daysAgo)), ctx.now);

  /** Variants that can give up `qty` at a warehouse on a date, excluding some. */
  const withHeadroom = (warehouse: WarehouseRef, date: Date, qty: number, exclude: Set<string>) =>
    ctx.variants.filter(
      (variant) =>
        !exclude.has(variant.id) && ledger.headroom(variant.id, warehouse.id, date) >= qty,
    );

  // Variants on the open transfers stay out of the final cycle count, so the
  // draft can still be dispatched and the in-transit lines stay believable.
  const reservedForTransfers = new Set<string>();

  // ------------------------------------------------------------- the plans

  const adjustments: AdjustmentPlan[] = [
    {
      daysAgo: 301,
      warehouse: main,
      reason: "DAMAGE",
      note: "Carton crushed by the forklift while unloading at the Quezon City dock.",
      lines: (date) =>
        faker.helpers
          .arrayElements(withHeadroom(main, date, 4, reservedForTransfers), 2)
          .map((variant) => ({ variant, qtyDelta: -intBetween(1, 2) })),
    },
    {
      daysAgo: 214,
      warehouse: hub,
      reason: "LOSS",
      note: "Missing after the Cebu hub reshelving. Searched aisles 1 to 4.",
      lines: (date) =>
        faker.helpers
          .arrayElements(withHeadroom(hub, date, 3, reservedForTransfers), 1)
          .map((variant) => ({ variant, qtyDelta: -1 })),
    },
    {
      daysAgo: 142,
      warehouse: main,
      reason: "SAMPLE",
      note: "Review units sent to the Kalye Keebs channel for the budget boards video.",
      lines: (date) =>
        faker.helpers
          .arrayElements(withHeadroom(main, date, 3, reservedForTransfers), 2)
          .map((variant) => ({ variant, qtyDelta: -1 })),
    },
    {
      daysAgo: 76,
      warehouse: hub,
      reason: "COUNT_CORRECTION",
      note: "Monthly count found units shelved behind the returns cage.",
      lines: () =>
        faker.helpers.arrayElements(ctx.variants, 2).map((variant) => {
          const found = intBetween(1, 2);
          return { variant, qtyDelta: found, note: `Found ${found} mis-shelved.` };
        }),
    },
    {
      daysAgo: 34,
      warehouse: main,
      reason: "THEFT",
      note: "Taken from the Katipunan showroom display. Barangay blotter entry 2026-0817.",
      lines: (date) =>
        faker.helpers
          .arrayElements(withHeadroom(main, date, 2, reservedForTransfers), 1)
          .map((variant) => ({ variant, qtyDelta: -1 })),
    },
    {
      daysAgo: 9,
      warehouse: main,
      reason: "DAMAGE",
      note: "Roof leak over aisle F during the typhoon. Boxes soaked, units not saleable.",
      lines: (date) =>
        faker.helpers
          .arrayElements(withHeadroom(main, date, 4, reservedForTransfers), 3)
          .map((variant) => ({ variant, qtyDelta: -intBetween(1, 3) })),
    },
  ];

  const transfers: TransferPlan[] = [
    {
      daysAgo: 341,
      from: main,
      to: hub,
      status: "RECEIVED",
      note: "Rebalancing fast movers ahead of the Cebu weekend rush.",
      lines: 3,
    },
    {
      daysAgo: 118,
      from: main,
      to: hub,
      status: "RECEIVED",
      note: "Stocking Cebu for the back to school rush.",
      lines: 4,
    },
    {
      daysAgo: 71,
      from: main,
      to: hub,
      status: "CANCELLED",
      note: "Top up for the Cebu pop-up booth.",
      lines: 2,
      cancelNote: "Cancelled: Pop-up booth postponed by the mall.",
    },
    {
      daysAgo: 46,
      from: hub,
      to: main,
      status: "RECEIVED",
      note: "Returning slow sellers from Cebu to Manila.",
      lines: 3,
      shortOnFirstLine: 1,
      receivingNote: "Receiving: One unit arrived with a cracked case and was set aside.",
    },
    {
      daysAgo: 1,
      from: main,
      to: hub,
      status: "IN_TRANSIT",
      note: "Replenishing Cebu out of stocks before the 10.10 sale.",
      lines: 3,
    },
    {
      daysAgo: 0,
      from: main,
      to: hub,
      status: "DRAFT",
      note: "Pick list for Friday's truck to Cebu.",
      lines: 2,
    },
  ];

  // --------------------------------------------------------- adjustments

  let adjustmentCounter = 0;
  const writeAdjustment = (
    date: Date,
    warehouse: WarehouseRef,
    reason: StockReason,
    note: string,
    lines: AdjustmentLine[],
  ) => {
    if (lines.length === 0) return;
    adjustmentCounter += 1;
    const adjustmentId = `adj_${String(adjustmentCounter).padStart(6, "0")}`;

    tables.stockAdjustments.push({
      id: adjustmentId,
      reference: nextReference("ADJ", date),
      warehouseId: warehouse.id,
      reason,
      note,
      actorId,
      createdAt: date,
    });

    lines.forEach((line, index) => {
      const itemId = `adi_${adjustmentId}_${index}`;
      tables.stockAdjustmentItems.push({
        id: itemId,
        adjustmentId,
        variantId: line.variant.id,
        qtyDelta: line.qtyDelta,
        countedQty: line.countedQty ?? null,
        note: line.note ?? null,
      });
      if (line.qtyDelta === 0) return;
      ledger.adjust({
        variantId: line.variant.id,
        warehouseId: warehouse.id,
        qtyDelta: line.qtyDelta,
        reason,
        occurredAt: date,
        actorId,
        note: line.note ?? note,
        refs: { adjustmentItemId: itemId },
      });
    });
  };

  // ----------------------------------------------------------- transfers

  let transferCounter = 0;
  const writeTransfer = (plan: TransferPlan) => {
    const created = at(plan.daysAgo);
    const shipped = plan.status === "IN_TRANSIT" || plan.status === "RECEIVED" ? created : null;
    const received = plan.status === "RECEIVED" ? clampToNow(addDays(created, 2), ctx.now) : null;

    // Dispatch draws on the source at the shipping date; a draft must still be
    // shippable today, so it is sized against the source as it stands now.
    const sizedAt = shipped ?? ctx.now;
    const candidates = withHeadroom(plan.from, sizedAt, 12, reservedForTransfers);
    const chosen = faker.helpers.arrayElements(candidates, Math.min(plan.lines, candidates.length));
    if (chosen.length === 0) return;

    transferCounter += 1;
    const transferId = `trf_${String(transferCounter).padStart(6, "0")}`;

    const notes = [plan.note, plan.receivingNote, plan.cancelNote].filter(Boolean).join("\n");
    tables.stockTransfers.push({
      id: transferId,
      reference: nextReference("TRF", created),
      fromWarehouseId: plan.from.id,
      toWarehouseId: plan.to.id,
      status: plan.status,
      note: notes,
      actorId,
      shippedAt: shipped,
      receivedAt: received,
      createdAt: created,
      updatedAt: received ?? (plan.status === "CANCELLED" ? addDays(created, 1) : created),
    });

    chosen.forEach((variant, index) => {
      if (plan.status === "IN_TRANSIT" || plan.status === "DRAFT")
        reservedForTransfers.add(variant.id);

      // Small and bounded by the headroom at the dispatch date.
      const limit = Math.floor(ledger.headroom(variant.id, plan.from.id, sizedAt) / 3);
      const qty = Math.max(1, Math.min(intBetween(2, 6), limit));
      const short = index === 0 ? Math.min(plan.shortOnFirstLine ?? 0, qty - 1) : 0;
      const qtyReceived = plan.status === "RECEIVED" ? qty - short : 0;

      const itemId = `tri_${transferId}_${index}`;
      tables.stockTransferItems.push({
        id: itemId,
        transferId,
        variantId: variant.id,
        qty,
        qtyReceived,
      });

      if (!shipped) return;

      ledger.issue({
        variantId: variant.id,
        warehouseId: plan.from.id,
        qty,
        type: "TRANSFER_OUT",
        reason: "TRANSFER",
        occurredAt: shipped,
        actorId,
        note: `Dispatched on ${String(tables.stockTransfers.at(-1)?.reference)}`,
        refs: { transferItemId: itemId },
      });

      if (received && qtyReceived > 0) {
        ledger.receive({
          variantId: variant.id,
          warehouseId: plan.to.id,
          qty: qtyReceived,
          unitCostCentavos: ledger.getAvgCost(variant.id),
          type: "TRANSFER_IN",
          reason: "TRANSFER",
          occurredAt: received,
          actorId,
          recomputeAverage: false,
          note: short > 0 ? `Received ${qtyReceived} of ${qty}.` : undefined,
          refs: { transferItemId: itemId },
        });
      }
    });
  };

  // Transfers first: the open ones claim their variants before any
  // correction can take the stock they are about to move.
  for (const plan of [...transfers].sort((a, b) => b.daysAgo - a.daysAgo)) writeTransfer(plan);

  for (const plan of [...adjustments].sort((a, b) => b.daysAgo - a.daysAgo)) {
    const date = at(plan.daysAgo);
    writeAdjustment(date, plan.warehouse, plan.reason, plan.note, plan.lines(date));
  }

  // ------------------------------------------------ today's cycle count

  // Dated now, so it is the last event in the ledger and can be sized from
  // the final position. It finds a handful of SKUs short, which is what puts
  // a few genuinely empty shelves in front of the alerts page.
  const countedAt = ctx.now;
  const counted = ctx.variants.filter((variant) => !reservedForTransfers.has(variant.id));
  const lines: AdjustmentLine[] = [];

  const nearlyEmpty = counted.filter((variant) => {
    const available = ledger.getAvailable(variant.id, main.id);
    return available >= 1 && available <= 3;
  });
  for (const variant of faker.helpers.arrayElements(nearlyEmpty, Math.min(4, nearlyEmpty.length))) {
    const onHand = ledger.getOnHand(variant.id, main.id);
    const reserved = ledger.getReserved(variant.id, main.id);
    lines.push({
      variant,
      qtyDelta: reserved - onHand,
      countedQty: reserved,
      note: "Bin empty at count. Shrinkage written off.",
    });
  }

  const slightlyOver = counted.filter((variant) => {
    if (lines.some((line) => line.variant.id === variant.id)) return false;
    const available = ledger.getAvailable(variant.id, main.id);
    return (
      variant.reorderLevel > 0 &&
      available > variant.reorderLevel &&
      available <= variant.reorderLevel + 3
    );
  });
  for (const variant of faker.helpers.arrayElements(
    slightlyOver,
    Math.min(5, slightlyOver.length),
  )) {
    const onHand = ledger.getOnHand(variant.id, main.id);
    const shortBy = onHand - ledger.getReserved(variant.id, main.id) - variant.reorderLevel;
    lines.push({
      variant,
      qtyDelta: -shortBy,
      countedQty: onHand - shortBy,
      note: "Count came up short.",
    });
  }

  // A couple of bins that matched, recorded as confirmed counts.
  const confirmed = counted.filter(
    (variant) =>
      !lines.some((line) => line.variant.id === variant.id) &&
      ledger.getOnHand(variant.id, main.id) > 10,
  );
  for (const variant of faker.helpers.arrayElements(confirmed, Math.min(2, confirmed.length))) {
    lines.push({ variant, qtyDelta: 0, countedQty: ledger.getOnHand(variant.id, main.id) });
  }

  writeAdjustment(
    countedAt,
    main,
    "COUNT_CORRECTION",
    "Quarterly cycle count, Manila main aisles A to D.",
    lines,
  );
}
