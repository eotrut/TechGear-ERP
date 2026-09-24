import { z } from "zod";

import { SALES_CHANNELS } from "@/lib/channels";
import { parsePesoInput } from "@/lib/money";
import {
  optionalEmail,
  optionalId,
  optionalPhone,
  requiredId,
  requiredPeso,
  text,
} from "@/lib/validation";

import { LEAD_STAGES } from "../services/pipeline";

/** Lead schemas, shared by the board, the lead page and the server actions. */

const isoDate = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Pick a date.",
  });

export const leadFormSchema = z.object({
  title: text(120, { min: 3, required: "Say what the opportunity is, such as an office fitout." }),
  contactName: text(80, { min: 2, required: "Who is the contact?" }),
  company: text(120),
  email: optionalEmail,
  phone: optionalPhone,
  value: requiredPeso.refine((value) => (parsePesoInput(value) ?? 0) >= 0, {
    message: "A deal value cannot be negative.",
  }),
  probability: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{1,3}$/.test(value), {
      message: "A whole percentage, 0 to 100.",
    })
    .refine((value) => value === "" || Number(value) <= 100, {
      message: "A probability cannot exceed 100%.",
    }),
  source: z.union([z.enum(SALES_CHANNELS), z.literal("")]),
  expectedCloseDate: isoDate,
  ownerId: optionalId,
  customerId: optionalId,
});

export type LeadFormValues = z.infer<typeof leadFormSchema>;

export const updateLeadSchema = z.object({
  leadId: requiredId("Missing lead."),
  values: leadFormSchema,
});

export const leadIdSchema = z.object({ leadId: requiredId("Missing lead.") });

/**
 * A drop on the board. The client names the cards either side of where the
 * card landed, not a number: positions are the server's business, and the
 * neighbours are what the person actually saw.
 */
export const moveLeadSchema = z.object({
  leadId: requiredId("Missing lead."),
  toStage: z.enum(LEAD_STAGES),
  beforeId: z.string().trim().max(64).nullable(),
  afterId: z.string().trim().max(64).nullable(),
  lostReason: text(300).optional(),
});

export type MoveLeadInput = z.infer<typeof moveLeadSchema>;

export const markLostSchema = z.object({
  leadId: requiredId("Missing lead."),
  reason: text(300, {
    min: 3,
    required: "Say why it was lost. It is what the next quote learns from.",
  }),
});

export const reassignLeadSchema = z.object({
  leadId: requiredId("Missing lead."),
  ownerId: requiredId("Choose an owner."),
});

export const convertLeadSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    leadId: requiredId("Missing lead."),
    customerId: requiredId("Choose the customer this lead belongs to."),
  }),
  z
    .object({
      mode: z.literal("new"),
      leadId: requiredId("Missing lead."),
      type: z.enum(["INDIVIDUAL", "BUSINESS"]),
      firstName: text(60),
      lastName: text(60),
      companyName: text(120),
      email: optionalEmail,
      phone: optionalPhone,
    })
    .superRefine((value, ctx) => {
      if (value.type === "BUSINESS" && value.companyName.length < 2) {
        ctx.addIssue({
          code: "custom",
          path: ["companyName"],
          message: "Enter the business name.",
        });
      }
      if (value.type === "INDIVIDUAL" && (value.firstName === "" || value.lastName === "")) {
        ctx.addIssue({
          code: "custom",
          path: ["firstName"],
          message: "Enter a first and last name.",
        });
      }
      if (value.email === "" && value.phone === "") {
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Give at least a phone number or an email.",
        });
      }
    }),
]);

export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const leadBoardFiltersSchema = z.object({
  owner: z.string().trim().max(64).optional().catch(undefined),
  search: z.string().trim().max(80).optional().catch(undefined),
});

export type LeadBoardFilters = z.infer<typeof leadBoardFiltersSchema>;
