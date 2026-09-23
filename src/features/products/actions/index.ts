"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatPeso, parsePesoInput } from "@/lib/money";
import { authorizeAction } from "@/lib/rbac/guard";
import { uniqueSlug } from "@/lib/slug";

import {
  archiveProductSchema,
  bulkPriceSchema,
  createProductSchema,
  importProductsSchema,
  updateProductSchema,
} from "../schemas";
import { importContext, variantsForProducts } from "../queries";
import { percentToBps, planPriceChanges, type BulkPriceRule } from "../services/pricing";
import { planImport, type ImportPlan } from "../services/csv";
import {
  CatalogueConflictError,
  createProduct,
  setProductArchived,
  updateProduct,
} from "../services/product-service";

/**
 * Catalogue mutations.
 *
 * Every entry point authorizes against the live user record, validates with
 * the same Zod schema the form uses, does its writing inside one transaction
 * together with the audit entry, and then revalidates. Nothing here trusts
 * that the UI hid a button.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof CatalogueConflictError) return { ok: false, error: error.message };
  console.error("Catalogue action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

export async function createProductAction(input: unknown): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("products.create");

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  try {
    const created = await db.$transaction(async (tx) => {
      const product = await createProduct(tx, parsed.data);

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Product",
        entityId: product.id,
        summary: `Created product ${product.name} with ${product.variantCount} variant${
          product.variantCount === 1 ? "" : "s"
        }.`,
        changes: {
          name: { from: null, to: product.name },
          status: { from: null, to: parsed.data.status },
        },
        tx,
      });

      return product;
    });

    revalidatePath("/products");
    return { ok: true, message: `${created.name} is in the catalogue.`, id: created.id };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProductAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("products.update");

  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { productId, ...values } = parsed.data;

  try {
    const summary = await db.$transaction(async (tx) => {
      const result = await updateProduct(tx, productId, values);

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        // A price move is the change people come to the audit log looking for,
        // so it is labelled as one rather than buried under a generic update.
        action: result.priceChanges.length > 0 ? "PRICE_CHANGE" : "UPDATE",
        entityType: "Product",
        entityId: productId,
        summary:
          result.priceChanges.length > 0
            ? `Updated ${result.name} and changed ${result.priceChanges.length} price${
                result.priceChanges.length === 1 ? "" : "s"
              }.`
            : `Updated ${result.name}.`,
        changes: Object.fromEntries(
          result.priceChanges.map((change) => [
            `price ${change.sku}`,
            { from: formatPeso(change.from), to: formatPeso(change.to) },
          ]),
        ),
        tx,
      });

      return result;
    });

    revalidatePath("/products");
    revalidatePath(`/products/${productId}`);
    return {
      ok: true,
      message:
        summary.variantsArchived > 0
          ? `Saved. ${summary.variantsArchived} variant${
              summary.variantsArchived === 1 ? " was" : "s were"
            } archived.`
          : "Saved.",
    };
  } catch (error) {
    return fail(error);
  }
}

export async function archiveProductAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("products.archive");

  const parsed = archiveProductSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not read that request." };

  try {
    const product = await db.$transaction(async (tx) => {
      const record = await setProductArchived(tx, parsed.data.productId, parsed.data.archived);

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: parsed.data.archived ? "DELETE" : "UPDATE",
        entityType: "Product",
        entityId: record.id,
        summary: parsed.data.archived
          ? `Archived product ${record.name}.`
          : `Restored product ${record.name}.`,
        changes: { archived: { from: !parsed.data.archived, to: parsed.data.archived } },
        tx,
      });

      return record;
    });

    revalidatePath("/products");
    revalidatePath(`/products/${parsed.data.productId}`);
    return {
      ok: true,
      message: parsed.data.archived
        ? `${product.name} is archived and hidden from the catalogue.`
        : `${product.name} is back in the catalogue.`,
    };
  } catch (error) {
    return fail(error);
  }
}

/* -------------------------------------------------------------- bulk price */

export type BulkPricePreview = {
  ok: true;
  changes: { sku: string; product: string; option: string; from: number; to: number }[];
  unchanged: number;
};

function ruleFrom(input: { mode: string; value: string; rounding: string }): BulkPriceRule | null {
  const rounding = input.rounding as BulkPriceRule["rounding"];

  if (input.mode === "percent") {
    const percent = Number(input.value);
    if (!Number.isFinite(percent)) return null;
    return { mode: "percent", amount: percentToBps(percent), rounding };
  }

  const centavos = parsePesoInput(input.value);
  if (centavos === null) return null;
  return { mode: input.mode === "set" ? "set" : "amount", amount: centavos, rounding };
}

/** What the change would do. Reads only, so Sales can never reach it either. */
export async function previewBulkPriceAction(
  input: unknown,
): Promise<BulkPricePreview | { ok: false; error: string }> {
  await authorizeAction("products.bulkPrice");

  const parsed = bulkPriceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values and retry." };
  }

  const rule = ruleFrom(parsed.data);
  if (!rule) return { ok: false, error: "That is not an amount this can apply." };

  const variants = await variantsForProducts(parsed.data.productIds);
  const changes = planPriceChanges(variants, rule);

  return {
    ok: true,
    changes: changes.slice(0, 200).map((change) => ({
      sku: change.variant.sku,
      product: change.variant.product.name,
      option: change.variant.optionSummary,
      from: change.from,
      to: change.to,
    })),
    unchanged: variants.length - changes.length,
  };
}

export async function applyBulkPriceAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("products.bulkPrice");

  const parsed = bulkPriceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values and retry." };
  }

  const rule = ruleFrom(parsed.data);
  if (!rule) return { ok: false, error: "That is not an amount this can apply." };

  const variants = await variantsForProducts(parsed.data.productIds);
  const changes = planPriceChanges(variants, rule);

  if (changes.length === 0) {
    return { ok: false, error: "That rule leaves every selected price exactly where it is." };
  }

  try {
    await db.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.productVariant.update({
          where: { id: change.variant.id },
          data: { priceCentavos: change.to },
        });
      }

      // One entry per variant: a price is the unit anyone later audits, and
      // "47 prices changed" with no values is not an audit trail.
      for (const change of changes) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "PRICE_CHANGE",
          entityType: "ProductVariant",
          entityId: change.variant.id,
          summary: `Bulk price update moved ${change.variant.sku} from ${formatPeso(
            change.from,
          )} to ${formatPeso(change.to)}.`,
          changes: { price: { from: formatPeso(change.from), to: formatPeso(change.to) } },
          tx,
        });
      }
    });

    revalidatePath("/products");
    return {
      ok: true,
      message: `Updated ${changes.length} price${changes.length === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

/* ------------------------------------------------------------------ import */

export type ImportResult =
  | { ok: true; plan: ImportPlan; committed: boolean; message: string }
  | { ok: false; error: string };

/**
 * Dry run and commit share one entry point so the plan that gets applied is
 * computed by the same code that produced the preview, against context read
 * at the moment of the write rather than whatever the browser remembered.
 */
export async function importProductsAction(input: unknown): Promise<ImportResult> {
  const { user } = await authorizeAction("products.import");

  const parsed = importProductsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the file and try again." };
  }

  const context = await importContext();
  const plan = planImport(parsed.data.csv, context);

  if (plan.missingHeaders.length > 0) {
    return {
      ok: false,
      error: `The file is missing the ${plan.missingHeaders.join(" and ")} column${
        plan.missingHeaders.length === 1 ? "" : "s"
      }.`,
    };
  }

  if (plan.rows.length === 0) {
    return { ok: false, error: "That file has a header but no rows." };
  }

  if (!parsed.data.commit) {
    return {
      ok: true,
      plan,
      committed: false,
      message: `${plan.rows.length} row${plan.rows.length === 1 ? "" : "s"} read. Nothing written yet.`,
    };
  }

  if (plan.counts.error > 0) {
    return {
      ok: false,
      error: `Fix the ${plan.counts.error} row${
        plan.counts.error === 1 ? "" : "s"
      } with errors before importing.`,
    };
  }

  const applied = plan.rows.filter((row) => row.action !== "unchanged" && row.values !== null);
  if (applied.length === 0) {
    return { ok: false, error: "Every row in that file already matches the catalogue." };
  }

  try {
    await db.$transaction(
      async (tx) => {
        const slugs = new Set(
          (await tx.product.findMany({ select: { slug: true } })).map((row) => row.slug),
        );
        const productIdsByName = new Map(context.productIdsByName);

        for (const row of applied) {
          const values = row.values;
          if (!values) continue;

          const variantData = {
            name: values.variantName,
            optionSummary: values.variantName,
            sku: values.sku,
            barcode: values.barcode,
            priceCentavos: values.priceCentavos,
            lastCostCentavos: values.lastCostCentavos,
            reorderLevel: values.reorderLevel,
            reorderQty: values.reorderQty,
            warrantyMonths: values.warrantyMonths,
            isActive: values.isActive,
          };

          if (row.action === "update" && row.variantId) {
            await tx.productVariant.update({ where: { id: row.variantId }, data: variantData });
            continue;
          }

          const key = values.productName.trim().toLowerCase().replace(/\s+/g, " ");
          const existingProductId = productIdsByName.get(key);

          if (existingProductId) {
            await tx.productVariant.create({
              data: {
                productId: existingProductId,
                ...variantData,
                // No receipts yet, so the stated cost opens the average.
                avgCostCentavos: values.lastCostCentavos,
              },
            });
            continue;
          }

          const categoryId = context.categoryIdsByName.get(
            values.categoryName.trim().toLowerCase().replace(/\s+/g, " "),
          );
          const brandId = context.brandIdsByName.get(
            values.brandName.trim().toLowerCase().replace(/\s+/g, " "),
          );
          if (!categoryId || !brandId) {
            throw new CatalogueConflictError(
              `Line ${row.line}: the category or brand disappeared while importing.`,
            );
          }

          const slug = uniqueSlug(values.productName, slugs);
          slugs.add(slug);

          const product = await tx.product.create({
            data: {
              name: values.productName,
              slug,
              description: "",
              status: "ACTIVE",
              categoryId,
              brandId,
              variants: { create: { ...variantData, avgCostCentavos: values.lastCostCentavos } },
            },
            select: { id: true },
          });
          productIdsByName.set(key, product.id);
        }

        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entityType: "Product",
          summary: `CSV import: ${plan.counts["create-product"]} new product${
            plan.counts["create-product"] === 1 ? "" : "s"
          }, ${plan.counts["create-variant"]} new variant${
            plan.counts["create-variant"] === 1 ? "" : "s"
          }, ${plan.counts.update} updated, ${plan.counts.unchanged} unchanged.`,
          changes: {
            rows: { from: null, to: applied.length },
          },
          tx,
        });
      },
      // Bulk files are slower than the default 5 second interactive limit.
      { timeout: 30_000 },
    );
  } catch (error) {
    return fail(error);
  }

  revalidatePath("/products");
  return {
    ok: true,
    plan,
    committed: true,
    message: `Imported ${applied.length} row${applied.length === 1 ? "" : "s"}.`,
  };
}
