"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { runStockTransaction } from "@/features/inventory/services/stock";
import { recordAudit, type AuditChanges } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { authorizeAction } from "@/lib/rbac/guard";

import {
  purchasableByIds,
  reorderPicks,
  searchPurchasable,
  type PurchasablePick,
} from "../queries";
import {
  billSchema,
  cancelPoSchema,
  closePoSchema,
  PO_STATUS_LABEL,
  poIdSchema,
  purchasablePositionsSchema,
  purchasableSearchSchema,
  purchaseOrderSchema,
  receivePoSchema,
  reorderLinesSchema,
  supplierPaymentSchema,
  voidBillSchema,
  BILL_STATUS_LABEL,
} from "../schemas";
import { createSupplierBill, recordSupplierPayment, voidSupplierBill } from "../services/bills";
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  savePurchaseOrder,
  sendPurchaseOrder,
} from "../services/purchase-orders";
import { receivePurchaseOrder } from "../services/receiving";

/**
 * Purchasing mutations. Each one authorizes against the live user, validates
 * with the schema its form uses, runs the service in one transaction with its
 * audit entry, and revalidates. A broken rule (over-receipt, a sent PO being
 * edited, a bill being overpaid) comes back as a DomainError written for the
 * person who pressed the button.
 */

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Purchasing action failed", error);
  return { ok: false, error: fallback };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

function revalidatePurchasing(...extra: string[]) {
  for (const path of ["/purchasing", "/purchasing/bills", "/suppliers", ...extra]) {
    revalidatePath(path);
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// ------------------------------------------------------------ purchase orders

export async function savePurchaseOrderAction(
  input: unknown,
): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("purchasing.manage");
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  // Sending commits money, which is its own grant on top of drafting.
  if (parsed.data.intent === "send") await authorizeAction("purchasing.send");

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const saved = await savePurchaseOrder(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: saved.created ? "CREATE" : "UPDATE",
        entityType: "PurchaseOrder",
        entityId: saved.id,
        summary: `${saved.created ? "Raised" : "Updated"} ${saved.poNumber}${
          saved.status === "SENT" ? " and sent it" : ""
        }: ${plural(saved.units, "unit")} on ${plural(saved.lines, "line")}, ${formatPeso(
          saved.totalCentavos,
        )}.`,
        changes: saved.created
          ? { status: { from: null, to: saved.status } }
          : saved.status === "SENT"
            ? { status: { from: "DRAFT", to: "SENT" } }
            : undefined,
        tx,
      });
      return saved;
    });

    revalidatePurchasing(`/purchasing/${result.id}`, "/inventory/alerts");
    return {
      ok: true,
      id: result.id,
      message:
        result.status === "SENT"
          ? `${result.poNumber} sent to the supplier.`
          : `${result.poNumber} saved as a draft.`,
    };
  } catch (error) {
    return fail(error, "Something went wrong saving that purchase order. Nothing was saved.");
  }
}

export async function sendPurchaseOrderAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("purchasing.send");
  const parsed = poIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const sent = await sendPurchaseOrder(tx, parsed.data.purchaseOrderId, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "PurchaseOrder",
        entityId: sent.id,
        summary: `Sent ${sent.poNumber} to the supplier.`,
        changes: { status: { from: "DRAFT", to: "SENT" } },
        tx,
      });
      return sent;
    });
    revalidatePurchasing(`/purchasing/${result.id}`, "/inventory/alerts");
    return { ok: true, message: `${result.poNumber} sent. It now counts toward reorder cover.` };
  } catch (error) {
    return fail(error, "Something went wrong sending that purchase order.");
  }
}

export async function cancelPurchaseOrderAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("purchasing.close");
  const parsed = cancelPoSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const cancelled = await cancelPurchaseOrder(tx, parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "PurchaseOrder",
        entityId: cancelled.id,
        summary: `Cancelled ${cancelled.poNumber}: ${parsed.data.reason}`,
        changes: { status: { from: cancelled.from, to: "CANCELLED" } },
        tx,
      });
      return cancelled;
    });
    revalidatePurchasing(`/purchasing/${result.id}`, "/inventory/alerts");
    return { ok: true, message: `${result.poNumber} cancelled.` };
  } catch (error) {
    return fail(error, "Something went wrong cancelling that purchase order.");
  }
}

export async function closePurchaseOrderAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("purchasing.close");
  const parsed = closePoSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const closed = await closePurchaseOrder(tx, parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "PurchaseOrder",
        entityId: closed.id,
        summary:
          closed.shortUnits > 0
            ? `Closed ${closed.poNumber} short by ${plural(closed.shortUnits, "unit")}: ${parsed.data.reason}`
            : `Closed ${closed.poNumber}.`,
        changes: { status: { from: closed.from, to: "CLOSED" } },
        tx,
      });
      return closed;
    });
    revalidatePurchasing(`/purchasing/${result.id}`, "/inventory/alerts");
    return {
      ok: true,
      message:
        result.shortUnits > 0
          ? `${result.poNumber} closed. The ${plural(result.shortUnits, "unit")} still owed are no longer expected.`
          : `${result.poNumber} closed.`,
    };
  } catch (error) {
    return fail(error, "Something went wrong closing that purchase order.");
  }
}

// ------------------------------------------------------------------ receiving

export async function receivePurchaseOrderAction(
  input: unknown,
): Promise<ActionResult & { receiptId?: string }> {
  const { user } = await authorizeAction("purchasing.receive");
  const parsed = receivePoSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const receipt = await receivePurchaseOrder(tx, parsed.data, user);

      // Stock and average cost per SKU, before and after, so the audit trail
      // shows exactly what the delivery did to the books.
      const changes: AuditChanges = {};
      if (receipt.statusAfter !== receipt.statusBefore) {
        changes.status = { from: receipt.statusBefore, to: receipt.statusAfter };
      }
      for (const line of receipt.lines) {
        if (line.qtyReceived === 0) continue;
        changes[`${line.sku} on hand at ${receipt.warehouseCode}`] = {
          from: line.balanceAfter - line.qtyReceived,
          to: line.balanceAfter,
        };
        if (line.avgCostAfterCentavos !== line.avgCostBeforeCentavos) {
          changes[`${line.sku} average cost`] = {
            from: formatAmount(line.avgCostBeforeCentavos),
            to: formatAmount(line.avgCostAfterCentavos),
          };
        }
      }

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "PurchaseReceipt",
        entityId: receipt.id,
        summary: `Received ${receipt.reference} against ${receipt.poNumber} into ${receipt.warehouseCode}: ${plural(
          receipt.acceptedUnits,
          "unit",
        )} in${receipt.rejectedUnits > 0 ? `, ${receipt.rejectedUnits} rejected` : ""}, ${formatPeso(
          receipt.valueCentavos,
        )} at cost.`,
        changes,
        tx,
      });
      return receipt;
    });

    revalidatePurchasing(
      `/purchasing/${result.purchaseOrderId}`,
      "/inventory",
      "/inventory/ledger",
      "/inventory/alerts",
      "/products",
    );
    return {
      ok: true,
      receiptId: result.id,
      message: `${result.reference} booked: ${plural(result.acceptedUnits, "unit")} into ${
        result.warehouseCode
      }. ${result.poNumber} is ${PO_STATUS_LABEL[result.statusAfter]}.`,
    };
  } catch (error) {
    return fail(error, "Something went wrong receiving that delivery. No stock was moved.");
  }
}

// ------------------------------------------------------------------- lookups

type PickResult = { ok: true; results: PurchasablePick[] } | { ok: false; error: string };

/** Variant search for PO lines. A read, but typed live, so it is authorized like an action. */
export async function searchPurchasableAction(input: unknown): Promise<PickResult> {
  await authorizeAction("purchasing.manage");
  const parsed = purchasableSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Search could not be read." };
  return { ok: true, results: await searchPurchasable(parsed.data.query, parsed.data.warehouseId) };
}

export async function purchasablePositionsAction(input: unknown): Promise<PickResult> {
  await authorizeAction("purchasing.manage");
  const parsed = purchasablePositionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Positions could not be read." };
  return { ok: true, results: await purchasableByIds(parsed.data.ids, parsed.data.warehouseId) };
}

/** Reorder suggestions for a supplier, as lines ready to drop onto the form. */
export async function reorderLinesAction(
  input: unknown,
): Promise<
  { ok: true; lines: { pick: PurchasablePick; qty: number }[] } | { ok: false; error: string }
> {
  await authorizeAction("purchasing.manage");
  const parsed = reorderLinesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Suggestions could not be read." };
  return {
    ok: true,
    lines: await reorderPicks(parsed.data.supplierId || null, parsed.data.warehouseId),
  };
}

// ---------------------------------------------------------------------- bills

export async function createBillAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("bills.manage");
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const bill = await createSupplierBill(tx, parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "SupplierBill",
        entityId: bill.id,
        summary: `Recorded ${bill.billNumber}, ${bill.supplierName} invoice ${parsed.data.supplierReference}${
          bill.poNumber ? ` against ${bill.poNumber}` : ""
        }: ${formatPeso(bill.totalCentavos)} due ${formatDate(bill.dueDate)}.`,
        changes: { status: { from: null, to: "OPEN" } },
        tx,
      });
      return bill;
    });

    revalidatePurchasing(`/purchasing/bills/${result.id}`);
    return {
      ok: true,
      id: result.id,
      message: `${result.billNumber} recorded, due ${formatDate(result.dueDate)}.`,
    };
  } catch (error) {
    return fail(error, "Something went wrong recording that bill. Nothing was saved.");
  }
}

export async function recordSupplierPaymentAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("bills.manage");
  const parsed = supplierPaymentSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const payment = await recordSupplierPayment(tx, parsed.data, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "SupplierPayment",
        entityId: payment.id,
        summary: `Paid ${formatPeso(payment.amountCentavos)} on ${payment.billNumber}${
          payment.balanceAfterCentavos > 0
            ? `, ${formatPeso(payment.balanceAfterCentavos)} left`
            : ", now settled"
        }.`,
        changes:
          payment.statusAfter !== payment.statusBefore
            ? { status: { from: payment.statusBefore, to: payment.statusAfter } }
            : undefined,
        tx,
      });
      return payment;
    });

    revalidatePurchasing(`/purchasing/bills/${result.billId}`);
    return {
      ok: true,
      message:
        result.statusAfter === "PAID"
          ? `${result.billNumber} is paid in full.`
          : `Payment recorded. ${formatPeso(result.balanceAfterCentavos)} left on ${result.billNumber}.`,
    };
  } catch (error) {
    return fail(error, "Something went wrong recording that payment. Nothing was saved.");
  }
}

export async function voidBillAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("bills.void");
  const parsed = voidBillSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const voided = await voidSupplierBill(tx, parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "SupplierBill",
        entityId: voided.id,
        summary: `Voided ${voided.billNumber}: ${parsed.data.reason}`,
        changes: { status: { from: BILL_STATUS_LABEL[voided.from], to: BILL_STATUS_LABEL.VOID } },
        tx,
      });
      return voided;
    });
    revalidatePurchasing(`/purchasing/bills/${result.id}`);
    return { ok: true, message: `${result.billNumber} voided.` };
  } catch (error) {
    return fail(error, "Something went wrong voiding that bill.");
  }
}
