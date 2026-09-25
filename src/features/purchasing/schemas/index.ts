import type { BillStatus, PaymentMethod, PurchaseOrderStatus } from "@prisma/client";
import { z } from "zod";

import { isPesoInput } from "@/lib/money";
import { optionalPeso, pageParam, requiredPeso, text } from "@/lib/validation";

/**
 * Purchasing schemas, shared by the forms and the server actions. The
 * services re-check every rule that depends on live data (what is still
 * outstanding, what a bill still owes) under the document's row lock.
 */

// ---------------------------------------------------------------- vocabulary

export const PO_STATUSES = [
  "DRAFT",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
] as const satisfies readonly PurchaseOrderStatus[];

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "draft",
  SENT: "sent",
  PARTIALLY_RECEIVED: "partly received",
  RECEIVED: "received",
  CLOSED: "closed",
  CANCELLED: "cancelled",
};

export const BILL_STATUSES = [
  "DRAFT",
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
  "VOID",
] as const satisfies readonly BillStatus[];

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  DRAFT: "draft",
  OPEN: "open",
  PARTIALLY_PAID: "partly paid",
  PAID: "paid",
  VOID: "void",
};

/** How TechGear pays suppliers. Cash on delivery is a customer method, not ours. */
export const SUPPLIER_PAYMENT_METHODS = [
  "BANK_TRANSFER",
  "GCASH",
  "MAYA",
  "CARD",
  "CASH",
] as const satisfies readonly PaymentMethod[];

export const SUPPLIER_REFERENCE_REQUIRED: readonly PaymentMethod[] = [
  "BANK_TRANSFER",
  "GCASH",
  "MAYA",
];

export const MAX_PO_LINES = 50;
export const MAX_PO_LINE_QTY = 100_000;

// ------------------------------------------------------------------- helpers

const id = (message: string) => z.string().trim().min(1, message).max(64);

const isoDate = z
  .string()
  .trim()
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), { message: "Pick a date." });

const optionalIsoDate = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Pick a date.",
  });

const wholeQty = (message: string, min: number) =>
  z
    .number({ error: message })
    .int("Quantities are whole units.")
    .min(min, min === 0 ? "Cannot be negative." : `At least ${min}.`)
    .max(
      MAX_PO_LINE_QTY,
      `No more than ${MAX_PO_LINE_QTY.toLocaleString("en-PH")} units per line.`,
    );

/** A unit cost as typed, in pesos. Zero is allowed on a free sample line. */
const unitCost = z
  .string()
  .trim()
  .min(1, "Enter a unit cost.")
  .refine((value) => isPesoInput(value) && !value.trim().startsWith("-"), {
    message: "Enter a cost in pesos, such as 1850 or 1,850.00.",
  });

// ------------------------------------------------------------ purchase orders

export const poLineSchema = z.object({
  variantId: id("Pick a product variant."),
  qty: wholeQty("Enter a whole number.", 1),
  unitCost,
});

export const PO_INTENTS = ["draft", "send"] as const;

export const purchaseOrderSchema = z
  .object({
    /** Present when editing a draft. */
    id: z.string().trim().max(64).optional(),
    supplierId: id("Choose a supplier."),
    warehouseId: id("Choose the warehouse receiving the goods."),
    expectedDate: optionalIsoDate,
    shipping: optionalPeso,
    notes: text(500),
    lines: z
      .array(poLineSchema)
      .min(1, "Add at least one line.")
      .max(MAX_PO_LINES, `A purchase order holds at most ${MAX_PO_LINES} lines.`),
    intent: z.enum(PO_INTENTS),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (line.variantId === "") return;
      if (seen.has(line.variantId)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "variantId"],
          message: "This variant is already on another line.",
        });
      }
      seen.add(line.variantId);
    });
  });

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type PoLineValues = z.infer<typeof poLineSchema>;

export const poIdSchema = z.object({ purchaseOrderId: id("Purchase order not specified.") });

export const cancelPoSchema = z.object({
  purchaseOrderId: id("Purchase order not specified."),
  reason: text(300, { min: 3, required: "Say why the order is being cancelled." }),
});
export type CancelPoInput = z.infer<typeof cancelPoSchema>;

/** The reason is optional here and required by the service for a short-close. */
export const closePoSchema = z.object({
  purchaseOrderId: id("Purchase order not specified."),
  reason: text(300),
});
export type ClosePoInput = z.infer<typeof closePoSchema>;

export const reorderLinesSchema = z.object({
  supplierId: z.string().trim().max(64),
  warehouseId: z.string().trim().max(64).optional(),
});

export const purchasableSearchSchema = z.object({
  query: z.string().trim().max(80),
  warehouseId: z.string().trim().max(64).optional(),
});

export const purchasablePositionsSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).max(MAX_PO_LINES),
  warehouseId: z.string().trim().max(64).optional(),
});

// ------------------------------------------------------------------ receiving

export const receiptLineSchema = z.object({
  itemId: id("Line not specified."),
  qtyReceived: wholeQty("Enter a whole number.", 0),
  qtyRejected: wholeQty("Enter a whole number.", 0),
  unitCost,
});

export const receivePoSchema = z
  .object({
    purchaseOrderId: id("Purchase order not specified."),
    note: text(500),
    lines: z.array(receiptLineSchema).min(1, "Nothing to receive."),
  })
  .superRefine((value, ctx) => {
    const rejected = value.lines.some((line) => line.qtyRejected > 0);
    if (rejected && value.note === "") {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Say why units were rejected, so the supplier claim has a record.",
      });
    }
    if (value.lines.every((line) => line.qtyReceived === 0 && line.qtyRejected === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Nothing to receive. Enter what arrived on at least one line.",
      });
    }
  });

export type ReceivePoInput = z.infer<typeof receivePoSchema>;
export type ReceiptLineValues = z.infer<typeof receiptLineSchema>;

// ---------------------------------------------------------------------- bills

export const billSchema = z.object({
  supplierId: id("Choose the supplier who sent the bill."),
  purchaseOrderId: z.string().trim().max(64),
  supplierReference: text(40, { min: 1, required: "Enter the supplier's invoice number." }),
  issueDate: isoDate,
  /** Empty takes the supplier's payment terms. */
  dueDate: optionalIsoDate,
  subtotal: requiredPeso,
  notes: text(500),
});
export type BillInput = z.infer<typeof billSchema>;

export const supplierPaymentSchema = z
  .object({
    billId: id("Bill not specified."),
    amount: requiredPeso,
    method: z.enum(SUPPLIER_PAYMENT_METHODS, { error: "Choose how it was paid." }),
    reference: text(60),
    paidOn: isoDate,
  })
  .superRefine((value, ctx) => {
    if (SUPPLIER_REFERENCE_REQUIRED.includes(value.method) && value.reference === "") {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Enter the transfer reference so the payment can be traced.",
      });
    }
  });
export type SupplierPaymentInput = z.infer<typeof supplierPaymentSchema>;

export const voidBillSchema = z.object({
  billId: id("Bill not specified."),
  reason: text(300, { min: 3, required: "Say why the bill is being voided." }),
});
export type VoidBillInput = z.infer<typeof voidBillSchema>;

// -------------------------------------------------------------------- filters

const optionalText = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const PO_VIEWS = ["open", "overdue", "all", ...PO_STATUSES] as const;
export type PoView = (typeof PO_VIEWS)[number];

export const poFiltersSchema = z.object({
  view: z.enum(PO_VIEWS).catch("all"),
  search: optionalText,
  supplierId: optionalText,
  page: pageParam,
});
export type PoFilters = z.infer<typeof poFiltersSchema>;

export const BILL_VIEWS = ["unpaid", "overdue", "paid", "void", "all"] as const;
export type BillView = (typeof BILL_VIEWS)[number];

export const billFiltersSchema = z.object({
  view: z.enum(BILL_VIEWS).catch("unpaid"),
  search: optionalText,
  supplierId: optionalText,
  page: pageParam,
});
export type BillFilters = z.infer<typeof billFiltersSchema>;
