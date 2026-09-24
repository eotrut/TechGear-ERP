import type { CustomerSegment, OrderStatus } from "@prisma/client";

/**
 * Automatic customer segments, decision D-9.
 *
 *   NEW      no realised order yet, or exactly one recent one
 *   REPEAT   two or more realised orders
 *   VIP      twenty or more orders, or lifetime value in the top decile
 *   DORMANT  has bought before, but not in the last 180 days
 *
 * Dormant is checked first: a big spender who stopped buying a year ago is a
 * win-back target, not a VIP. The rules live in one pure function so the seed,
 * the refresh action, `npm run db:segments` and the order-completion hook can
 * never disagree about who is what.
 *
 * Segments are stored on Customer rather than computed on read, because the
 * directory filters and counts by them on every page load. Something has to
 * write them, and there are two triggers: an order being completed changes a
 * customer's history (refreshCustomerRollup, called from the order service),
 * and time passing makes a customer dormant without any event at all
 * (recomputeSegments, from the script or the refresh button).
 */

export const SEGMENTS = [
  "VIP",
  "REPEAT",
  "NEW",
  "DORMANT",
] as const satisfies readonly CustomerSegment[];

export const SEGMENT_RULES = {
  dormantAfterDays: 180,
  /**
   * The plan said ten. Against a year of real order history ten orders tagged a
   * quarter of all customers as VIP, which is not a segment anyone can act on;
   * twenty, about twice a month, keeps VIP to roughly the top tenth.
   */
  vipOrderCount: 20,
  /** Share of buying customers, by lifetime value, that counts as VIP. */
  vipShare: 0.1,
  repeatOrderCount: 2,
} as const;

/**
 * Orders that count towards a customer's history: money has changed hands and
 * has not all gone back. Drafts, pending, cancelled and fully refunded orders
 * say nothing about what somebody is worth.
 */
export const REALISED_ORDER_STATUSES = [
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
] as const satisfies readonly OrderStatus[];

export type CustomerStats = {
  orderCount: number;
  lifetimeValueCentavos: number;
  lastOrderAt: Date | null;
};

const DAY_MS = 86_400_000;

/**
 * The lifetime value a customer must reach to be VIP: the smallest value in
 * the top tenth of customers who have bought anything. Infinity when nobody
 * has, so an empty database has no VIPs rather than everyone being one.
 */
export function vipThreshold(lifetimeValues: readonly number[]): number {
  const buying = lifetimeValues.filter((value) => value > 0).sort((a, b) => b - a);
  if (buying.length === 0) return Number.POSITIVE_INFINITY;
  const cut = Math.max(0, Math.ceil(buying.length * SEGMENT_RULES.vipShare) - 1);
  return buying[cut] ?? Number.POSITIVE_INFINITY;
}

export function classifySegment(
  stats: CustomerStats,
  context: { now: Date; vipThresholdCentavos: number },
): CustomerSegment {
  if (stats.orderCount === 0 || !stats.lastOrderAt) return "NEW";

  const daysSinceLast = (context.now.getTime() - stats.lastOrderAt.getTime()) / DAY_MS;
  if (daysSinceLast > SEGMENT_RULES.dormantAfterDays) return "DORMANT";

  if (
    stats.orderCount >= SEGMENT_RULES.vipOrderCount ||
    (stats.lifetimeValueCentavos > 0 && stats.lifetimeValueCentavos >= context.vipThresholdCentavos)
  ) {
    return "VIP";
  }

  if (stats.orderCount >= SEGMENT_RULES.repeatOrderCount) return "REPEAT";
  return "NEW";
}

/** One-line explanation of each segment, for the directory legend and tooltips. */
export const SEGMENT_META: Record<CustomerSegment, { label: string; rule: string }> = {
  VIP: {
    label: "VIP",
    rule: `${SEGMENT_RULES.vipOrderCount}+ orders, or lifetime value in the top ${
      SEGMENT_RULES.vipShare * 100
    }% of buyers`,
  },
  REPEAT: {
    label: "Repeat",
    rule: `${SEGMENT_RULES.repeatOrderCount}+ orders, last one within ${SEGMENT_RULES.dormantAfterDays} days`,
  },
  NEW: { label: "New", rule: "No orders yet, or a single recent one" },
  DORMANT: {
    label: "Dormant",
    rule: `Has bought before, nothing in the last ${SEGMENT_RULES.dormantAfterDays} days`,
  },
};
