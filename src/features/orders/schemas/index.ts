import type { OrderStatus, PaymentMethod, SalesChannel } from "@prisma/client";
import { z } from "zod";

import { SALES_CHANNELS } from "@/lib/channels";
import {
  optionalId,
  optionalPeso,
  pageParam,
  requiredId,
  requiredPeso,
  text,
} from "@/lib/validation";

/**
 * Order schemas. The form and the server action parse the same objects, so a
 * message a person sees in the browser is the message the server would send.
 * Money arrives as the peso text a person typed and is converted to centavos
 * on the server with parsePesoInput, never through a float.
 */

export const ORDER_STATUSES = [
  "DRAFT",
  "PENDING",
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
] as const satisfies readonly OrderStatus[];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  PAID: "Paid",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export const PAYMENT_METHODS = [
  "GCASH",
  "MAYA",
  "CARD",
  "BANK_TRANSFER",
  "CASH",
  "COD",
] as const satisfies readonly PaymentMethod[];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  GCASH: "GCash",
  MAYA: "Maya",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  COD: "Cash on delivery",
};

/** Methods that leave a reference a person can quote back to the bank or wallet. */
export const REFERENCE_REQUIRED: readonly PaymentMethod[] = ["GCASH", "MAYA", "BANK_TRANSFER"];

/**
 * Channels an order can be keyed in for. POS sales are rung up at the register,
 * where the customer is standing and the sale settles on the spot.
 */
export const ORDER_FORM_CHANNELS = [
  "SHOPEE",
  "LAZADA",
  "TIKTOK",
  "FACEBOOK",
  "DIRECT",
  "B2B",
] as const satisfies readonly SalesChannel[];

/** Marketplaces have already taken the order, so it cannot sit as a draft here. */
export const MARKETPLACE_CHANNELS: readonly SalesChannel[] = ["SHOPEE", "LAZADA", "TIKTOK"];

// ------------------------------------------------------------------ tenders

export const tenderSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: requiredPeso,
  /** Cash only: what the customer handed over, when it is more than the amount. */
  tendered: optionalPeso,
  reference: text(60),
});

export type TenderValues = z.infer<typeof tenderSchema>;

// -------------------------------------------------------------- order form

export const MANUAL_DISCOUNT_TYPES = ["NONE", "PERCENT", "FIXED"] as const;

export const orderLineSchema = z.object({
  variantId: requiredId("Choose an item."),
  qty: z
    .number({ error: "Enter a quantity." })
    .int("Whole units only.")
    .min(1, "At least 1.")
    .max(9_999, "That is more than one order line can carry."),
  /** Peso amount off this line, on top of any order discount. */
  discount: optionalPeso,
});

export type OrderLineValues = z.infer<typeof orderLineSchema>;

export const ORDER_INTENTS = ["draft", "place", "paid"] as const;
export type OrderIntent = (typeof ORDER_INTENTS)[number];

export const orderFormSchema = z
  .object({
    channel: z.enum(ORDER_FORM_CHANNELS, { message: "Choose the channel the order came in on." }),
    customerId: optionalId,
    warehouseId: requiredId("Choose the warehouse that will ship it."),
    shippingAddressId: optionalId,
    channelReference: text(40),
    shipping: optionalPeso,
    promoCode: text(24),
    manualDiscountType: z.enum(MANUAL_DISCOUNT_TYPES),
    manualDiscountValue: z.string().trim().max(16),
    notes: text(1000),
    lines: z
      .array(orderLineSchema)
      .min(1, "Add at least one item.")
      .max(50, "Split orders larger than 50 lines."),
    intent: z.enum(ORDER_INTENTS),
    /** Only read when intent is "paid". */
    tenders: z.array(tenderSchema).max(4, "Up to four payments per order."),
  })
  .superRefine((value, ctx) => {
    const ids = value.lines.map((line) => line.variantId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Each item can appear on one line only. Raise the quantity instead.",
      });
    }
    if (value.manualDiscountType === "PERCENT") {
      const pct = Number(value.manualDiscountValue);
      if (!/^\d{1,2}(\.\d{1,2})?$|^100$/.test(value.manualDiscountValue) || pct <= 0 || pct > 100) {
        ctx.addIssue({
          code: "custom",
          path: ["manualDiscountValue"],
          message: "Enter a percentage between 0.01 and 100.",
        });
      }
    }
    if (value.manualDiscountType === "FIXED" && value.manualDiscountValue === "") {
      ctx.addIssue({
        code: "custom",
        path: ["manualDiscountValue"],
        message: "Enter the peso amount off.",
      });
    }
    if (value.intent === "draft" && MARKETPLACE_CHANNELS.includes(value.channel)) {
      ctx.addIssue({
        code: "custom",
        path: ["intent"],
        message: "Marketplace orders are already placed. Save it as pending instead.",
      });
    }
    if (value.intent === "paid" && value.tenders.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["tenders"],
        message: "Add the payment the customer made.",
      });
    }
  });

export type OrderFormValues = z.infer<typeof orderFormSchema>;

export const updateOrderSchema = z.object({
  orderId: requiredId("Missing order."),
  values: orderFormSchema,
});

// --------------------------------------------------------------- lifecycle

/** Statuses a person moves an order to directly. Paid, cancelled and refunded have their own flows. */
export const MANUAL_TARGETS = ["PENDING", "PACKED", "SHIPPED", "DELIVERED", "COMPLETED"] as const;

export const orderTransitionSchema = z.object({
  orderId: requiredId("Missing order."),
  to: z.enum(MANUAL_TARGETS),
  note: text(280),
});

export const payOrderSchema = z.object({
  orderId: requiredId("Missing order."),
  tenders: z.array(tenderSchema).min(1, "Add at least one payment.").max(4),
});

export const cancelOrderSchema = z.object({
  orderId: requiredId("Missing order."),
  reason: text(280, { min: 5, required: "Say why, in a few words." }),
  /** Only used when the order was paid: how the money goes back. */
  refundMethod: z.enum(PAYMENT_METHODS).optional(),
  refundReference: text(60),
});

export const refundOrderSchema = z.object({
  orderId: requiredId("Missing order."),
  amount: requiredPeso,
  method: z.enum(PAYMENT_METHODS),
  reason: text(280, { min: 5, required: "Say why the money is going back." }),
  reference: text(60),
});

export const orderIdSchema = z.object({ orderId: requiredId("Missing order.") });

// ------------------------------------------------------------------- lists

export const ORDER_VIEWS = [
  "all",
  "open",
  "unpaid",
  "to-fulfil",
  "in-transit",
  "completed",
  "cancelled",
] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

export const ORDER_SORTS = ["placedAt", "total", "orderNumber"] as const;

export const orderFiltersSchema = z.object({
  view: z.enum(ORDER_VIEWS).catch("all"),
  channel: z.enum(SALES_CHANNELS).optional().catch(undefined),
  method: z.enum(PAYMENT_METHODS).optional().catch(undefined),
  salesperson: z.string().trim().max(64).optional().catch(undefined),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  search: z.string().trim().max(80).optional().catch(undefined),
  sort: z.enum(ORDER_SORTS).catch("placedAt"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: pageParam,
});

export type OrderFilters = z.infer<typeof orderFiltersSchema>;

export const lookupSchema = z.object({
  query: z.string().trim().max(80),
  warehouseId: z.string().trim().max(64).optional(),
});
