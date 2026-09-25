import { z } from "zod";

/**
 * Supplier directory: who they are, how long they quote to deliver, and on
 * what terms. On-time and defect rates are not on the form: they are measured
 * from deliveries by the receiving service (suppliers/services/performance.ts),
 * so nobody can type a supplier a better record than it earned.
 */

export const PAYMENT_TERMS = ["COD", "NET_7", "NET_15", "NET_30", "NET_60"] as const;

export const PAYMENT_TERMS_LABELS: Record<(typeof PAYMENT_TERMS)[number], string> = {
  COD: "Cash on delivery",
  NET_7: "Net 7 days",
  NET_15: "Net 15 days",
  NET_30: "Net 30 days",
  NET_60: "Net 60 days",
};

export const supplierSchema = z.object({
  id: z.string().trim().optional(),
  code: z
    .string()
    .trim()
    .min(2, "A supplier code needs at least two characters.")
    .max(16)
    .regex(/^[A-Z0-9-]+$/, "Codes are uppercase letters, numbers and hyphens."),
  name: z
    .string()
    .trim()
    .min(2, "Name the supplier.")
    .max(80)
    .refine((value) => !/[–—]/.test(value), {
      message: "Use a plain hyphen rather than an en dash or em dash.",
    }),
  contactName: z.string().trim().max(80),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((value) => value === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), {
      message: "That is not an email address.",
    }),
  phone: z.string().trim().max(32),
  leadTimeDays: z.coerce
    .number({ message: "Lead time must be a whole number of days." })
    .int("Lead time must be a whole number of days.")
    .min(0)
    .max(365),
  paymentTerms: z.enum(PAYMENT_TERMS),
  notes: z.string().trim().max(500),
  isActive: z.boolean(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;

export const deleteSupplierSchema = z.object({ id: z.string().trim().min(1) });
