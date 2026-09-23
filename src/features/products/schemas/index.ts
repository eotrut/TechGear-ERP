import { z } from "zod";

import { isPesoInput } from "@/lib/money";

/**
 * Zod is the source of truth for the catalogue. The same schemas validate the
 * React Hook Form on the client and the payload the server action receives,
 * so a field cannot drift between the two.
 *
 * Money arrives as typed text ("4,190.00") rather than a number, because a
 * float is never allowed to touch a price. `parsePesoInput` converts it to
 * centavos once, in the service layer.
 */

export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const STOCK_STATUSES = ["in", "low", "out"] as const;
export const PRODUCT_SORTS = ["name", "sku", "price", "stock", "updated", "category"] as const;

export type StockStatus = (typeof STOCK_STATUSES)[number];
export type ProductSort = (typeof PRODUCT_SORTS)[number];

const money = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .refine(isPesoInput, {
      message: `${label} must be an amount in pesos, such as 4190.00`,
    });

const optionalMoney = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || isPesoInput(value), {
      message: `${label} must be an amount in pesos, such as 4190.00`,
    });

/**
 * Numbers stay numbers rather than coerced strings: the product form registers
 * these with `valueAsNumber`, so the schema's input and output types match and
 * React Hook Form can be typed off the schema directly.
 */
const wholeNumber = (label: string, max = 1_000_000) =>
  z
    .number({ message: `${label} must be a whole number.` })
    .int(`${label} must be a whole number.`)
    .min(0, `${label} cannot be negative.`)
    .max(max, `${label} is implausibly large.`);

/** No dashes of any kind in user-visible copy, per the anti-slop checklist. */
const noDashes = (value: string) => !/[–—]/.test(value);
const dashMessage = "Use a plain hyphen rather than an en dash or em dash.";

export const specSchema = z.object({
  key: z.string().trim().min(1, "Name the spec.").max(40).refine(noDashes, dashMessage),
  value: z.string().trim().min(1, "Give the spec a value.").max(120).refine(noDashes, dashMessage),
});

export const imageSchema = z.object({
  url: z.string().trim().min(1, "An image needs a path.").max(400),
  alt: z.string().trim().min(1, "Describe the image for screen readers.").max(160),
});

export const variantAttributeSchema = z.object({
  name: z.string().trim().min(1).max(30),
  value: z.string().trim().min(1).max(60),
});

export const variantSchema = z.object({
  /** Present when editing an existing row, absent when the row is new. */
  id: z.string().trim().optional(),
  optionSummary: z
    .string()
    .trim()
    .min(1, "Name the option, for example Black / Brown / TKL.")
    .max(80)
    .refine(noDashes, dashMessage),
  sku: z
    .string()
    .trim()
    .min(3, "A SKU needs at least three characters.")
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, "SKUs use letters, numbers, dots, hyphens and underscores."),
  /** Blank is allowed: plenty of keycap sets never carry one. */
  barcode: z
    .string()
    .trim()
    .max(32)
    .regex(/^[0-9]*$/, "A barcode is digits only."),
  price: money("Price"),
  compareAt: optionalMoney("Compare-at price"),
  cost: money("Cost"),
  reorderLevel: wholeNumber("Reorder level", 100_000),
  reorderQty: wholeNumber("Reorder quantity", 100_000),
  weightGrams: wholeNumber("Weight", 500_000),
  warrantyMonths: wholeNumber("Warranty", 120),
  isActive: z.boolean(),
  attributes: z.array(variantAttributeSchema).max(4),
});

export const productFormSchema = z.object({
  name: z.string().trim().min(3, "Give the product a name.").max(120).refine(noDashes, dashMessage),
  description: z.string().trim().max(2000).refine(noDashes, dashMessage),
  categoryId: z.string().trim().min(1, "Pick a category."),
  brandId: z.string().trim().min(1, "Pick a brand."),
  status: z.enum(PRODUCT_STATUSES),
  /** Typed as one comma separated field, split by the service. */
  tags: z.string().trim().max(200),
  specs: z.array(specSchema).max(20),
  images: z.array(imageSchema).max(8),
  variants: z
    .array(variantSchema)
    .min(1, "A product needs at least one variant.")
    .max(40)
    .superRefine((variants, ctx) => {
      const seen = new Set<string>();
      variants.forEach((variant, index) => {
        const sku = variant.sku.toUpperCase();
        if (seen.has(sku)) {
          ctx.addIssue({
            code: "custom",
            path: [index, "sku"],
            message: "This SKU is already used by another variant on this product.",
          });
        }
        seen.add(sku);
      });
    }),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;
export type VariantFormValues = z.infer<typeof variantSchema>;

export const createProductSchema = productFormSchema;
export const updateProductSchema = productFormSchema.extend({
  productId: z.string().trim().min(1),
});

export const setProductStatusSchema = z.object({
  productId: z.string().trim().min(1),
  status: z.enum(PRODUCT_STATUSES),
});

export const archiveProductSchema = z.object({
  productId: z.string().trim().min(1),
  /** False restores a previously archived product. */
  archived: z.boolean(),
});

/* -------------------------------------------------------------- bulk price */

export const BULK_PRICE_MODES = ["percent", "amount", "set"] as const;
export const BULK_PRICE_ROUNDING = ["none", "peso", "nearest5", "charm"] as const;

export type BulkPriceMode = (typeof BULK_PRICE_MODES)[number];
export type BulkPriceRounding = (typeof BULK_PRICE_ROUNDING)[number];

export const bulkPriceSchema = z
  .object({
    productIds: z.array(z.string().trim().min(1)).min(1, "Select at least one product."),
    mode: z.enum(BULK_PRICE_MODES),
    /** Percent for "percent", pesos for "amount" and "set". Signed for the first two. */
    value: z.string().trim().min(1, "Enter an amount."),
    rounding: z.enum(BULK_PRICE_ROUNDING),
    /** Guard against a fat-fingered percentage wiping out a price list. */
    confirm: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.mode === "percent") {
      const percent = Number(input.value);
      if (!Number.isFinite(percent)) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Enter a percentage, such as 5 or -10.",
        });
      } else if (Math.abs(percent) > 90) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Changes beyond 90 percent are almost always a typo.",
        });
      }
      return;
    }
    if (!isPesoInput(input.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Enter an amount in pesos." });
    }
  });

export type BulkPriceInput = z.infer<typeof bulkPriceSchema>;

/* ------------------------------------------------------------------ import */

export const importProductsSchema = z.object({
  csv: z.string().min(1, "Paste or upload a CSV first."),
  /** A dry run reports what would change and writes nothing. */
  commit: z.boolean(),
});

/* ------------------------------------------------------------------ filters */

/** Parsed from the URL, so every value arrives as a string or is absent. */
export const productFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().trim().optional(),
  brandId: z.string().trim().optional(),
  stock: z.enum(STOCK_STATUSES).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  minPrice: z.string().trim().optional(),
  maxPrice: z.string().trim().optional(),
  sort: z.enum(PRODUCT_SORTS).default("updated"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export type ProductFilters = z.infer<typeof productFiltersSchema>;
