import type { SalesChannel } from "@prisma/client";

/**
 * When an unpaid order falls due (decision D-45).
 *
 * Customers carry no payment terms in this model, so the terms follow the
 * channel: B2B accounts are invoiced on 30 days, the way Philippine corporate
 * buyers pay; everything else is expected within 7 days, which covers a bank
 * transfer clearing or a courier remitting cash on delivery. Aging then uses
 * the same buckets as payables, so both sides of the aging report read alike.
 */
export const RECEIVABLE_TERMS_DAYS: Record<SalesChannel, number> = {
  B2B: 30,
  POS: 7,
  SHOPEE: 7,
  LAZADA: 7,
  TIKTOK: 7,
  FACEBOOK: 7,
  DIRECT: 7,
};

const DAY_MS = 86_400_000;

export function receivableDueDate(placedAt: Date, channel: SalesChannel): Date {
  return new Date(placedAt.getTime() + RECEIVABLE_TERMS_DAYS[channel] * DAY_MS);
}
