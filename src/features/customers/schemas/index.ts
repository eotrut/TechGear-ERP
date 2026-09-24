import { z } from "zod";

import { SALES_CHANNELS } from "@/lib/channels";
import { parsePesoInput } from "@/lib/money";
import {
  optionalEmail,
  optionalPeso,
  optionalPhone,
  pageParam,
  requiredId,
  text,
} from "@/lib/validation";

import { SEGMENTS } from "../services/segment-rules";

/**
 * Customer schemas. The form works in strings (a credit limit is typed, tags
 * are a comma list) and the service turns them into columns, so the same
 * schema validates the browser form and the server action.
 */

export const CUSTOMER_TYPES = ["INDIVIDUAL", "BUSINESS"] as const;
export type CustomerTypeValue = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABEL: Record<CustomerTypeValue, string> = {
  INDIVIDUAL: "Individual",
  BUSINESS: "Business",
};

/** TIN as printed on a BIR certificate: 123-456-789, with an optional branch code. */
const TIN = /^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/;

export const addressSchema = z.object({
  line1: text(160, { min: 3, required: "Enter the house number, building and street." }),
  line2: text(160),
  barangay: text(80, { min: 2, required: "Enter the barangay." }),
  city: text(80, { min: 2, required: "Choose a city or municipality." }),
  province: text(80, { min: 2, required: "Choose a province." }),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Philippine postal codes have four digits."),
});

export type AddressInput = z.infer<typeof addressSchema>;

export const customerFormSchema = z
  .object({
    type: z.enum(CUSTOMER_TYPES),
    firstName: text(60),
    lastName: text(60),
    companyName: text(120),
    taxId: z
      .string()
      .trim()
      .refine((value) => value === "" || TIN.test(value), {
        message: "Write the TIN as 123-456-789 or 123-456-789-000.",
      }),
    email: optionalEmail,
    phone: optionalPhone,
    sourceChannel: z.union([z.enum(SALES_CHANNELS), z.literal("")]),
    tags: text(200),
    facebookHandle: text(80),
    instagramHandle: text(80),
    notes: text(1000),
    creditLimit: optionalPeso.refine((value) => (parsePesoInput(value) ?? 0) >= 0, {
      message: "A credit limit cannot be negative.",
    }),
    address: addressSchema,
  })
  .superRefine((value, ctx) => {
    if (value.type === "INDIVIDUAL") {
      if (value.firstName === "") {
        ctx.addIssue({ code: "custom", path: ["firstName"], message: "Enter a first name." });
      }
      if (value.lastName === "") {
        ctx.addIssue({ code: "custom", path: ["lastName"], message: "Enter a last name." });
      }
    } else if (value.companyName.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["companyName"],
        message: "Enter the registered business name.",
      });
    }
    if (value.email === "" && value.phone === "") {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Give at least a phone number or an email, so somebody can reach them.",
      });
    }
  });

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const updateCustomerSchema = z.object({
  customerId: requiredId("Missing customer."),
  values: customerFormSchema,
});

export const customerIdSchema = z.object({ customerId: requiredId("Missing customer.") });

export const customerSearchSchema = z.object({ query: z.string().trim().max(80) });

// ------------------------------------------------------------------- filters

export const CUSTOMER_SORTS = ["name", "ltv", "orders", "lastOrder", "created"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export const customerFiltersSchema = z.object({
  search: z.string().trim().max(80).optional().catch(undefined),
  segment: z.enum(SEGMENTS).optional().catch(undefined),
  type: z.enum(CUSTOMER_TYPES).optional().catch(undefined),
  channel: z.enum(SALES_CHANNELS).optional().catch(undefined),
  province: z.string().trim().max(80).optional().catch(undefined),
  sort: z.enum(CUSTOMER_SORTS).catch("ltv"),
  dir: z.enum(["asc", "desc"]).catch("desc"),
  page: pageParam,
});

export type CustomerFilters = z.infer<typeof customerFiltersSchema>;
