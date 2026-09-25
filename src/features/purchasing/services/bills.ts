import type { BillStatus, Prisma } from "@prisma/client";

import { DomainError, NotFoundError } from "@/lib/errors";
import { manilaDayKey, parseManilaDate, startOfManilaDay } from "@/lib/format";
import { parsePesoInput } from "@/lib/money";
import { nextReference } from "@/lib/numbering";
import { assertTransition } from "@/lib/transitions";

import {
  PO_STATUS_LABEL,
  type BillInput,
  type SupplierPaymentInput,
  type VoidBillInput,
} from "../schemas";
import { BILL_TRANSITIONS, dueDateFor, planSupplierPayment, priceBill } from "./bill-rules";
import { appendNote, lockPurchaseOrder } from "./purchase-orders";
import { BILLABLE_STATUSES } from "./purchase-rules";

/**
 * Supplier bills and the payments that settle them: accounts payable.
 *
 * A bill is the supplier's invoice, entered under our own SB number with the
 * supplier's reference beside it. Billing a PO locks the PO row first, so two
 * people entering the same invoice queue, and the second is stopped by the
 * duplicate check. Paying a bill locks the bill row and checks the payment
 * against the balance under that lock, so two payments can never overpay.
 */

type Tx = Prisma.TransactionClient;

type LockedBill = {
  id: string;
  billNumber: string;
  supplierId: string;
  status: BillStatus;
  issueDate: Date;
  totalCentavos: number;
  amountPaidCentavos: number;
  notes: string | null;
};

async function lockBill(tx: Tx, billId: string): Promise<LockedBill> {
  const [row] = await tx.$queryRaw<LockedBill[]>`
    SELECT id, "billNumber", "supplierId", status, "issueDate", "totalCentavos",
           "amountPaidCentavos", notes
    FROM "SupplierBill"
    WHERE id = ${billId}
    FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That bill does not exist.");
  return row;
}

/** A date typed into a form, which may not be after today in Manila. */
function pastOrToday(value: string, label: string, now: Date): Date {
  const date = parseManilaDate(value);
  if (!date) throw new DomainError(`The ${label} is not a valid date.`);
  if (manilaDayKey(date) > manilaDayKey(now)) {
    throw new DomainError(`The ${label} cannot be in the future.`);
  }
  return date;
}

// ------------------------------------------------------------------- create

export type CreatedBill = {
  id: string;
  billNumber: string;
  supplierName: string;
  poNumber: string | null;
  totalCentavos: number;
  dueDate: Date;
};

export async function createSupplierBill(
  tx: Tx,
  input: BillInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<CreatedBill> {
  // The PO, when there is one, is the document lock.
  let poNumber: string | null = null;
  if (input.purchaseOrderId !== "") {
    const po = await lockPurchaseOrder(tx, input.purchaseOrderId);
    if (po.supplierId !== input.supplierId) {
      throw new DomainError(`${po.poNumber} was ordered from a different supplier.`);
    }
    if (!BILLABLE_STATUSES.includes(po.status)) {
      throw new DomainError(
        `${po.poNumber} is ${PO_STATUS_LABEL[po.status]}. Bill it once goods have arrived against it.`,
      );
    }
    poNumber = po.poNumber;
  }

  const supplier = await tx.supplier.findFirst({
    where: { id: input.supplierId, deletedAt: null },
    select: { id: true, name: true, paymentTerms: true },
  });
  if (!supplier) throw new NotFoundError("That supplier does not exist.");

  // The same invoice entered twice is the classic payables mistake.
  const duplicate = await tx.supplierBill.findFirst({
    where: {
      supplierId: supplier.id,
      supplierReference: { equals: input.supplierReference, mode: "insensitive" },
      status: { not: "VOID" },
    },
    select: { billNumber: true },
  });
  if (duplicate) {
    throw new DomainError(
      `${supplier.name} invoice ${input.supplierReference} is already recorded as ${duplicate.billNumber}.`,
    );
  }

  const issueDate = pastOrToday(input.issueDate, "invoice date", now);
  let dueDate = dueDateFor(issueDate, supplier.paymentTerms);
  if (input.dueDate !== "") {
    const parsed = parseManilaDate(input.dueDate);
    if (!parsed) throw new DomainError("The due date is not a valid date.");
    dueDate = parsed;
  }
  if (dueDate < startOfManilaDay(issueDate)) {
    throw new DomainError("A bill cannot fall due before its invoice date.");
  }

  const subtotal = parsePesoInput(input.subtotal);
  if (subtotal === null) throw new DomainError("Enter the amount before VAT.");
  const totals = priceBill(subtotal);

  const billNumber = await nextReference(tx, "SB", now);
  const bill = await tx.supplierBill.create({
    data: {
      billNumber,
      supplierReference: input.supplierReference,
      supplierId: supplier.id,
      purchaseOrderId: input.purchaseOrderId === "" ? null : input.purchaseOrderId,
      status: "OPEN",
      issueDate,
      dueDate,
      ...totals,
      amountPaidCentavos: 0,
      notes: input.notes === "" ? null : input.notes,
    },
    select: { id: true },
  });

  return {
    id: bill.id,
    billNumber,
    supplierName: supplier.name,
    poNumber,
    totalCentavos: totals.totalCentavos,
    dueDate,
  };
}

// ---------------------------------------------------------------------- pay

export type RecordedPayment = {
  id: string;
  billId: string;
  billNumber: string;
  amountCentavos: number;
  statusBefore: BillStatus;
  statusAfter: BillStatus;
  balanceAfterCentavos: number;
};

export async function recordSupplierPayment(
  tx: Tx,
  input: SupplierPaymentInput,
  actor: { id: string },
  { now = new Date() }: { now?: Date } = {},
): Promise<RecordedPayment> {
  const bill = await lockBill(tx, input.billId);

  const amount = parsePesoInput(input.amount);
  if (amount === null) throw new DomainError("Enter the amount paid.");
  const plan = planSupplierPayment(bill, amount);
  assertTransition(BILL_TRANSITIONS, "Bill", bill.status, plan.statusAfter);

  const paidOn = pastOrToday(input.paidOn, "payment date", now);
  if (manilaDayKey(paidOn) < manilaDayKey(bill.issueDate)) {
    throw new DomainError("A payment cannot be dated before the invoice it pays.");
  }
  // Today's payment carries the real time; a back-dated one sits at noon Manila.
  const paidAt =
    manilaDayKey(paidOn) === manilaDayKey(now) ? now : new Date(paidOn.getTime() + 12 * 3_600_000);

  const payment = await tx.supplierPayment.create({
    data: {
      billId: bill.id,
      amountCentavos: amount,
      method: input.method,
      reference: input.reference === "" ? null : input.reference,
      paidAt,
      createdById: actor.id,
    },
    select: { id: true },
  });

  await tx.supplierBill.update({
    where: { id: bill.id },
    data: { amountPaidCentavos: plan.amountPaidAfter, status: plan.statusAfter },
    select: { id: true },
  });

  return {
    id: payment.id,
    billId: bill.id,
    billNumber: bill.billNumber,
    amountCentavos: amount,
    statusBefore: bill.status,
    statusAfter: plan.statusAfter,
    balanceAfterCentavos: bill.totalCentavos - plan.amountPaidAfter,
  };
}

// --------------------------------------------------------------------- void

export async function voidSupplierBill(
  tx: Tx,
  input: VoidBillInput,
): Promise<{ id: string; billNumber: string; from: BillStatus }> {
  const bill = await lockBill(tx, input.billId);
  if (bill.amountPaidCentavos > 0) {
    throw new DomainError(
      `${bill.billNumber} has payments against it, so it cannot be voided. The payment happened.`,
    );
  }
  assertTransition(BILL_TRANSITIONS, "Bill", bill.status, "VOID");

  await tx.supplierBill.update({
    where: { id: bill.id },
    data: { status: "VOID", notes: appendNote(bill.notes, `Voided: ${input.reason}`) },
    select: { id: true },
  });
  return { id: bill.id, billNumber: bill.billNumber, from: bill.status };
}
