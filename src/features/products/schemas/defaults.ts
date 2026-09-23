import type { ProductFormValues, VariantFormValues } from "./index";

/**
 * Blank values for the create form.
 *
 * These live outside the form component on purpose. Everything exported from a
 * "use client" module reaches a server component as a client reference rather
 * than as the value itself, so a server page that spread these from there got
 * an object with none of these fields and rendered a form with no variant row.
 */

export const emptyVariant: VariantFormValues = {
  optionSummary: "Default",
  sku: "",
  barcode: "",
  price: "",
  compareAt: "",
  cost: "",
  reorderLevel: 0,
  reorderQty: 0,
  weightGrams: 0,
  warrantyMonths: 12,
  isActive: true,
  attributes: [],
};

export const emptyProduct: ProductFormValues = {
  name: "",
  description: "",
  categoryId: "",
  brandId: "",
  status: "DRAFT",
  tags: "",
  // No blank starter row: an empty spec is a validation error, and a form
  // that refuses to submit until you delete a row you never asked for is a
  // trap. The section's empty state offers "Add spec" instead.
  specs: [],
  images: [],
  variants: [emptyVariant],
};
