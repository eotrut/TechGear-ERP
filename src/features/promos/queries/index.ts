import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import type { PromoFormValues, PromoView } from "../schemas";
import { promoState, type PromoState } from "../services/promo-rules";

/** Promo read paths. */

export const PROMO_PAGE_SIZE = 25;

export type PromoRow = {
  id: string;
  code: string;
  description: string;
  type: "PERCENT" | "FIXED";
  percentBps: number | null;
  amountCentavos: number | null;
  minSubtotalCentavos: number;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  isActive: boolean;
  state: PromoState;
  discountGivenCentavos: number;
  /** For the edit dialog, in the form's own shape. */
  values: PromoFormValues;
};

const MANILA_OFFSET_MS = 8 * 3_600_000;

function manilaDay(value: Date): string {
  return new Date(value.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

function whereFor(view: PromoView, now: Date): Prisma.PromoWhereInput {
  switch (view) {
    case "active":
      return { deletedAt: null, isActive: true, startsAt: { lte: now }, endsAt: { gte: now } };
    case "scheduled":
      return { deletedAt: null, isActive: true, startsAt: { gt: now } };
    case "expired":
      return { deletedAt: null, endsAt: { lt: now } };
    case "inactive":
      return { OR: [{ isActive: false }, { deletedAt: { not: null } }] };
    case "all":
      return {};
  }
}

export async function listPromos(view: PromoView, page: number, now: Date) {
  const where = whereFor(view, now);
  const [rows, total, given, counts] = await Promise.all([
    db.promo.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { endsAt: "desc" }, { code: "asc" }],
      skip: (page - 1) * PROMO_PAGE_SIZE,
      take: PROMO_PAGE_SIZE,
    }),
    db.promo.count({ where }),
    db.promoRedemption.groupBy({ by: ["promoId"], _sum: { discountAppliedCentavos: true } }),
    Promise.all(
      (["all", "active", "scheduled", "expired", "inactive"] as const).map(async (key) => [
        key,
        await db.promo.count({ where: whereFor(key, now) }),
      ]),
    ),
  ]);
  const givenBy = new Map(given.map((row) => [row.promoId, row._sum.discountAppliedCentavos ?? 0]));

  return {
    rows: rows.map((promo): PromoRow => ({
      id: promo.id,
      code: promo.code,
      description: promo.description,
      type: promo.type,
      percentBps: promo.percentBps,
      amountCentavos: promo.amountCentavos,
      minSubtotalCentavos: promo.minSubtotalCentavos,
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      usageLimit: promo.usageLimit,
      usageCount: promo.usageCount,
      perCustomerLimit: promo.perCustomerLimit,
      isActive: promo.isActive,
      state: promoState(promo, now),
      discountGivenCentavos: givenBy.get(promo.id) ?? 0,
      values: {
        code: promo.code,
        description: promo.description,
        type: promo.type,
        value:
          promo.type === "PERCENT"
            ? String((promo.percentBps ?? 0) / 100)
            : ((promo.amountCentavos ?? 0) / 100).toFixed(2),
        minSubtotal: promo.minSubtotalCentavos ? (promo.minSubtotalCentavos / 100).toFixed(2) : "",
        startsOn: manilaDay(promo.startsAt),
        endsOn: manilaDay(promo.endsAt),
        usageLimit: promo.usageLimit === null ? "" : String(promo.usageLimit),
        perCustomerLimit: promo.perCustomerLimit === null ? "" : String(promo.perCustomerLimit),
        isActive: promo.isActive,
      },
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PROMO_PAGE_SIZE)),
    counts: Object.fromEntries(counts) as Record<PromoView, number>,
  };
}
