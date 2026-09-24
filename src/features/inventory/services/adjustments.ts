import type { Prisma } from "@prisma/client";

import { DomainError, NotFoundError } from "@/lib/errors";
import { nextReference } from "@/lib/numbering";

import type { AdjustmentInput } from "../schemas";
import { resolveAdjustmentLine } from "./movement-rules";
import { applyMovement, lockVariants, type MovementResult } from "./stock";

/**
 * Stock adjustments: the manual correction path for damage, loss, theft,
 * samples and cycle-count differences.
 *
 * One adjustment is one document with one reason, many lines, and one ledger
 * movement per line that actually changes stock. It commits or fails as a
 * whole: if the ninth line would go negative, the first eight are rolled back
 * with it and nothing about the warehouse has changed.
 */

type Tx = Prisma.TransactionClient;

export type AdjustmentLineResult = {
  variantId: string;
  sku: string;
  qtyDelta: number;
  countedQty: number | null;
  balanceBefore: number;
  balanceAfter: number;
  unitCostCentavos: number;
  movement: MovementResult | null;
};

export type AdjustmentResult = {
  id: string;
  reference: string;
  warehouseCode: string;
  lines: AdjustmentLineResult[];
  netUnits: number;
  /** Signed change in inventory value at cost. */
  valueDeltaCentavos: number;
};

export async function createAdjustment(
  tx: Tx,
  input: AdjustmentInput,
  actor: { id: string },
): Promise<AdjustmentResult> {
  // The document number comes first: its counter row is the first lock every
  // stock transaction takes, which keeps lock order consistent (see numbering).
  const reference = await nextReference(tx, "ADJ");

  const warehouse = await tx.warehouse.findFirst({
    where: { id: input.warehouseId, deletedAt: null },
    select: { id: true, code: true, isActive: true },
  });
  if (!warehouse) throw new NotFoundError("That warehouse does not exist.");
  if (!warehouse.isActive) {
    throw new DomainError(
      `${warehouse.code} is inactive. Reactivate it before adjusting its stock.`,
    );
  }

  const variantIds = input.lines.map((line) => line.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    throw new DomainError("Each variant can appear on only one line of an adjustment.");
  }
  const variants = await lockVariants(tx, variantIds);

  // Positions read under the variant locks, so a count is compared with the
  // shelf as it is now, not as it was when the form loaded.
  const levels = await tx.stockLevel.findMany({
    where: { warehouseId: warehouse.id, variantId: { in: variantIds } },
    select: { variantId: true, onHand: true, reserved: true },
  });
  const positions = new Map(levels.map((level) => [level.variantId, level]));

  const resolved = input.lines.map((line) => {
    const variant = variants.get(line.variantId);
    if (!variant) throw new NotFoundError("One of those product variants no longer exists.");
    const position = positions.get(line.variantId) ?? { onHand: 0, reserved: 0 };
    return { line, variant, position, ...resolveAdjustmentLine(line, position, variant.sku) };
  });

  if (resolved.every((entry) => entry.qtyDelta === 0)) {
    throw new DomainError("Nothing to adjust: every count matches what the system already holds.");
  }

  const adjustment = await tx.stockAdjustment.create({
    data: {
      reference,
      warehouseId: warehouse.id,
      reason: input.reason,
      note: input.note === "" ? null : input.note,
      actorId: actor.id,
      items: {
        create: resolved.map((entry) => ({
          variantId: entry.variant.id,
          qtyDelta: entry.qtyDelta,
          countedQty: entry.countedQty,
          note: entry.line.note ? entry.line.note : null,
        })),
      },
    },
    select: { id: true, items: { select: { id: true, variantId: true } } },
  });

  const itemIds = new Map(adjustment.items.map((item) => [item.variantId, item.id]));
  const lines: AdjustmentLineResult[] = [];

  // A count that matches is kept on the document as a confirmed count, but it
  // moves nothing, so it writes no ledger row.
  for (const entry of resolved) {
    let movement: MovementResult | null = null;

    if (entry.qtyDelta !== 0) {
      movement = await applyMovement(tx, {
        variantId: entry.variant.id,
        warehouseId: warehouse.id,
        type: "ADJUSTMENT",
        reason: input.reason,
        qtyDelta: entry.qtyDelta,
        note: entry.line.note || input.note || null,
        actorId: actor.id,
        refs: { adjustmentItemId: itemIds.get(entry.variant.id) },
      });
    }

    lines.push({
      variantId: entry.variant.id,
      sku: entry.variant.sku,
      qtyDelta: entry.qtyDelta,
      countedQty: entry.countedQty,
      balanceBefore: entry.position.onHand,
      balanceAfter: movement?.balanceAfter ?? entry.position.onHand,
      unitCostCentavos: movement?.unitCostCentavos ?? entry.variant.avgCostCentavos,
      movement,
    });
  }

  return {
    id: adjustment.id,
    reference,
    warehouseCode: warehouse.code,
    lines,
    netUnits: lines.reduce((sum, line) => sum + line.qtyDelta, 0),
    valueDeltaCentavos: lines.reduce((sum, line) => sum + line.qtyDelta * line.unitCostCentavos, 0),
  };
}
