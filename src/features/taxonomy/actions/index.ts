"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit } from "@/lib/audit";
import { diffRecords } from "@/lib/audit-diff";
import { db } from "@/lib/db";
import { authorizeAction } from "@/lib/rbac/guard";
import { uniqueSlug } from "@/lib/slug";

import { brandSchema, categorySchema, deleteTaxonomySchema } from "../schemas";

/**
 * Category and brand mutations.
 *
 * Deleting either one is soft and refuses while products still point at it:
 * `Product.categoryId` is a Restrict foreign key, so a hard delete would fail
 * at the database anyway, and a clear message beats a constraint violation.
 */

function revalidate() {
  revalidatePath("/categories");
  revalidatePath("/brands");
  revalidatePath("/products");
}

export async function saveCategoryAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("taxonomy.manage");

  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { id, name, description, parentId, sortOrder } = parsed.data;

  if (id && parentId === id) {
    return { ok: false, error: "A category cannot sit inside itself." };
  }

  // Slugs are unique in the database including deleted rows, so every slug
  // counts. Names only clash with categories that still exist, otherwise
  // deleting one would reserve its name forever.
  const taken = await db.category.findMany({
    where: id ? { id: { not: id } } : {},
    select: { slug: true, name: true, deletedAt: true },
  });

  if (
    taken.some((row) => row.deletedAt === null && row.name.toLowerCase() === name.toLowerCase())
  ) {
    return { ok: false, error: `There is already a category called ${name}.` };
  }

  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.category.findUniqueOrThrow({
        where: { id },
        select: { id: true, name: true, description: true, parentId: true, sortOrder: true },
      });

      const after = await tx.category.update({
        where: { id },
        data: { name, description, parentId: parentId === "" ? null : parentId, sortOrder },
        select: { id: true, name: true, description: true, parentId: true, sortOrder: true },
      });

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Category",
        entityId: id,
        summary: `Updated category ${after.name}.`,
        changes: diffRecords(before, after),
        tx,
      });
      return;
    }

    const created = await tx.category.create({
      data: {
        name,
        slug: uniqueSlug(
          name,
          taken.map((row) => row.slug),
        ),
        description,
        parentId: parentId === "" ? null : parentId,
        sortOrder,
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "CREATE",
      entityType: "Category",
      entityId: created.id,
      summary: `Created category ${created.name}.`,
      changes: { name: { from: null, to: created.name } },
      tx,
    });
  });

  revalidate();
  return { ok: true, message: id ? "Category updated." : `${name} is ready to use.` };
}

export async function saveBrandAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("taxonomy.manage");

  const parsed = brandSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { id, name, website } = parsed.data;

  const taken = await db.brand.findMany({
    where: id ? { id: { not: id } } : {},
    select: { slug: true, name: true, deletedAt: true },
  });

  if (
    taken.some((row) => row.deletedAt === null && row.name.toLowerCase() === name.toLowerCase())
  ) {
    return { ok: false, error: `There is already a brand called ${name}.` };
  }

  await db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.brand.findUniqueOrThrow({
        where: { id },
        select: { id: true, name: true, website: true },
      });

      const after = await tx.brand.update({
        where: { id },
        data: { name, website: website === "" ? null : website },
        select: { id: true, name: true, website: true },
      });

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "UPDATE",
        entityType: "Brand",
        entityId: id,
        summary: `Updated brand ${after.name}.`,
        changes: diffRecords(before, after),
        tx,
      });
      return;
    }

    const created = await tx.brand.create({
      data: {
        name,
        slug: uniqueSlug(
          name,
          taken.map((row) => row.slug),
        ),
        website: website === "" ? null : website,
      },
      select: { id: true, name: true },
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "CREATE",
      entityType: "Brand",
      entityId: created.id,
      summary: `Created brand ${created.name}.`,
      changes: { name: { from: null, to: created.name } },
      tx,
    });
  });

  revalidate();
  return { ok: true, message: id ? "Brand updated." : `${name} is ready to use.` };
}

export async function deleteTaxonomyAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("taxonomy.delete");

  const parsed = deleteTaxonomySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not read that request." };

  const { id, kind } = parsed.data;

  if (kind === "category") {
    const category = await db.category.findUnique({
      where: { id },
      select: {
        name: true,
        _count: { select: { products: { where: { deletedAt: null } }, children: true } },
      },
    });
    if (!category) return { ok: false, error: "That category no longer exists." };
    if (category._count.products > 0) {
      return {
        ok: false,
        error: `${category.name} still holds ${category._count.products} product${
          category._count.products === 1 ? "" : "s"
        }. Move them first.`,
      };
    }
    if (category._count.children > 0) {
      return { ok: false, error: `${category.name} still has subcategories.` };
    }

    await db.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "DELETE",
        entityType: "Category",
        entityId: id,
        summary: `Deleted category ${category.name}.`,
        tx,
      });
    });

    revalidate();
    return { ok: true, message: `${category.name} is gone.` };
  }

  const brand = await db.brand.findUnique({
    where: { id },
    select: { name: true, _count: { select: { products: { where: { deletedAt: null } } } } },
  });
  if (!brand) return { ok: false, error: "That brand no longer exists." };
  if (brand._count.products > 0) {
    return {
      ok: false,
      error: `${brand.name} still has ${brand._count.products} product${
        brand._count.products === 1 ? "" : "s"
      }. Reassign them first.`,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.brand.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "DELETE",
      entityType: "Brand",
      entityId: id,
      summary: `Deleted brand ${brand.name}.`,
      tx,
    });
  });

  revalidate();
  return { ok: true, message: `${brand.name} is gone.` };
}
