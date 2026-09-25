import type { Prisma, PromoType } from "@prisma/client";

import { percentToBps } from "@/features/orders/services/pricing";
import { DomainError, NotFoundError } from "@/lib/errors";
import { parsePesoInput } from "@/lib/money";

import type { PromoFormValues } from "../schemas";

/**
 * Promo codes. The code is the promo's identity on every order that used it,
 * so it cannot be renamed once redeemed, and a promo with redemptions is
 * deactivated rather than deleted.
 */

type Tx = Prisma.TransactionClient;

const MANILA_OFFSET_MS = 8 * 3_600_000;

/** A promo runs from the start of its first Manila day to the end of its last. */
function manilaDayStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - MANILA_OFFSET_MS);
}

function manilaDayEnd(day: string): Date {
  return new Date(Date.parse(`${day}T23:59:59.999Z`) - MANILA_OFFSET_MS);
}

export type PromoData = {
  code: string;
  description: string;
  type: PromoType;
  percentBps: number | null;
  amountCentavos: number | null;
  minSubtotalCentavos: number;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  isActive: boolean;
};

/** Form values to the columns, exactly: percents to basis points, pesos to centavos. */
export function promoDataFrom(values: PromoFormValues): PromoData {
  const percentBps = values.type === "PERCENT" ? percentToBps(values.value) : null;
  const amountCentavos = values.type === "FIXED" ? parsePesoInput(values.value) : null;
  if (values.type === "PERCENT" && (percentBps === null || percentBps <= 0)) {
    throw new DomainError("Enter a percentage above 0 and below 100.");
  }
  if (values.type === "FIXED" && (amountCentavos === null || amountCentavos <= 0)) {
    throw new DomainError("Enter a peso amount above zero.");
  }
  return {
    code: values.code,
    description: values.description,
    type: values.type,
    percentBps,
    amountCentavos,
    minSubtotalCentavos: values.minSubtotal === "" ? 0 : (parsePesoInput(values.minSubtotal) ?? 0),
    startsAt: manilaDayStart(values.startsOn),
    endsAt: manilaDayEnd(values.endsOn),
    usageLimit: values.usageLimit === "" ? null : Number(values.usageLimit),
    perCustomerLimit: values.perCustomerLimit === "" ? null : Number(values.perCustomerLimit),
    isActive: values.isActive,
  };
}

export async function createPromo(tx: Tx, values: PromoFormValues) {
  const data = promoDataFrom(values);
  const clash = await tx.promo.findUnique({ where: { code: data.code }, select: { id: true } });
  if (clash) throw new DomainError(`${data.code} already exists. Codes are never reused.`);
  return tx.promo.create({ data, select: { id: true, code: true } });
}

export async function updatePromo(tx: Tx, promoId: string, values: PromoFormValues) {
  const [current] = await tx.$queryRaw<{ id: string; code: string; usageCount: number }[]>`
    SELECT id, code, "usageCount" FROM "Promo" WHERE id = ${promoId} FOR UPDATE
  `;
  if (!current) throw new NotFoundError("That promo does not exist.");

  const data = promoDataFrom(values);
  if (data.code !== current.code) {
    if (current.usageCount > 0) {
      throw new DomainError(
        `${current.code} is on ${current.usageCount} order${current.usageCount === 1 ? "" : "s"}, so its code cannot change. Create a new promo instead.`,
      );
    }
    const clash = await tx.promo.findUnique({ where: { code: data.code }, select: { id: true } });
    if (clash) throw new DomainError(`${data.code} already exists.`);
  }
  if (data.usageLimit !== null && data.usageLimit < current.usageCount) {
    throw new DomainError(
      `${current.code} has already been used ${current.usageCount} times, so the limit cannot go below that.`,
    );
  }

  const before = await tx.promo.findUniqueOrThrow({ where: { id: promoId } });
  const after = await tx.promo.update({ where: { id: promoId }, data });
  return { before, after };
}

export async function setPromoActive(tx: Tx, promoId: string, isActive: boolean) {
  const promo = await tx.promo.findUnique({
    where: { id: promoId },
    select: { id: true, code: true, isActive: true },
  });
  if (!promo) throw new NotFoundError("That promo does not exist.");
  await tx.promo.update({ where: { id: promoId }, data: { isActive }, select: { id: true } });
  return promo;
}
