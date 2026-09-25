import type { BillStatus, PaymentTerms } from "@prisma/client";

import { DomainError } from "@/lib/errors";
import { manilaDayKey } from "@/lib/format";
import { assertCentavos } from "@/lib/money";
import type { TransitionMap } from "@/lib/transitions";
import { vatOnNet } from "@/lib/vat";

/**
 * Pure payables rules: bill totals, payment settlement, due dates and aging.
 * Shared by the bill form, the services, the aging page and the seed.
 *
 *   DRAFT          -> OPEN, VOID
 *   OPEN           -> PARTIALLY_PAID, PAID, VOID
 *   PARTIALLY_PAID -> PARTIALLY_PAID, PAID
 *   PAID           -> terminal
 *   VOID           -> terminal
 *
 * A bill with money paid against it cannot be voided: the payment happened,
 * and erasing the bill would leave it unexplained.
 */

export const BILL_TRANSITIONS: TransitionMap<BillStatus> = {
  DRAFT: ["OPEN", "VOID"],
  OPEN: ["PARTIALLY_PAID", "PAID", "VOID"],
  PARTIALLY_PAID: ["PARTIALLY_PAID", "PAID"],
  PAID: [],
  VOID: [],
};

/** Bills that still owe money, and so count toward payables. */
export const UNPAID_BILL_STATUSES: readonly BillStatus[] = ["OPEN", "PARTIALLY_PAID"];

export function isPayable(status: BillStatus): boolean {
  return UNPAID_BILL_STATUSES.includes(status);
}

export const TERMS_DAYS: Record<PaymentTerms, number> = {
  COD: 0,
  NET_7: 7,
  NET_15: 15,
  NET_30: 30,
  NET_60: 60,
};

const DAY_MS = 86_400_000;

/** Due date from the supplier's terms, counted in days from the invoice date. */
export function dueDateFor(issueDate: Date, terms: PaymentTerms): Date {
  return new Date(issueDate.getTime() + TERMS_DAYS[terms] * DAY_MS);
}

export type BillTotals = { subtotalCentavos: number; vatCentavos: number; totalCentavos: number };

/** A supplier invoice is VAT-exclusive like the PO it bills (decision D-40). */
export function priceBill(subtotalCentavos: number): BillTotals {
  if (!Number.isSafeInteger(subtotalCentavos) || subtotalCentavos <= 0) {
    throw new DomainError("A bill needs an amount above zero.");
  }
  const vatCentavos = vatOnNet(subtotalCentavos);
  return {
    subtotalCentavos,
    vatCentavos,
    totalCentavos: assertCentavos(subtotalCentavos + vatCentavos),
  };
}

/**
 * What is still unbilled on a PO: goods received at their delivery cost, plus
 * freight, less what earlier bills already cover. The bill form starts here,
 * which is the two-way match between what arrived and what is being claimed.
 */
export function unbilledSubtotal(input: {
  receivedValueCentavos: number;
  shippingCentavos: number;
  billedSubtotalCentavos: number;
}): number {
  return Math.max(
    0,
    input.receivedValueCentavos + input.shippingCentavos - input.billedSubtotalCentavos,
  );
}

export function billBalance(bill: { totalCentavos: number; amountPaidCentavos: number }): number {
  return bill.totalCentavos - bill.amountPaidCentavos;
}

/** The status a bill lands on once this much is paid against it. */
export function billStatusAfterPayment(
  totalCentavos: number,
  amountPaidCentavos: number,
): "PAID" | "PARTIALLY_PAID" | "OPEN" {
  if (amountPaidCentavos >= totalCentavos) return "PAID";
  if (amountPaidCentavos > 0) return "PARTIALLY_PAID";
  return "OPEN";
}

/**
 * Check a payment against the bill it settles. Payments never exceed the
 * balance: an overpayment is a supplier credit, which this app does not keep,
 * so it is refused rather than recorded as a negative balance.
 */
export function planSupplierPayment(
  bill: {
    status: BillStatus;
    billNumber: string;
    totalCentavos: number;
    amountPaidCentavos: number;
  },
  amountCentavos: number,
): { amountPaidAfter: number; statusAfter: "PAID" | "PARTIALLY_PAID" } {
  if (!isPayable(bill.status)) {
    throw new DomainError(
      bill.status === "PAID"
        ? `${bill.billNumber} is already paid in full.`
        : `${bill.billNumber} is ${bill.status.toLowerCase().replace(/_/g, " ")}, so it cannot be paid.`,
    );
  }
  if (!Number.isSafeInteger(amountCentavos) || amountCentavos <= 0) {
    throw new DomainError("Pay an amount above zero.");
  }

  const balance = billBalance(bill);
  if (amountCentavos > balance) {
    throw new DomainError(
      `${bill.billNumber} has ${(balance / 100).toFixed(2)} left to pay, so ${(
        amountCentavos / 100
      ).toFixed(2)} would overpay it.`,
    );
  }

  const amountPaidAfter = assertCentavos(bill.amountPaidCentavos + amountCentavos);
  const statusAfter = billStatusAfterPayment(bill.totalCentavos, amountPaidAfter);
  return { amountPaidAfter, statusAfter: statusAfter === "OPEN" ? "PARTIALLY_PAID" : statusAfter };
}

// --------------------------------------------------------------------- aging

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  current: "Not yet due",
  d1_30: "1 to 30 days",
  d31_60: "31 to 60 days",
  d61_90: "61 to 90 days",
  d90_plus: "Over 90 days",
};

/**
 * Whole Manila calendar days a bill is past due. Due today is zero, not
 * overdue: a bill is late the day after its due date, whatever the hour.
 */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  const due = Date.parse(manilaDayKey(dueDate));
  const today = Date.parse(manilaDayKey(asOf));
  return Math.round((today - due) / DAY_MS);
}

export function agingBucket(dueDate: Date, asOf: Date): AgingBucket {
  const days = daysOverdue(dueDate, asOf);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export type AgingTotals = Record<AgingBucket, number> & { total: number };

export function emptyAging(): AgingTotals {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
}

/** Outstanding balances by bucket. Paid and void bills owe nothing and are skipped. */
export function summariseAging(
  bills: readonly {
    status: BillStatus;
    dueDate: Date;
    totalCentavos: number;
    amountPaidCentavos: number;
  }[],
  asOf: Date,
): AgingTotals {
  const totals = emptyAging();
  for (const bill of bills) {
    if (!isPayable(bill.status)) continue;
    const balance = billBalance(bill);
    if (balance <= 0) continue;
    totals[agingBucket(bill.dueDate, asOf)] += balance;
    totals.total += balance;
  }
  return totals;
}
