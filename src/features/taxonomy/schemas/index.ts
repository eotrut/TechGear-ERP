import { z } from "zod";

/**
 * Categories and brands. Small enough to share a feature folder, and they are
 * always edited together in practice: a new brand usually arrives with the
 * product that needed it.
 */

const plainText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(2, `${label} needs at least two characters.`)
    .max(max, `${label} is too long.`)
    .refine((value) => !/[–—]/.test(value), {
      message: "Use a plain hyphen rather than an en dash or em dash.",
    });

export const categorySchema = z.object({
  id: z.string().trim().optional(),
  name: plainText("A category name", 60),
  description: z.string().trim().max(240),
  /** Empty string means top level. */
  parentId: z.string().trim(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export const brandSchema = z.object({
  id: z.string().trim().optional(),
  name: plainText("A brand name", 60),
  website: z
    .string()
    .trim()
    .max(200)
    .refine((value) => value === "" || /^https?:\/\/\S+$/.test(value), {
      message: "A website starts with http:// or https://",
    }),
});

export const deleteTaxonomySchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(["category", "brand"]),
});

export type CategoryInput = z.infer<typeof categorySchema>;
export type BrandInput = z.infer<typeof brandSchema>;
