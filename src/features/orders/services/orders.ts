import type {
  OrderStatus,
  PaymentMethod,
  Prisma,
  PromoType,
  SalesChannel,
  StockReason,
} from "@prisma/client";

import { refreshCustomerRollup } from "@/features/customers/services/segments";
import {
  applyMovement,
  lockVariants,
  releaseStock,
  reserveStock,
} from "@/features/inventory/services/stock";
import { assertPromoUsable } from "@/features/promos/services/promo-rules";
import { DomainError, InvalidTransitionError, NotFoundError } from "@/lib/errors";
import { nextReference } from "@/lib/numbering";
import { assertTransition, canTransition } from "@/lib/transitions";

import { ORDER_STATUS_LABEL } from "../schemas";
import {
  assertRefundable,
  cancelNeedsRefund,
  hasShipped,
  holdsReservation,
  initialStatusFor,
  isFullyRefunded,
  ORDER_TRANSITIONS,
  settleTenders,
  type Tender,
} from "./order-rules";
import {
  assertManualDiscountAllowed,
  priceOrder,
  type ManualDiscount,
  type OrderPricing,
} from "./pricing";

/**
 * The order service. Every function takes the transaction client, so one
 * order placement is one transaction however many steps it runs, and the
 * seed, the actions and the tests share the code.
 *
 * Lock order, the same in every flow so no two can deadlock:
 *
 *   1. the document: the numbering counter for a new order, or the order row
 *      (SELECT ... FOR UPDATE) for an existing one
 *   2. the promo row, when the order carries a code
 *   3. every variant the order touches, in one statement (lockVariants)
 *
 * Status never changes by assignment. Each move locks the order, checks the
 * transition map, and then does the stock and money work the move implies,
 * in the same transaction as the status write. docs/PLAN.md section 5.1.
 */

type Tx = Prisma.TransactionClient;

export type Actor = { id: string };

export type OrderLineDraft = {
  variantId: string;
  qty: number;
  discountCentavos: number;
};

export type OrderDraft = {
  channel: SalesChannel;
  customerId: string | null;
  warehouseId: string;
  shippingAddressId: string | null;
  channelReference: string | null;
  shippingCentavos: number;
  promoCode: string | null;
  manualDiscount: ManualDiscount | null;
  notes: string | null;
  lines: OrderLineDraft[];
};

export type OrderOptions = {
  /** Manual discount ceiling for the actor, in basis points; null for no ceiling. */
  discountCapBps: number | null;
  /** "free" prices every line at zero: a warranty replacement. */
  pricing?: "list" | "free";
  /** The reason on the SALE movements when the order is paid. */
  saleReason?: Extract<StockReason, "CUSTOMER_SALE" | "WARRANTY_REPLACEMENT">;
  now?: Date;
};

type LockedOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  channel: SalesChannel;
  customerId: string | null;
  warehouseId: string;
  salespersonId: string | null;
  createdById: string | null;
  promoId: string | null;
  totalCentavos: number;
  amountPaidCentavos: number;
  amountRefundedCentavos: number;
};

export async function lockOrder(tx: Tx, orderId: string): Promise<LockedOrder> {
  const [row] = await tx.$queryRaw<LockedOrder[]>`
    SELECT id, "orderNumber", status, channel, "customerId", "warehouseId", "salespersonId",
           "createdById", "promoId", "totalCentavos", "amountPaidCentavos", "amountRefundedCentavos"
    FROM "Order"
    WHERE id = ${orderId}
    FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That order does not exist.");
  return row;
}

async function orderItems(tx: Tx, orderId: string) {
  return tx.orderItem.findMany({
    where: { orderId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      variantId: true,
      skuSnapshot: true,
      qty: true,
      qtyReturned: true,
      unitCostCentavos: true,
      lineTotalCentavos: true,
    },
  });
}

async function writeEvent(
  tx: Tx,
  orderId: string,
  from: OrderStatus | null,
  to: OrderStatus,
  actor: Actor,
  note?: string | null,
): Promise<void> {
  await tx.orderStatusEvent.create({
    data: { orderId, fromStatus: from, toStatus: to, actorId: actor.id, note: note || null },
    select: { id: true },
  });
}

async function refreshRollup(tx: Tx, customerId: string | null, now: Date): Promise<void> {
  if (customerId) await refreshCustomerRollup(tx, customerId, now);
}

// ------------------------------------------------------------------ content

type PromoRow = {
  id: string;
  code: string;
  type: PromoType;
  percentBps: number | null;
  amountCentavos: number | null;
  minSubtotalCentavos: number;
  startsAt: Date;
  endsAt: Date;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  isActive: boolean;
  deletedAt: Date | null;
};

/** Lock a promo by code. Its row lock serialises redemptions against its usage limit. */
async function lockPromo(tx: Tx, code: string): Promise<PromoRow> {
  const [row] = await tx.$queryRaw<PromoRow[]>`
    SELECT id, code, type, "percentBps", "amountCentavos", "minSubtotalCentavos", "startsAt",
           "endsAt", "usageLimit", "usageCount", "perCustomerLimit", "isActive", "deletedAt"
    FROM "Promo"
    WHERE code = ${code.trim().toUpperCase()}
    FOR UPDATE
  `;
  if (!row) throw new DomainError(`There is no promo with the code ${code.trim().toUpperCase()}.`);
  return row;
}

type BuiltContent = {
  pricing: OrderPricing;
  promo: PromoRow | null;
  items: {
    variantId: string;
    skuSnapshot: string;
    nameSnapshot: string;
    qty: number;
    unitPriceCentavos: number;
    discountCentavos: number;
    lineSubtotalCentavos: number;
    vatCentavos: number;
    lineTotalCentavos: number;
    unitCostCentavos: number;
  }[];
};

/**
 * Validate a draft against the database and price it. Prices always come
 * from the catalogue, never from the browser. Takes the promo lock and then
 * the variant locks, in that order.
 */
async function buildContent(
  tx: Tx,
  draft: OrderDraft,
  options: OrderOptions,
  now: Date,
): Promise<BuiltContent> {
  const variantIds = draft.lines.map((line) => line.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    throw new DomainError("Each item can appear on one line only.");
  }

  const warehouse = await tx.warehouse.findFirst({
    where: { id: draft.warehouseId, deletedAt: null },
    select: { code: true, isActive: true },
  });
  if (!warehouse) throw new NotFoundError("That warehouse does not exist.");
  if (!warehouse.isActive) {
    throw new DomainError(`${warehouse.code} is inactive, so it cannot ship orders.`);
  }

  if (draft.customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: draft.customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError("That customer no longer exists.");
  } else if (draft.channel === "B2B") {
    throw new DomainError("B2B orders are billed to a business account. Choose the customer.");
  }

  if (draft.shippingAddressId) {
    const address = await tx.address.findFirst({
      where: { id: draft.shippingAddressId, customerId: draft.customerId ?? "" },
      select: { id: true },
    });
    if (!address) throw new DomainError("That address does not belong to this customer.");
  }

  if (
    (draft.channel === "SHOPEE" || draft.channel === "LAZADA" || draft.channel === "TIKTOK") &&
    !draft.channelReference
  ) {
    throw new DomainError("Add the marketplace order number, so the order can be matched later.");
  }

  const promo = draft.promoCode ? await lockPromo(tx, draft.promoCode) : null;

  const locked = await lockVariants(tx, variantIds);
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sku: true,
      name: true,
      priceCentavos: true,
      isActive: true,
      deletedAt: true,
      product: { select: { name: true, status: true, deletedAt: true } },
    },
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const free = options.pricing === "free";
  const priced = draft.lines.map((line) => {
    const variant = byId.get(line.variantId);
    if (!variant) throw new NotFoundError("One of those items no longer exists.");
    if (!free) {
      if (
        variant.deletedAt ||
        variant.product.deletedAt ||
        !variant.isActive ||
        variant.product.status !== "ACTIVE"
      ) {
        throw new DomainError(`${variant.sku} is not for sale right now.`);
      }
    }
    return { line, variant };
  });

  const pricing = priceOrder({
    lines: priced.map(({ line, variant }) => ({
      qty: line.qty,
      unitPriceCentavos: free ? 0 : variant.priceCentavos,
      discountCentavos: free ? 0 : line.discountCentavos,
    })),
    promo: promo && !free ? promo : null,
    manualDiscount: free ? null : draft.manualDiscount,
    shippingCentavos: free ? 0 : draft.shippingCentavos,
  });

  if (promo) {
    const customerRedemptions = draft.customerId
      ? await tx.promoRedemption.count({
          where: { promoId: promo.id, customerId: draft.customerId },
        })
      : 0;
    assertPromoUsable(promo, {
      now,
      merchandiseCentavos: pricing.merchandiseCentavos,
      customerId: draft.customerId,
      customerRedemptions,
    });
  }

  assertManualDiscountAllowed(pricing, options.discountCapBps);

  const items = priced.map(({ variant }, index) => {
    const line = pricing.lines[index];
    if (!line) throw new Error("Pricing lost a line.");
    return {
      variantId: variant.id,
      skuSnapshot: variant.sku,
      nameSnapshot: variant.name ? `${variant.product.name} ${variant.name}` : variant.product.name,
      qty: line.qty,
      unitPriceCentavos: line.unitPriceCentavos,
      discountCentavos: line.discountCentavos,
      lineSubtotalCentavos: line.lineSubtotalCentavos,
      vatCentavos: line.vatCentavos,
      lineTotalCentavos: line.lineTotalCentavos,
      // The average now, so a draft shows an honest margin. Re-stamped at payment.
      unitCostCentavos: locked.get(variant.id)?.avgCostCentavos ?? 0,
    };
  });

  return { pricing, promo, items };
}

function headerFrom(content: BuiltContent) {
  const { pricing, promo } = content;
  return {
    subtotalCentavos: pricing.subtotalCentavos,
    discountCentavos: pricing.discountCentavos,
    shippingCentavos: pricing.shippingCentavos,
    vatCentavos: pricing.vatCentavos,
    totalCentavos: pricing.totalCentavos,
    promoId: promo?.id ?? null,
    promoCodeSnapshot: promo?.code ?? null,
  };
}

/**
 * Record a promo use. Written when the order is saved, draft included, so a
 * code with ten uses left cannot be promised to eleven quotes. Cancelling
 * gives the use back.
 */
async function redeemPromo(
  tx: Tx,
  content: BuiltContent,
  orderId: string,
  customerId: string | null,
): Promise<void> {
  if (!content.promo || content.pricing.promoDiscountCentavos === 0) return;
  await tx.promoRedemption.create({
    data: {
      promoId: content.promo.id,
      orderId,
      customerId,
      discountAppliedCentavos: content.pricing.promoDiscountCentavos,
    },
    select: { id: true },
  });
  await tx.promo.update({
    where: { id: content.promo.id },
    data: { usageCount: { increment: 1 } },
    select: { id: true },
  });
}

async function unredeemPromo(tx: Tx, orderId: string): Promise<void> {
  const redemption = await tx.promoRedemption.findUnique({
    where: { orderId },
    select: { id: true, promoId: true },
  });
  if (!redemption) return;
  await tx.$queryRaw`SELECT id FROM "Promo" WHERE id = ${redemption.promoId} FOR UPDATE`;
  await tx.promoRedemption.delete({ where: { id: redemption.id } });
  await tx.promo.update({
    where: { id: redemption.promoId },
    data: { usageCount: { decrement: 1 } },
    select: { id: true },
  });
}

// ------------------------------------------------------------------- create

export type OrderResult = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalCentavos: number;
  changeCentavos: number;
};

/**
 * Create an order, and optionally place it and take payment, in the caller's
 * transaction. Placing reserves every line against available stock; paying
 * turns the reservations into SALE movements. If any line is short, the
 * conditional update in the stock service refuses it and the whole order,
 * header, lines, promo use and payments, rolls back together.
 */
export async function createOrder(
  tx: Tx,
  draft: OrderDraft,
  actor: Actor,
  options: OrderOptions & { intent: "draft" | "place" | "paid"; tenders?: Tender[] },
): Promise<OrderResult> {
  const now = options.now ?? new Date();
  const initial = initialStatusFor(draft.channel, options.intent);

  // The document lock comes first, before the promo and the variants.
  const orderNumber = await nextReference(tx, "SO", now);
  const content = await buildContent(tx, draft, options, now);

  const marketplace =
    draft.channel === "SHOPEE" || draft.channel === "LAZADA" || draft.channel === "TIKTOK";

  const order = await tx.order.create({
    data: {
      orderNumber,
      channel: draft.channel,
      status: "DRAFT",
      customerId: draft.customerId,
      // Staff who key an order own it; a marketplace order belongs to the channel.
      salespersonId: marketplace ? null : actor.id,
      createdById: actor.id,
      warehouseId: draft.warehouseId,
      shippingAddressId: draft.shippingAddressId,
      billingAddressId: await defaultBillingAddress(tx, draft.customerId),
      channelReference: draft.channelReference,
      notes: draft.notes,
      placedAt: now,
      ...headerFrom(content),
      items: { create: content.items },
    },
    select: { id: true },
  });

  await writeEvent(tx, order.id, null, "DRAFT", actor);
  await redeemPromo(tx, content, order.id, draft.customerId);

  let status: OrderStatus = "DRAFT";
  let changeCentavos = 0;

  if (initial === "PENDING") {
    await placeOrder(tx, order.id, actor);
    status = "PENDING";
  }
  if (options.intent === "paid") {
    const paid = await payOrder(tx, order.id, options.tenders ?? [], actor, options);
    status = "PAID";
    changeCentavos = paid.changeCentavos;
  }

  return {
    id: order.id,
    orderNumber,
    status,
    totalCentavos: content.pricing.totalCentavos,
    changeCentavos,
  };
}

async function defaultBillingAddress(tx: Tx, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const address = await tx.address.findFirst({
    where: { customerId, type: { in: ["BILLING", "BUSINESS"] } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return address?.id ?? null;
}

/** Replace a draft's content. Anything past DRAFT is a document, not a quote. */
export async function updateDraftOrder(
  tx: Tx,
  orderId: string,
  draft: OrderDraft,
  actor: Actor,
  options: OrderOptions & { intent: "draft" | "place" | "paid"; tenders?: Tender[] },
): Promise<OrderResult> {
  const now = options.now ?? new Date();
  const order = await lockOrder(tx, orderId);
  if (order.status !== "DRAFT") {
    throw new DomainError(
      `${order.orderNumber} is ${ORDER_STATUS_LABEL[order.status].toLowerCase()}, so it can no longer be edited.`,
    );
  }
  initialStatusFor(draft.channel, options.intent);

  // Give the old promo use back before the new content takes its own.
  await unredeemPromo(tx, orderId);
  const content = await buildContent(tx, draft, options, now);

  await tx.orderItem.deleteMany({ where: { orderId } });
  await tx.order.update({
    where: { id: orderId },
    data: {
      channel: draft.channel,
      customerId: draft.customerId,
      warehouseId: draft.warehouseId,
      shippingAddressId: draft.shippingAddressId,
      billingAddressId: await defaultBillingAddress(tx, draft.customerId),
      channelReference: draft.channelReference,
      notes: draft.notes,
      ...headerFrom(content),
      items: { create: content.items },
    },
    select: { id: true },
  });
  await redeemPromo(tx, content, orderId, draft.customerId);

  let status: OrderStatus = "DRAFT";
  let changeCentavos = 0;
  if (options.intent !== "draft") {
    await placeOrder(tx, orderId, actor);
    status = "PENDING";
  }
  if (options.intent === "paid") {
    changeCentavos = (await payOrder(tx, orderId, options.tenders ?? [], actor, options))
      .changeCentavos;
    status = "PAID";
  }

  return {
    id: orderId,
    orderNumber: order.orderNumber,
    status,
    totalCentavos: content.pricing.totalCentavos,
    changeCentavos,
  };
}

// ---------------------------------------------------------------- lifecycle

/**
 * DRAFT -> PENDING. Reserve every line: `reserved += qty` with the stock check
 * inside the UPDATE, so available stock can never be promised twice.
 */
export async function placeOrder(tx: Tx, orderId: string, actor: Actor): Promise<void> {
  const order = await lockOrder(tx, orderId);
  assertTransition(ORDER_TRANSITIONS, "Order", order.status, "PENDING");

  const items = await orderItems(tx, orderId);
  await lockVariants(
    tx,
    items.map((item) => item.variantId),
  );
  for (const item of items) {
    await reserveStock(tx, {
      variantId: item.variantId,
      warehouseId: order.warehouseId,
      qty: item.qty,
    });
  }

  await tx.order.update({
    where: { id: orderId },
    data: { status: "PENDING", placedAt: new Date() },
    select: { id: true },
  });
  await writeEvent(tx, orderId, order.status, "PENDING", actor);
}

/**
 * PENDING -> PAID. The payments must cover the balance exactly. Each line's
 * reservation becomes a SALE movement, and the line's cost is stamped with
 * the moving average at that instant: later receipts move the average, but
 * never rewrite this order's margin.
 */
export async function payOrder(
  tx: Tx,
  orderId: string,
  tenders: readonly Tender[],
  actor: Actor,
  options: Pick<OrderOptions, "saleReason" | "now"> = {},
): Promise<{ changeCentavos: number; costTotalCentavos: number }> {
  const now = options.now ?? new Date();
  const order = await lockOrder(tx, orderId);
  assertTransition(ORDER_TRANSITIONS, "Order", order.status, "PAID");

  const due = order.totalCentavos - order.amountPaidCentavos;
  const settlement = settleTenders(due, tenders, { channel: order.channel });

  for (const payment of settlement.payments) {
    await tx.payment.create({
      data: { orderId, ...payment, status: "PAID", paidAt: now, createdById: actor.id },
      select: { id: true },
    });
  }

  const items = await orderItems(tx, orderId);
  await lockVariants(
    tx,
    items.map((item) => item.variantId),
  );

  let costTotalCentavos = 0;
  for (const item of items) {
    const movement = await applyMovement(tx, {
      variantId: item.variantId,
      warehouseId: order.warehouseId,
      type: "SALE",
      reason: options.saleReason ?? "CUSTOMER_SALE",
      qtyDelta: -item.qty,
      fromReserved: true,
      note: `Sold on ${order.orderNumber}`,
      actorId: actor.id,
      refs: { orderItemId: item.id },
    });
    costTotalCentavos += movement.unitCostCentavos * item.qty;
    await tx.orderItem.update({
      where: { id: item.id },
      data: { unitCostCentavos: movement.unitCostCentavos },
      select: { id: true },
    });
  }

  await tx.order.update({
    where: { id: orderId },
    data: {
      status: "PAID",
      paidAt: now,
      amountPaidCentavos: order.amountPaidCentavos + due,
      costTotalCentavos,
    },
    select: { id: true },
  });
  await writeEvent(tx, orderId, order.status, "PAID", actor);
  await refreshRollup(tx, order.customerId, now);

  return { changeCentavos: settlement.changeCentavos, costTotalCentavos };
}

const STAMP: Partial<
  Record<OrderStatus, "packedAt" | "shippedAt" | "deliveredAt" | "completedAt">
> = {
  PACKED: "packedAt",
  SHIPPED: "shippedAt",
  DELIVERED: "deliveredAt",
  COMPLETED: "completedAt",
};

/**
 * The fulfilment steps: packed, shipped, delivered, completed. No stock moves
 * here (it left at payment); each step stamps its time and its event.
 * Completion refreshes the customer's lifetime value and segment.
 */
export async function advanceOrder(
  tx: Tx,
  orderId: string,
  to: "PACKED" | "SHIPPED" | "DELIVERED" | "COMPLETED",
  actor: Actor,
  note?: string | null,
): Promise<{ from: OrderStatus; orderNumber: string }> {
  const order = await lockOrder(tx, orderId);
  assertTransition(ORDER_TRANSITIONS, "Order", order.status, to);

  const now = new Date();
  const stamp = STAMP[to];
  await tx.order.update({
    where: { id: orderId },
    data: { status: to, ...(stamp ? { [stamp]: now } : {}) },
    select: { id: true },
  });
  await writeEvent(tx, orderId, order.status, to, actor, note);
  if (to === "COMPLETED") await refreshRollup(tx, order.customerId, now);

  return { from: order.status, orderNumber: order.orderNumber };
}

export type CancelResult = {
  orderNumber: string;
  from: OrderStatus;
  refundedCentavos: number;
  restockedUnits: number;
};

/**
 * Cancel. What that means depends on how far the order got:
 *
 *   DRAFT            nothing was promised
 *   PENDING          give the reservations back
 *   PAID, PACKED     the goods are still in the building but left the ledger:
 *                    RETURN movements put them back at the exact cost they
 *                    left at, and the money goes back as a Refund
 *
 * Once shipped, an order cannot be cancelled; the goods come back through a
 * return instead. The promo use is given back in every case.
 */
export async function cancelOrder(
  tx: Tx,
  input: {
    orderId: string;
    reason: string;
    refundMethod?: PaymentMethod;
    refundReference?: string;
  },
  actor: Actor,
): Promise<CancelResult> {
  if (input.refundMethod === "COD") {
    throw new DomainError(
      "Cash on delivery only collects money. Refund by bank transfer, GCash or cash.",
    );
  }
  const order = await lockOrder(tx, input.orderId);
  if (!canTransition(ORDER_TRANSITIONS, order.status, "CANCELLED")) {
    throw new InvalidTransitionError(
      "Order",
      order.status,
      "CANCELLED",
      hasShipped(order.status)
        ? `${order.orderNumber} has already left the warehouse. Raise a return instead of cancelling.`
        : undefined,
    );
  }

  await unredeemPromo(tx, order.id);
  const items = await orderItems(tx, order.id);
  await lockVariants(
    tx,
    items.map((item) => item.variantId),
  );

  let restockedUnits = 0;
  if (holdsReservation(order.status)) {
    for (const item of items) {
      await releaseStock(tx, {
        variantId: item.variantId,
        warehouseId: order.warehouseId,
        qty: item.qty,
      });
    }
  } else if (cancelNeedsRefund(order.status)) {
    for (const item of items) {
      await applyMovement(tx, {
        variantId: item.variantId,
        warehouseId: order.warehouseId,
        type: "RETURN",
        reason: "CUSTOMER_RETURN",
        qtyDelta: item.qty,
        unitCostCentavos: item.unitCostCentavos,
        note: `Back on the shelf, ${order.orderNumber} cancelled before dispatch`,
        actorId: actor.id,
        refs: { orderItemId: item.id },
      });
      restockedUnits += item.qty;
    }
  }

  let refundedCentavos = 0;
  const balance = order.amountPaidCentavos - order.amountRefundedCentavos;
  if (balance > 0) {
    const payment = await tx.payment.findFirst({
      where: { orderId: order.id },
      orderBy: { amountCentavos: "desc" },
      select: { method: true },
    });
    const method = input.refundMethod ?? payment?.method ?? "CASH";
    await tx.refund.create({
      data: {
        orderId: order.id,
        amountCentavos: balance,
        method: method === "COD" ? "BANK_TRANSFER" : method,
        reason: `Order cancelled: ${input.reason}`,
        reference: input.refundReference?.trim() || null,
        createdById: actor.id,
      },
      select: { id: true },
    });
    refundedCentavos = balance;
  }

  const now = new Date();
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelReason: input.reason,
      amountRefundedCentavos: order.amountRefundedCentavos + refundedCentavos,
    },
    select: { id: true },
  });
  await writeEvent(tx, order.id, order.status, "CANCELLED", actor, input.reason);
  if (refundedCentavos > 0) await refreshRollup(tx, order.customerId, now);

  return { orderNumber: order.orderNumber, from: order.status, refundedCentavos, restockedUnits };
}

// ------------------------------------------------------------------ refunds

export type RefundInput = {
  orderId: string;
  amountCentavos: number;
  method: PaymentMethod;
  reason: string;
  reference?: string | null;
  returnId?: string | null;
};

export type RefundResult = {
  refundId: string;
  orderNumber: string;
  amountCentavos: number;
  /** Set when this refund moved the order to REFUNDED. */
  statusChange: { from: OrderStatus; to: "REFUNDED" } | null;
};

/**
 * Send money back on an order. Refunds never exceed what was paid less what
 * has already gone back. A refund that leaves nothing paid, or follows the
 * last unit home, moves the order to REFUNDED (D-19); a partial one leaves
 * the status alone, because a partly refunded delivered order is still a
 * delivered order. Callers that also lock a return lock it first.
 */
export async function recordRefund(
  tx: Tx,
  input: RefundInput,
  actor: Actor,
): Promise<RefundResult> {
  const order = await lockOrder(tx, input.orderId);
  if (!hasShipped(order.status) || order.status === "REFUNDED") {
    throw new DomainError(
      order.status === "REFUNDED"
        ? `${order.orderNumber} has already been refunded in full.`
        : `${order.orderNumber} has not been paid, so there is nothing to refund.`,
    );
  }
  assertRefundable(order, input.amountCentavos);
  if (input.method === "COD") {
    throw new DomainError(
      "Cash on delivery only collects money. Refund by bank transfer, GCash or cash.",
    );
  }

  const refund = await tx.refund.create({
    data: {
      orderId: order.id,
      returnId: input.returnId ?? null,
      amountCentavos: input.amountCentavos,
      method: input.method,
      reason: input.reason,
      reference: input.reference?.trim() || null,
      createdById: actor.id,
    },
    select: { id: true },
  });

  const amountRefundedCentavos = order.amountRefundedCentavos + input.amountCentavos;
  const items = await orderItems(tx, order.id);
  const full = isFullyRefunded({
    amountPaidCentavos: order.amountPaidCentavos,
    amountRefundedCentavos,
    items,
  });

  const now = new Date();
  let statusChange: RefundResult["statusChange"] = null;
  if (full && canTransition(ORDER_TRANSITIONS, order.status, "REFUNDED")) {
    statusChange = { from: order.status, to: "REFUNDED" };
  }

  await tx.order.update({
    where: { id: order.id },
    data: { amountRefundedCentavos, ...(statusChange ? { status: "REFUNDED" } : {}) },
    select: { id: true },
  });
  if (statusChange) await writeEvent(tx, order.id, order.status, "REFUNDED", actor, input.reason);
  await refreshRollup(tx, order.customerId, now);

  return {
    refundId: refund.id,
    orderNumber: order.orderNumber,
    amountCentavos: input.amountCentavos,
    statusChange,
  };
}
