import { z } from "zod";

import { isPesoInput } from "@/lib/money";
import { optionalPeso, pageParam, text } from "@/lib/validation";

/** Promo code schemas, shared by the editor dialog and its server action. */

export const PROMO_TYPES = ["PERCENT", "FIXED"] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const optionalCount = z
  .string()
  .trim()
  .refine((value) => value === "" || (/^\d{1,6}$/.test(value) && Number(value) > 0), {
    message: "A whole number above zero, or leave it blank for no limit.",
  });

export const promoFormSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,24}$/, "4 to 24 letters and digits, no spaces."),
    description: text(120, { min: 3, required: "Say what the promo is for." }),
    type: z.enum(PROMO_TYPES),
    /** Percent ("15", "12.5") for PERCENT, pesos for FIXED. */
    value: z.string().trim().min(1, "Enter the discount.").max(16),
    minSubtotal: optionalPeso,
    startsOn: z.string().regex(DATE, "Pick a start date."),
    endsOn: z.string().regex(DATE, "Pick an end date."),
    usageLimit: optionalCount,
    perCustomerLimit: optionalCount,
    isActive: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "PERCENT") {
      const match = /^(\d{1,2})(\.\d{1,2})?$/.exec(value.value);
      const pct = Number(value.value);
      if (!match || pct <= 0 || pct >= 100) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "A percentage above 0 and below 100.",
        });
      }
    } else if (!isPesoInput(value.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter an amount in pesos, such as 500.",
      });
    }
    if (value.endsOn < value.startsOn) {
      ctx.addIssue({
        code: "custom",
        path: ["endsOn"],
        message: "The promo has to end on or after the day it starts.",
      });
    }
  });

export type PromoFormValues = z.infer<typeof promoFormSchema>;

export const updatePromoSchema = z.object({
  promoId: z.string().trim().min(1).max(64),
  values: promoFormSchema,
});

export const promoToggleSchema = z.object({
  promoId: z.string().trim().min(1).max(64),
  isActive: z.boolean(),
});

export const PROMO_VIEWS = ["all", "active", "scheduled", "expired", "inactive"] as const;
export type PromoView = (typeof PROMO_VIEWS)[number];

export const promoFiltersSchema = z.object({
  view: z.enum(PROMO_VIEWS).catch("all"),
  page: pageParam,
});
