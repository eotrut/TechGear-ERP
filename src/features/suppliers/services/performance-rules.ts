import { manilaDayKey } from "@/lib/format";

/**
 * Supplier performance, measured from deliveries rather than typed in.
 *
 *   On-time rate  deliveries that arrived by the PO's expected date, counted in
 *                 Manila calendar days, over deliveries with an expected date.
 *   Defect rate   units rejected at the dock over units that arrived.
 *   Lead time     average days from sending the PO to each delivery.
 *
 * Each goods received note is one delivery, so a PO that arrives in two lots
 * is judged twice: a punctual first half does not excuse a late balance.
 * Rates are basis points, like every percentage in the app. A supplier with
 * no deliveries has no rate, which is different from a rate of zero.
 */

export type Delivery = {
  receivedAt: Date;
  expectedDate: Date | null;
  sentAt: Date | null;
  qtyReceived: number;
  qtyRejected: number;
};

export type SupplierPerformance = {
  deliveries: number;
  onTimeDeliveries: number;
  onTimeRateBps: number | null;
  unitsArrived: number;
  unitsRejected: number;
  defectRateBps: number | null;
  averageLeadDays: number | null;
};

const DAY_MS = 86_400_000;

function ratioBps(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part * 10_000) / whole);
}

export function isOnTime(delivery: Pick<Delivery, "receivedAt" | "expectedDate">): boolean | null {
  if (!delivery.expectedDate) return null;
  return manilaDayKey(delivery.receivedAt) <= manilaDayKey(delivery.expectedDate);
}

export function supplierPerformance(deliveries: readonly Delivery[]): SupplierPerformance {
  let dated = 0;
  let onTime = 0;
  let arrived = 0;
  let rejected = 0;
  let leadDaysTotal = 0;
  let leadSamples = 0;

  for (const delivery of deliveries) {
    const punctual = isOnTime(delivery);
    if (punctual !== null) {
      dated += 1;
      if (punctual) onTime += 1;
    }

    arrived += delivery.qtyReceived + delivery.qtyRejected;
    rejected += delivery.qtyRejected;

    if (delivery.sentAt) {
      const days =
        (Date.parse(manilaDayKey(delivery.receivedAt)) -
          Date.parse(manilaDayKey(delivery.sentAt))) /
        DAY_MS;
      if (days >= 0) {
        leadDaysTotal += days;
        leadSamples += 1;
      }
    }
  }

  return {
    deliveries: deliveries.length,
    onTimeDeliveries: onTime,
    onTimeRateBps: ratioBps(onTime, dated),
    unitsArrived: arrived,
    unitsRejected: rejected,
    defectRateBps: ratioBps(rejected, arrived),
    averageLeadDays: leadSamples > 0 ? Math.round((leadDaysTotal / leadSamples) * 10) / 10 : null,
  };
}

/** Rates as the directory shows them: one decimal place, or a dash-free "none". */
export function formatRate(bps: number | null): string {
  return bps === null ? "none" : `${(bps / 100).toFixed(1)}%`;
}
