import type { Prisma } from "@prisma/client";

import { parsePesoInput } from "@/lib/money";
import { uniqueSlug } from "@/lib/slug";

import type { ProductFormValues, VariantFormValues } from "../schemas";

/**
 * Catalogue writes. No `next/headers`, no `auth()`: this layer is callable
 * from a server action, from a script and from a unit test alike, and it
 * always runs inside a transaction the caller owns.
 *
 * Two rules it enforces that the schema cannot:
 *
 *  - SKUs and barcodes are unique across the whole catalogue, not just within
 *    one product, because the POS looks a variant up by either of them.
 *  - A variant removed from the form is archived, never deleted. Order items,
 *    stock movements and purchase order lines point at it forever, and the
 *    ledger is append-only truth.
 */

export class CatalogueConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogueConflictError";
  }
}

export function splitTags(tags: string): string[] {
  return [
    ...new Set(
      tags
        .split(/[,\n]/)
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag !== ""),
    ),
  ].slice(0, 12);
}

function centavos(value: string): number {
  const parsed = parsePesoInput(value);
  if (parsed === null) throw new CatalogueConflictError(`"${value}" is not a peso amount.`);
  return parsed;
}

function optionalCentavos(value: string): number | null {
  if (value.trim() === "") return null;
  return centavos(value);
}

/** Barcodes are unique but optional, and "" must become null, not a clash. */
function normaliseBarcode(value: string): string | null {
  const text = value.trim();
  return text === "" ? null : text;
}

async function assertSkusAreFree(
  tx: Prisma.TransactionClient,
  variants: readonly VariantFormValues[],
  productId: string | null,
): Promise<void> {
  const skus = variants.map((variant) => variant.sku.trim());
  const barcodes = variants
    .map((variant) => normaliseBarcode(variant.barcode))
    .filter((barcode): barcode is string => barcode !== null);

  const clashes = await tx.productVariant.findMany({
    where: {
      OR: [{ sku: { in: skus } }, ...(barcodes.length > 0 ? [{ barcode: { in: barcodes } }] : [])],
      ...(productId ? { productId: { not: productId } } : {}),
    },
    select: { sku: true, barcode: true, product: { select: { name: true } } },
    take: 5,
  });

  const clash = clashes[0];
  if (clash) {
    const conflicting = skus.includes(clash.sku) ? `SKU ${clash.sku}` : `barcode ${clash.barcode}`;
    throw new CatalogueConflictError(`${conflicting} already belongs to ${clash.product.name}.`);
  }
}

async function reserveSlug(
  tx: Prisma.TransactionClient,
  name: string,
  currentId: string | null,
): Promise<string> {
  const taken = await tx.product.findMany({
    where: currentId ? { id: { not: currentId } } : {},
    select: { slug: true },
  });
  return uniqueSlug(
    name,
    taken.map((row) => row.slug),
  );
}

function variantCreateData(variant: VariantFormValues) {
  const cost = centavos(variant.cost);
  return {
    name: variant.optionSummary,
    optionSummary: variant.optionSummary,
    sku: variant.sku.trim(),
    barcode: normaliseBarcode(variant.barcode),
    priceCentavos: centavos(variant.price),
    compareAtCentavos: optionalCentavos(variant.compareAt),
    // A brand new variant has no receipts, so the entered cost is both the
    // last cost and the opening average. Receiving takes over from there.
    lastCostCentavos: cost,
    avgCostCentavos: cost,
    reorderLevel: variant.reorderLevel,
    reorderQty: variant.reorderQty,
    weightGrams: variant.weightGrams > 0 ? variant.weightGrams : null,
    warrantyMonths: variant.warrantyMonths,
    isActive: variant.isActive,
    attributes: {
      create: variant.attributes.map((attribute, position) => ({
        name: attribute.name,
        value: attribute.value,
        sortOrder: position,
      })),
    },
  };
}

export type CreatedProduct = { id: string; name: string; slug: string; variantCount: number };

export async function createProduct(
  tx: Prisma.TransactionClient,
  input: ProductFormValues,
): Promise<CreatedProduct> {
  await assertSkusAreFree(tx, input.variants, null);
  const slug = await reserveSlug(tx, input.name, null);

  const product = await tx.product.create({
    data: {
      name: input.name,
      slug,
      description: input.description,
      status: input.status,
      categoryId: input.categoryId,
      brandId: input.brandId,
      tags: splitTags(input.tags),
      specs: {
        create: input.specs.map((spec, index) => ({
          key: spec.key,
          value: spec.value,
          sortOrder: index,
        })),
      },
      images: {
        create: input.images.map((image, index) => ({
          url: image.url,
          alt: image.alt,
          sortOrder: index,
          isPrimary: index === 0,
        })),
      },
      variants: {
        create: input.variants.map(variantCreateData),
      },
    },
    select: { id: true, name: true, slug: true },
  });

  return { ...product, variantCount: input.variants.length };
}

export type ProductUpdateSummary = {
  id: string;
  name: string;
  variantsCreated: number;
  variantsUpdated: number;
  variantsArchived: number;
  priceChanges: { sku: string; from: number; to: number }[];
};

export async function updateProduct(
  tx: Prisma.TransactionClient,
  productId: string,
  input: ProductFormValues,
): Promise<ProductUpdateSummary> {
  const existing = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      variants: {
        where: { deletedAt: null },
        select: { id: true, sku: true, priceCentavos: true, avgCostCentavos: true },
      },
    },
  });
  if (!existing) throw new CatalogueConflictError("That product no longer exists.");

  await assertSkusAreFree(tx, input.variants, productId);

  const slug = await reserveSlug(tx, input.name, productId);

  await tx.product.update({
    where: { id: productId },
    data: {
      name: input.name,
      slug,
      description: input.description,
      status: input.status,
      categoryId: input.categoryId,
      brandId: input.brandId,
      tags: splitTags(input.tags),
    },
  });

  // Specs and images are small, ordered and owned outright by the product, so
  // replacing them wholesale is both simpler and closer to what the form means
  // than diffing rows that have no independent identity.
  await tx.productSpec.deleteMany({ where: { productId } });
  if (input.specs.length > 0) {
    await tx.productSpec.createMany({
      data: input.specs.map((spec, index) => ({
        productId,
        key: spec.key,
        value: spec.value,
        sortOrder: index,
      })),
    });
  }

  await tx.productImage.deleteMany({ where: { productId } });
  if (input.images.length > 0) {
    await tx.productImage.createMany({
      data: input.images.map((image, index) => ({
        productId,
        url: image.url,
        alt: image.alt,
        sortOrder: index,
        isPrimary: index === 0,
      })),
    });
  }

  const summary: ProductUpdateSummary = {
    id: productId,
    name: input.name,
    variantsCreated: 0,
    variantsUpdated: 0,
    variantsArchived: 0,
    priceChanges: [],
  };

  const keptIds = new Set<string>();

  for (const variant of input.variants) {
    const previous = variant.id
      ? existing.variants.find((candidate) => candidate.id === variant.id)
      : undefined;

    if (!previous) {
      await tx.productVariant.create({
        data: { productId, ...variantCreateData(variant) },
      });
      summary.variantsCreated += 1;
      continue;
    }

    keptIds.add(previous.id);

    const price = centavos(variant.price);
    const cost = centavos(variant.cost);

    await tx.productVariant.update({
      where: { id: previous.id },
      data: {
        name: variant.optionSummary,
        optionSummary: variant.optionSummary,
        sku: variant.sku.trim(),
        barcode: normaliseBarcode(variant.barcode),
        priceCentavos: price,
        compareAtCentavos: optionalCentavos(variant.compareAt),
        lastCostCentavos: cost,
        // The moving average belongs to the stock ledger once receiving has
        // touched it. Only an untouched variant takes its cost from the form.
        ...(previous.avgCostCentavos === 0 ? { avgCostCentavos: cost } : {}),
        reorderLevel: variant.reorderLevel,
        reorderQty: variant.reorderQty,
        weightGrams: variant.weightGrams > 0 ? variant.weightGrams : null,
        warrantyMonths: variant.warrantyMonths,
        isActive: variant.isActive,
        attributes: {
          deleteMany: {},
          create: variant.attributes.map((attribute, position) => ({
            name: attribute.name,
            value: attribute.value,
            sortOrder: position,
          })),
        },
      },
    });

    summary.variantsUpdated += 1;
    if (price !== previous.priceCentavos) {
      summary.priceChanges.push({ sku: variant.sku, from: previous.priceCentavos, to: price });
    }
  }

  const removed = existing.variants.filter((variant) => !keptIds.has(variant.id));
  if (removed.length > 0) {
    await tx.productVariant.updateMany({
      where: { id: { in: removed.map((variant) => variant.id) } },
      data: { deletedAt: new Date(), isActive: false },
    });
    summary.variantsArchived = removed.length;
  }

  return summary;
}

/**
 * Archive or restore.
 *
 * Archiving moves the product to ARCHIVED and stops its variants being sold.
 * It deliberately does NOT stamp `deletedAt`: the archived saved view has to
 * be able to find these rows, and every list filters `deletedAt IS NULL`.
 * `deletedAt` stays reserved for a record withdrawn altogether, which the
 * catalogue never does, because orders and stock movements point at it.
 */
export async function setProductArchived(
  tx: Prisma.TransactionClient,
  productId: string,
  archived: boolean,
): Promise<{ id: string; name: string }> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true },
  });
  if (!product) throw new CatalogueConflictError("That product no longer exists.");

  await tx.product.update({
    where: { id: productId },
    data: {
      status: archived ? "ARCHIVED" : "ACTIVE",
      // Clearing it on restore covers a row withdrawn by some earlier means.
      ...(archived ? {} : { deletedAt: null }),
    },
  });

  // Restoring leaves variants as they were: some were deliberately inactive
  // before the product was archived, and reviving those is not what restore
  // means.
  if (archived) {
    await tx.productVariant.updateMany({ where: { productId }, data: { isActive: false } });
  }

  return product;
}
