import { z } from "zod";

/**
 * Inventory schemas, shared by the forms and the server actions so the client
 * shows exactly the messages the server would return. The server validates
 * again regardless, and the stock service re-checks every rule that depends on
 * the live stock position, because only the service holds the row locks.
 */

// ---------------------------------------------------------------- vocabulary

export const MOVEMENT_TYPES = [
  "RECEIPT",
  "SALE",
  "RETURN",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "WRITE_OFF",
] as const;
export type MovementTypeValue = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABEL: Record<MovementTypeValue, string> = {
  RECEIPT: "Receipt",
  SALE: "Sale",
  RETURN: "Return",
  ADJUSTMENT: "Adjustment",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  WRITE_OFF: "Write-off",
};

export const TRANSFER_STATUSES = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"] as const;
export type TransferStatusValue = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STATUS_LABEL: Record<TransferStatusValue, string> = {
  DRAFT: "draft",
  IN_TRANSIT: "in transit",
  RECEIVED: "received",
  CANCELLED: "cancelled",
};

/**
 * Reasons a person may give for an adjustment. The other StockReason values
 * belong to flows that create their own movements (receiving, selling,
 * returns, transfers) and are never typed in by hand.
 */
export const ADJUSTMENT_REASONS = [
  "COUNT_CORRECTION",
  "DAMAGE",
  "LOSS",
  "THEFT",
  "SAMPLE",
  "OTHER",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export type ReasonDirection = "either" | "decrease";

export const ADJUSTMENT_REASON_META: Record<
  AdjustmentReason,
  { label: string; direction: ReasonDirection; hint: string; noteRequired: boolean }
> = {
  COUNT_CORRECTION: {
    label: "Count correction",
    direction: "either",
    hint: "A physical count disagreed with the system, in either direction.",
    noteRequired: false,
  },
  DAMAGE: {
    label: "Damaged",
    direction: "decrease",
    hint: "Broken in storage or handling and no longer saleable.",
    noteRequired: false,
  },
  LOSS: {
    label: "Lost",
    direction: "decrease",
    hint: "Cannot be found and is not believed stolen.",
    noteRequired: false,
  },
  THEFT: {
    label: "Theft",
    direction: "decrease",
    hint: "Taken without payment. Note the incident or report number.",
    noteRequired: true,
  },
  SAMPLE: {
    label: "Sample or demo unit",
    direction: "decrease",
    hint: "Pulled for display, a review unit, or a creator loan.",
    noteRequired: false,
  },
  OTHER: {
    label: "Other",
    direction: "either",
    hint: "Anything else. The note is required so the audit trail explains it.",
    noteRequired: true,
  },
};

/** Every StockReason, labelled, for rendering movements the ledger shows. */
export const STOCK_REASON_LABEL: Record<string, string> = {
  PURCHASE_RECEIPT: "Purchase receipt",
  CUSTOMER_SALE: "Customer sale",
  CUSTOMER_RETURN: "Customer return",
  DAMAGE: "Damaged",
  LOSS: "Lost",
  THEFT: "Theft",
  COUNT_CORRECTION: "Count correction",
  SAMPLE: "Sample",
  WARRANTY_REPLACEMENT: "Warranty replacement",
  TRANSFER: "Transfer",
  OPENING_BALANCE: "Opening balance",
  OTHER: "Other",
};

/** Hard ceiling on a single line. Far above any real movement, well below Int. */
export const MAX_LINE_QTY = 100_000;
export const MAX_LINES = 50;

// ------------------------------------------------------------------- helpers

const noDashes = (value: string) => !/[–—]/.test(value);
const DASH_MESSAGE = "Use a plain hyphen rather than an en dash or em dash.";

const noteField = z.string().trim().max(500, "Keep notes under 500 characters.").refine(noDashes, {
  message: DASH_MESSAGE,
});

const idField = (message: string) => z.string().trim().min(1, message);

const wholeUnits = (message: string) =>
  z
    .number({ error: message })
    .int("Quantities are whole units.")
    .min(-MAX_LINE_QTY, `No more than ${MAX_LINE_QTY.toLocaleString("en-PH")} units per line.`)
    .max(MAX_LINE_QTY, `No more than ${MAX_LINE_QTY.toLocaleString("en-PH")} units per line.`);

function duplicateIndexes(ids: readonly string[]): number[] {
  const seen = new Set<string>();
  const repeats: number[] = [];
  ids.forEach((id, index) => {
    if (id === "") return;
    if (seen.has(id)) repeats.push(index);
    seen.add(id);
  });
  return repeats;
}

// --------------------------------------------------------------- adjustments

export const adjustmentLineSchema = z
  .object({
    variantId: idField("Pick a product variant."),
    /**
     * "delta" records a change ("remove 2"). "count" records what is physically
     * on the shelf, and the service works out the change under the row lock,
     * so a sale that lands while the form is open cannot skew the result.
     */
    mode: z.enum(["delta", "count"]),
    quantity: wholeUnits("Enter a whole number."),
    note: noteField.optional(),
  })
  .superRefine((line, ctx) => {
    if (line.mode === "count" && line.quantity < 0) {
      ctx.addIssue({ code: "custom", path: ["quantity"], message: "A count cannot be negative." });
    }
    if (line.mode === "delta" && line.quantity === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "A change of zero does nothing. Enter a quantity or remove the line.",
      });
    }
  });

export const adjustmentSchema = z
  .object({
    warehouseId: idField("Choose the warehouse being adjusted."),
    reason: z.enum(ADJUSTMENT_REASONS, {
      error: "Choose a reason. An adjustment without one cannot be audited.",
    }),
    note: noteField,
    lines: z
      .array(adjustmentLineSchema)
      .min(1, "Add at least one line.")
      .max(MAX_LINES, `An adjustment holds at most ${MAX_LINES} lines.`),
  })
  .superRefine((value, ctx) => {
    for (const index of duplicateIndexes(value.lines.map((line) => line.variantId))) {
      ctx.addIssue({
        code: "custom",
        path: ["lines", index, "variantId"],
        message: "This variant is already on another line.",
      });
    }

    const meta = ADJUSTMENT_REASON_META[value.reason];
    if (meta.noteRequired && value.note === "") {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: `A note is required when the reason is ${meta.label.toLowerCase()}.`,
      });
    }

    if (meta.direction === "decrease") {
      value.lines.forEach((line, index) => {
        if (line.mode === "delta" && line.quantity > 0) {
          ctx.addIssue({
            code: "custom",
            path: ["lines", index, "quantity"],
            message: `${meta.label} can only remove stock. Use a negative number, or choose Count correction for found units.`,
          });
        }
      });
    }
  });

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type AdjustmentLineInput = z.infer<typeof adjustmentLineSchema>;

// ----------------------------------------------------------------- transfers

export const transferLineSchema = z.object({
  variantId: idField("Pick a product variant."),
  qty: z
    .number({ error: "Enter a whole number." })
    .int("Quantities are whole units.")
    .min(1, "Transfer at least one unit.")
    .max(MAX_LINE_QTY, `No more than ${MAX_LINE_QTY.toLocaleString("en-PH")} units per line.`),
});

export const transferSchema = z
  .object({
    fromWarehouseId: idField("Choose where the stock leaves from."),
    toWarehouseId: idField("Choose where the stock is going."),
    note: noteField,
    lines: z
      .array(transferLineSchema)
      .min(1, "Add at least one line.")
      .max(MAX_LINES, `A transfer holds at most ${MAX_LINES} lines.`),
    /** Dispatch now, or save a draft to pick and ship later. */
    dispatch: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.fromWarehouseId !== "" && value.fromWarehouseId === value.toWarehouseId) {
      ctx.addIssue({
        code: "custom",
        path: ["toWarehouseId"],
        message: "A transfer needs two different warehouses.",
      });
    }
    for (const index of duplicateIndexes(value.lines.map((line) => line.variantId))) {
      ctx.addIssue({
        code: "custom",
        path: ["lines", index, "variantId"],
        message: "This variant is already on another line.",
      });
    }
  });

export type TransferInput = z.infer<typeof transferSchema>;

export const transferIdSchema = z.object({ transferId: idField("Transfer not specified.") });

export const receiveTransferSchema = z.object({
  transferId: idField("Transfer not specified."),
  lines: z
    .array(
      z.object({
        itemId: idField("Line not specified."),
        qtyReceived: z
          .number({ error: "Enter a whole number." })
          .int("Quantities are whole units.")
          .min(0, "Received quantity cannot be negative."),
      }),
    )
    .min(1, "Nothing to receive."),
  note: noteField,
});

export type ReceiveTransferInput = z.infer<typeof receiveTransferSchema>;

export const cancelTransferSchema = z.object({
  transferId: idField("Transfer not specified."),
  reason: noteField.pipe(z.string().min(3, "Say why the transfer is being cancelled.")),
});

export type CancelTransferInput = z.infer<typeof cancelTransferSchema>;

// ------------------------------------------------------------ reorder levels

export const reorderLevelSchema = z.object({
  variantId: idField("Variant not specified."),
  reorderLevel: z
    .number({ error: "Enter a whole number." })
    .int("Whole units only.")
    .min(0, "Cannot be negative.")
    .max(MAX_LINE_QTY),
  reorderQty: z
    .number({ error: "Enter a whole number." })
    .int("Whole units only.")
    .min(0, "Cannot be negative.")
    .max(MAX_LINE_QTY),
});

export type ReorderLevelInput = z.infer<typeof reorderLevelSchema>;

export const variantSearchSchema = z.object({
  query: z.string().trim().max(80),
  warehouseId: z.string().trim().optional(),
});

export const variantPositionsSchema = z.object({
  ids: z.array(z.string().trim().min(1)).max(MAX_LINES),
  warehouseId: z.string().trim().optional(),
});

// ------------------------------------------------------------------- filters

const optionalText = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const page = z.coerce.number().int().min(1).max(10_000).catch(1);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

export const stockFiltersSchema = z.object({
  search: optionalText,
  warehouseId: optionalText,
  categoryId: optionalText,
  status: z.enum(["in", "low", "out"]).optional().catch(undefined),
  sort: z.enum(["sku", "name", "onHand", "available", "value"]).catch("sku"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  page,
});
export type StockFilters = z.infer<typeof stockFiltersSchema>;

export const ledgerFiltersSchema = z.object({
  search: optionalText,
  variantId: optionalText,
  warehouseId: optionalText,
  type: z.enum(MOVEMENT_TYPES).optional().catch(undefined),
  from: isoDate,
  to: isoDate,
  page,
});
export type LedgerFilters = z.infer<typeof ledgerFiltersSchema>;

export const alertFiltersSchema = z.object({
  view: z.enum(["alerts", "reorder"]).catch("alerts"),
  warehouseId: optionalText,
  level: z.enum(["out", "low"]).optional().catch(undefined),
  page,
});
export type AlertFilters = z.infer<typeof alertFiltersSchema>;

export const adjustmentFiltersSchema = z.object({
  warehouseId: optionalText,
  reason: z.enum(ADJUSTMENT_REASONS).optional().catch(undefined),
  page,
});
export type AdjustmentFilters = z.infer<typeof adjustmentFiltersSchema>;

export const transferFiltersSchema = z.object({
  status: z.enum(TRANSFER_STATUSES).optional().catch(undefined),
  page,
});
export type TransferFilters = z.infer<typeof transferFiltersSchema>;
