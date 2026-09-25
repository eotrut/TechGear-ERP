"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ActionResult } from "@/features/auth/actions";
import { runStockTransaction } from "@/features/inventory/services/stock";
import { checkPromo, type PromoRecord } from "@/features/promos/services/promo-rules";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { formatPeso, parsePesoInput } from "@/lib/money";
import { authorizeAction, authorizeRecord } from "@/lib/rbac/guard";

import {
  customerAddresses,
  searchSellable,
  sellableByIds,
  type AddressOption,
  type SellablePick,
} from "../queries";
import {
  cancelOrderSchema,
  lookupSchema,
  ORDER_STATUS_LABEL,
  orderFormSchema,
  orderTransitionSchema,
  payOrderSchema,
  PAYMENT_METHOD_LABEL,
  refundOrderSchema,
  updateOrderSchema,
  type OrderFormValues,
} from "../schemas";
import { discountCapFor, draftFromForm, tendersFrom } from "../services/form";
import { cancelNeedsRefund, TRANSITION_PERMISSION } from "../services/order-rules";
import {
  advanceOrder,
  cancelOrder,
  createOrder,
  lockOrder,
  payOrder,
  placeOrder,
  recordRefund,
  updateDraftOrder,
} from "../services/orders";

/**
 * Order mutations. Each one authorizes against the live user record, parses
 * with the schema the form uses, runs the order service in one stock
 * transaction together with its audit entry, and revalidates. A business rule
 * that fails (not enough stock, a payment that does not add up, a move the
 * status machine forbids) comes back as a DomainError whose message is
 * written for the person who pressed the button.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Order action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

function revalidateOrders(orderId?: string) {
  for (const path of [
    "/orders",
    ...(orderId ? [`/orders/${orderId}`] : []),
    "/inventory",
    "/inventory/ledger",
    "/products",
    "/customers",
    "/promos",
    "/dashboard",
  ]) {
    revalidatePath(path);
  }
}

/** Promo and payment ride on the same form, so they need their own permissions too. */
async function authorizeForm(values: OrderFormValues) {
  const granted = await authorizeAction("orders.create");
  if (values.promoCode.trim() !== "") await authorizeAction("orders.applyPromo");
  if (values.intent === "paid") await authorizeAction("orders.recordPayment");
  return granted;
}

// ------------------------------------------------------------------- create

export async function createOrderAction(
  input: unknown,
): Promise<ActionResult & { id?: string; orderNumber?: string }> {
  await authorizeAction("orders.create");
  const parsed = orderFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { user } = await authorizeForm(parsed.data);

  try {
    const draft = draftFromForm(parsed.data);
    const tenders = tendersFrom(parsed.data.tenders);

    const result = await runStockTransaction(db, async (tx) => {
      const order = await createOrder(tx, draft, user, {
        intent: parsed.data.intent,
        tenders,
        discountCapBps: discountCapFor(user.role),
      });
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Order",
        entityId: order.id,
        summary: `Created ${order.orderNumber} as ${ORDER_STATUS_LABEL[order.status].toLowerCase()}, ${formatPeso(order.totalCentavos)} on ${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"}.`,
        changes: { status: { from: null, to: order.status } },
        tx,
      });
      return order;
    });

    revalidateOrders(result.id);
    const change =
      result.changeCentavos > 0 ? ` Change due: ${formatPeso(result.changeCentavos)}.` : "";
    return {
      ok: true,
      id: result.id,
      orderNumber: result.orderNumber,
      message:
        result.status === "DRAFT"
          ? `${result.orderNumber} saved as a draft. No stock is held until it is placed.`
          : result.status === "PENDING"
            ? `${result.orderNumber} placed. Stock is reserved until it is paid.`
            : `${result.orderNumber} placed and paid.${change}`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function updateOrderAction(input: unknown): Promise<ActionResult & { id?: string }> {
  await authorizeAction("orders.create");
  const parsed = updateOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { user } = await authorizeForm(parsed.data.values);

  try {
    const draft = draftFromForm(parsed.data.values);
    const tenders = tendersFrom(parsed.data.values.tenders);

    const result = await runStockTransaction(db, async (tx) => {
      const order = await updateDraftOrder(tx, parsed.data.orderId, draft, user, {
        intent: parsed.data.values.intent,
        tenders,
        discountCapBps: discountCapFor(user.role),
      });
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: order.status === "DRAFT" ? "UPDATE" : "STATUS_CHANGE",
        entityType: "Order",
        entityId: order.id,
        summary:
          order.status === "DRAFT"
            ? `Edited draft ${order.orderNumber}: ${formatPeso(order.totalCentavos)} on ${draft.lines.length} lines.`
            : `Edited and placed ${order.orderNumber} (${ORDER_STATUS_LABEL[order.status].toLowerCase()}).`,
        changes:
          order.status === "DRAFT" ? undefined : { status: { from: "DRAFT", to: order.status } },
        tx,
      });
      return order;
    });

    revalidateOrders(result.id);
    return { ok: true, id: result.id, message: `${result.orderNumber} saved.` };
  } catch (error) {
    return fail(error);
  }
}

// ---------------------------------------------------------------- lifecycle

export async function transitionOrderAction(input: unknown): Promise<ActionResult> {
  const parsed = orderTransitionSchema.safeParse(input);
  if (!parsed.success) {
    await authorizeAction("orders.view");
    return invalid(parsed.error.issues);
  }
  const { orderId, to, note } = parsed.data;
  const { user } = await authorizeAction(TRANSITION_PERMISSION[to]);

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const { orderNumber, from } =
        to === "PENDING"
          ? await (async () => {
              const order = await lockOrder(tx, orderId);
              await placeOrder(tx, orderId, user);
              return { orderNumber: order.orderNumber, from: order.status };
            })()
          : await advanceOrder(tx, orderId, to, user, note);

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "Order",
        entityId: orderId,
        summary: `Moved ${orderNumber} from ${ORDER_STATUS_LABEL[from].toLowerCase()} to ${ORDER_STATUS_LABEL[to].toLowerCase()}.${note ? ` ${note}` : ""}`,
        changes: { status: { from, to } },
        tx,
      });
      return orderNumber;
    });

    revalidateOrders(orderId);
    return { ok: true, message: `${result} is now ${ORDER_STATUS_LABEL[to].toLowerCase()}.` };
  } catch (error) {
    return fail(error);
  }
}

export async function payOrderAction(
  input: unknown,
): Promise<ActionResult & { changeCentavos?: number }> {
  const { user } = await authorizeAction("orders.recordPayment");
  const parsed = payOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const tenders = tendersFrom(parsed.data.tenders);
    const result = await runStockTransaction(db, async (tx) => {
      const order = await lockOrder(tx, parsed.data.orderId);
      const paid = await payOrder(tx, order.id, tenders, user);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "Order",
        entityId: order.id,
        summary: `Recorded payment on ${order.orderNumber}: ${tenders
          .map(
            (tender) =>
              `${PAYMENT_METHOD_LABEL[tender.method]} ${formatPeso(tender.amountCentavos)}`,
          )
          .join(", ")}.`,
        changes: {
          status: { from: order.status, to: "PAID" },
          amountPaidCentavos: { from: order.amountPaidCentavos, to: order.totalCentavos },
        },
        tx,
      });
      return { orderNumber: order.orderNumber, ...paid };
    });

    revalidateOrders(parsed.data.orderId);
    return {
      ok: true,
      changeCentavos: result.changeCentavos,
      message:
        result.changeCentavos > 0
          ? `${result.orderNumber} paid. Give ${formatPeso(result.changeCentavos)} change.`
          : `${result.orderNumber} paid. Stock has left the shelf.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function cancelOrderAction(input: unknown): Promise<ActionResult> {
  await authorizeAction("orders.cancel");
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  const owner = await db.order.findUnique({
    where: { id: parsed.data.orderId },
    select: { salespersonId: true, createdById: true, status: true },
  });
  if (!owner) return { ok: false, error: "That order does not exist." };

  // Sales may cancel their own orders; cancelling after payment is a refund.
  const { user } = await authorizeRecord("orders.cancel", owner.salespersonId ?? owner.createdById);
  if (cancelNeedsRefund(owner.status)) await authorizeAction("orders.refund");

  try {
    const result = await runStockTransaction(db, async (tx) => {
      const cancelled = await cancelOrder(
        tx,
        {
          orderId: parsed.data.orderId,
          reason: parsed.data.reason,
          refundMethod: parsed.data.refundMethod,
          refundReference: parsed.data.refundReference,
        },
        user,
      );
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "STATUS_CHANGE",
        entityType: "Order",
        entityId: parsed.data.orderId,
        summary: `Cancelled ${cancelled.orderNumber}: ${parsed.data.reason}${
          cancelled.refundedCentavos > 0
            ? ` Refunded ${formatPeso(cancelled.refundedCentavos)}.`
            : ""
        }`,
        changes: { status: { from: cancelled.from, to: "CANCELLED" } },
        tx,
      });
      return cancelled;
    });

    revalidateOrders(parsed.data.orderId);
    return {
      ok: true,
      message:
        result.refundedCentavos > 0
          ? `${result.orderNumber} cancelled. ${formatPeso(result.refundedCentavos)} refunded and ${result.restockedUnits} units back on the shelf.`
          : `${result.orderNumber} cancelled.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function refundOrderAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("orders.refund");
  const parsed = refundOrderSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const amount = parsePesoInput(parsed.data.amount);
    if (!amount || amount <= 0) return { ok: false, error: "Enter the amount to refund." };

    const result = await runStockTransaction(db, async (tx) => {
      const refund = await recordRefund(
        tx,
        {
          orderId: parsed.data.orderId,
          amountCentavos: amount,
          method: parsed.data.method,
          reason: parsed.data.reason,
          reference: parsed.data.reference,
        },
        user,
      );
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: refund.statusChange ? "STATUS_CHANGE" : "UPDATE",
        entityType: "Order",
        entityId: parsed.data.orderId,
        summary: `Refunded ${formatPeso(amount)} on ${refund.orderNumber} by ${PAYMENT_METHOD_LABEL[parsed.data.method]}: ${parsed.data.reason}`,
        changes: refund.statusChange
          ? { status: { from: refund.statusChange.from, to: "REFUNDED" } }
          : undefined,
        tx,
      });
      return refund;
    });

    revalidateOrders(parsed.data.orderId);
    return {
      ok: true,
      message: result.statusChange
        ? `${formatPeso(amount)} refunded. ${result.orderNumber} is now fully refunded.`
        : `${formatPeso(amount)} refunded on ${result.orderNumber}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------ lookups

export async function searchSellableAction(
  input: unknown,
): Promise<{ ok: true; results: SellablePick[] } | { ok: false; error: string }> {
  await authorizeAction("orders.create");
  const parsed = lookupSchema.safeParse(input);
  if (!parsed.success || !parsed.data.warehouseId) {
    return { ok: false, error: "Choose a warehouse first." };
  }
  return { ok: true, results: await searchSellable(parsed.data.query, parsed.data.warehouseId) };
}

const positionsSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).max(50),
  warehouseId: z.string().trim().min(1).max(64),
});

/** Availability for lines already on the form, after the warehouse changes. */
export async function sellablePositionsAction(
  input: unknown,
): Promise<{ ok: true; results: SellablePick[] } | { ok: false; error: string }> {
  await authorizeAction("orders.create");
  const parsed = positionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a warehouse first." };
  return { ok: true, results: await sellableByIds(parsed.data.ids, parsed.data.warehouseId) };
}

export async function customerAddressesAction(
  input: unknown,
): Promise<{ ok: true; results: AddressOption[] } | { ok: false; error: string }> {
  await authorizeAction("orders.create");
  const parsed = z.object({ customerId: z.string().trim().min(1).max(64) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing customer." };
  return { ok: true, results: await customerAddresses(parsed.data.customerId) };
}

const promoCheckSchema = z.object({
  code: z.string().trim().min(1).max(24),
  customerId: z.string().trim().max(64),
  merchandiseCentavos: z.number().int().min(0),
});

export type PromoPreview =
  | {
      ok: true;
      code: string;
      description: string;
      type: PromoRecord["type"];
      percentBps: number | null;
      amountCentavos: number | null;
      minSubtotalCentavos: number;
    }
  | { ok: false; error: string };

/**
 * A preview for the form, so a person sees the promo's effect before saving.
 * The order service checks it again under the promo's row lock; this answer
 * is advice, not a reservation.
 */
export async function checkPromoAction(input: unknown): Promise<PromoPreview> {
  await authorizeAction("orders.applyPromo");
  const parsed = promoCheckSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a promo code." };

  const code = parsed.data.code.toUpperCase();
  const promo = await db.promo.findUnique({ where: { code } });
  if (!promo) return { ok: false, error: `There is no promo with the code ${code}.` };

  const customerId = parsed.data.customerId || null;
  const customerRedemptions = customerId
    ? await db.promoRedemption.count({ where: { promoId: promo.id, customerId } })
    : 0;
  const check = checkPromo(promo, {
    now: new Date(),
    merchandiseCentavos: parsed.data.merchandiseCentavos,
    customerId,
    customerRedemptions,
  });
  if (!check.ok) return { ok: false, error: check.reason };
  return {
    ok: true,
    code: promo.code,
    description: promo.description,
    type: promo.type,
    percentBps: promo.percentBps,
    amountCentavos: promo.amountCentavos,
    minSubtotalCentavos: promo.minSubtotalCentavos,
  };
}
