import { z } from "zod";

import {
  MANUAL_DISCOUNT_TYPES,
  manualDiscountIssue,
  orderLineSchema,
  tenderSchema,
} from "@/features/orders/schemas";
import { optionalId, requiredId, text } from "@/lib/validation";

/**
 * A sale at the register. The line and tender shapes are the order form's own,
 * so the register and a keyed-in order are refused by the same rules with the
 * same words. What differs is what the register leaves out: no channel, no
 * shipping, no address and no draft, because the customer is standing at the
 * counter and leaves with the goods.
 */

export const posLineSchema = orderLineSchema.pick({ variantId: true, qty: true });

export type PosLineValues = z.infer<typeof posLineSchema>;

export const posSaleSchema = z
  .object({
    warehouseId: requiredId("Choose the store this register sells from."),
    /** Optional: most counter sales are walk-ins. */
    customerId: optionalId,
    lines: z
      .array(posLineSchema)
      .min(1, "Scan or tap an item first.")
      .max(50, "Ring up more than 50 lines as two sales."),
    discountType: z.enum(MANUAL_DISCOUNT_TYPES),
    discountValue: z.string().trim().max(16),
    promoCode: text(24),
    tenders: z.array(tenderSchema).max(4, "Up to four payments per sale."),
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
    const discountIssue = manualDiscountIssue(value.discountType, value.discountValue);
    if (discountIssue) {
      ctx.addIssue({ code: "custom", path: ["discountValue"], message: discountIssue });
    }
  });

export type PosSaleValues = z.infer<typeof posSaleSchema>;

export const registerSearchSchema = z.object({
  query: z.string().trim().max(80),
  warehouseId: requiredId("Choose a store first."),
});
