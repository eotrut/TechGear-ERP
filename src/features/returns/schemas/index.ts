import type { ReturnDisposition, ReturnStatus } from "@prisma/client";
import { z } from "zod";

import { PAYMENT_METHODS } from "@/features/orders/schemas";
import { pageParam, requiredId, text } from "@/lib/validation";

/** Return (RMA) schemas. */

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  REQUESTED: "Requested",
  APPROVED: "Approved",
  RECEIVED: "Received",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
};

export const DISPOSITIONS = [
  "RESTOCK",
  "WRITE_OFF",
] as const satisfies readonly ReturnDisposition[];

export const DISPOSITION_LABEL: Record<ReturnDisposition, string> = {
  RESTOCK: "Restock",
  WRITE_OFF: "Write off",
};

export const createReturnSchema = z
  .object({
    orderId: requiredId("Choose the order the goods came from."),
    reason: text(280, { min: 5, required: "Say why the customer is returning it." }),
    notes: text(1000),
    lines: z
      .array(
        z.object({
          orderItemId: requiredId("Missing line."),
          qty: z.number({ error: "Enter a quantity." }).int("Whole units only.").min(0).max(9_999),
        }),
      )
      .min(1),
  })
  .refine((value) => value.lines.some((line) => line.qty > 0), {
    path: ["lines"],
    message: "Choose at least one unit to return.",
  });

export type CreateReturnValues = z.infer<typeof createReturnSchema>;

export const returnDecisionSchema = z.object({
  returnId: requiredId("Missing return."),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: text(280),
});

export const receiveReturnSchema = z.object({
  returnId: requiredId("Missing return."),
  lines: z
    .array(
      z.object({
        returnItemId: requiredId("Missing line."),
        disposition: z.enum(DISPOSITIONS),
        conditionNote: text(200),
      }),
    )
    .min(1),
});

export const completeReturnSchema = z.object({
  returnId: requiredId("Missing return."),
  method: z.enum(PAYMENT_METHODS),
  reference: text(60),
  refundShipping: z.boolean(),
});

export const RETURN_VIEWS = ["open", "requested", "approved", "received", "closed", "all"] as const;
export type ReturnView = (typeof RETURN_VIEWS)[number];

export const returnFiltersSchema = z.object({
  view: z.enum(RETURN_VIEWS).catch("open"),
  search: z.string().trim().max(80).optional().catch(undefined),
  page: pageParam,
});

export type ReturnFilters = z.infer<typeof returnFiltersSchema>;
