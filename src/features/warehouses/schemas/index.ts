import { z } from "zod";

/**
 * Warehouses. Every stock movement names one, so the only destructive
 * operation offered is deactivation: an inactive warehouse stops appearing in
 * pickers while its ledger history stays intact.
 */

export const warehouseSchema = z.object({
  id: z.string().trim().optional(),
  code: z
    .string()
    .trim()
    .min(3, "A warehouse code needs at least three characters.")
    .max(16)
    .regex(/^[A-Z0-9-]+$/, "Codes are uppercase letters, numbers and hyphens, such as MNL-MAIN."),
  name: z
    .string()
    .trim()
    .min(3, "Name the warehouse.")
    .max(80)
    .refine((value) => !/[–—]/.test(value), {
      message: "Use a plain hyphen rather than an en dash or em dash.",
    }),
  city: z.string().trim().max(60),
  province: z.string().trim().max(60),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});

export type WarehouseInput = z.infer<typeof warehouseSchema>;
