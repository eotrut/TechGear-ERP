import { db } from "@/lib/db";

/** Category and brand reads. Both lists are small enough to fetch whole. */

export async function listCategories() {
  const categories = await db.category.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      sortOrder: true,
      parentId: true,
      parent: { select: { id: true, name: true } },
      _count: { select: { products: { where: { deletedAt: null } }, children: true } },
    },
  });

  return categories;
}

export type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];

export async function listBrands() {
  return db.brand.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      website: true,
      _count: { select: { products: { where: { deletedAt: null } } } },
    },
  });
}

export type BrandRow = Awaited<ReturnType<typeof listBrands>>[number];
