import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { parsePesoInput, toPesoInput } from "@/lib/money";
import { stockHealth, type StockHealth } from "@/lib/stock-math";

import type { ProductFilters, ProductFormValues } from "../schemas";
import type { ExportRow } from "../services/csv";

/**
 * Catalogue reads.
 *
 * The list is one SQL statement rather than a Prisma query plus per-row
 * lookups. It has to aggregate stock across every variant and warehouse,
 * filter on that aggregate, sort by it and paginate on the server, which is
 * exactly the shape Prisma's query API cannot express without pulling the
 * whole catalogue into memory first.
 *
 * Soft deletes are filtered explicitly here. The plan describes a client
 * extension that would do it globally; until that lands, every read in this
 * file names `deletedAt IS NULL` itself.
 */

export const PRODUCT_PAGE_SIZE = 25;

export type ProductListRow = {
  id: string;
  name: string;
  slug: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
  categoryName: string;
  brandName: string;
  imageUrl: string | null;
  imageAlt: string | null;
  variantCount: number;
  leadSku: string;
  minPriceCentavos: number;
  maxPriceCentavos: number;
  avgCostCentavos: number;
  marginBps: number | null;
  onHand: number;
  reorderTotal: number;
  stock: StockHealth;
  tags: string[];
};

type RawListRow = {
  id: string;
  name: string;
  slug: string;
  status: ProductListRow["status"];
  updatedAt: Date;
  tags: string[];
  category_name: string;
  brand_name: string;
  image_url: string | null;
  image_alt: string | null;
  variant_count: number;
  lead_sku: string | null;
  min_price: number | null;
  max_price: number | null;
  avg_cost: number | null;
  avg_margin_bps: number | null;
  on_hand: number | null;
  reorder_total: number | null;
  any_low: boolean | null;
};

/**
 * Per-variant totals across warehouses, then per-product rollups on top.
 * Declared once and reused by the page query and its count, so the two can
 * never disagree about what matches.
 */
const VARIANT_ROLLUP = Prisma.sql`
  WITH variant_stock AS (
    SELECT "variantId", SUM("onHand")::int AS on_hand
    FROM "StockLevel"
    GROUP BY "variantId"
  ),
  variant_agg AS (
    SELECT
      v."productId",
      COUNT(*)::int                                   AS variant_count,
      MIN(v.sku)                                      AS lead_sku,
      MIN(v."priceCentavos")::int                     AS min_price,
      MAX(v."priceCentavos")::int                     AS max_price,
      ROUND(AVG(v."avgCostCentavos"))::int            AS avg_cost,
      -- Margin is computed per variant and then averaged. Comparing the
      -- cheapest price against the average cost mixes two different variants
      -- and can invent a negative margin that nothing in the data supports.
      ROUND(AVG(
        CASE WHEN v."priceCentavos" > 0 AND v."avgCostCentavos" > 0
          THEN (v."priceCentavos" - v."avgCostCentavos")::numeric * 10000 / v."priceCentavos"
        END
      ))::int                                         AS avg_margin_bps,
      SUM(v."reorderLevel")::int                      AS reorder_total,
      COALESCE(SUM(vs.on_hand), 0)::int               AS on_hand,
      BOOL_OR(
        v."reorderLevel" > 0
        AND COALESCE(vs.on_hand, 0) > 0
        AND COALESCE(vs.on_hand, 0) <= v."reorderLevel"
      )                                               AS any_low
    FROM "ProductVariant" v
    LEFT JOIN variant_stock vs ON vs."variantId" = v.id
    WHERE v."deletedAt" IS NULL
    GROUP BY v."productId"
  )
`;

function buildConditions(filters: ProductFilters): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`];

  if (filters.status) {
    conditions.push(Prisma.sql`p.status = ${filters.status}::"ProductStatus"`);
  } else {
    // Archived products are out of the way unless they are asked for by name.
    conditions.push(Prisma.sql`p.status <> 'ARCHIVED'::"ProductStatus"`);
  }

  if (filters.categoryId) conditions.push(Prisma.sql`p."categoryId" = ${filters.categoryId}`);
  if (filters.brandId) conditions.push(Prisma.sql`p."brandId" = ${filters.brandId}`);

  if (filters.search) {
    const like = `%${filters.search}%`;
    conditions.push(Prisma.sql`(
      p.name ILIKE ${like}
      OR ${filters.search} = ANY(p.tags)
      OR EXISTS (
        SELECT 1 FROM "ProductVariant" sv
        WHERE sv."productId" = p.id
          AND sv."deletedAt" IS NULL
          AND (sv.sku ILIKE ${like} OR sv.barcode = ${filters.search})
      )
    )`);
  }

  const minPrice = filters.minPrice ? parsePesoInput(filters.minPrice) : null;
  const maxPrice = filters.maxPrice ? parsePesoInput(filters.maxPrice) : null;
  // A product matches a price band when any of its variants falls inside it.
  if (minPrice !== null) conditions.push(Prisma.sql`COALESCE(a.max_price, 0) >= ${minPrice}`);
  if (maxPrice !== null) conditions.push(Prisma.sql`COALESCE(a.min_price, 0) <= ${maxPrice}`);

  if (filters.stock === "out") conditions.push(Prisma.sql`COALESCE(a.on_hand, 0) = 0`);
  if (filters.stock === "low") {
    conditions.push(Prisma.sql`COALESCE(a.on_hand, 0) > 0 AND COALESCE(a.any_low, false)`);
  }
  if (filters.stock === "in") {
    conditions.push(Prisma.sql`COALESCE(a.on_hand, 0) > 0 AND NOT COALESCE(a.any_low, false)`);
  }

  return conditions;
}

/** Sort keys are whitelisted, never interpolated from the URL. */
function orderBy(filters: ProductFilters): Prisma.Sql {
  const direction = filters.dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

  switch (filters.sort) {
    case "name":
      return Prisma.sql`p.name ${direction}`;
    case "sku":
      return Prisma.sql`a.lead_sku ${direction} NULLS LAST`;
    case "price":
      return Prisma.sql`a.min_price ${direction} NULLS LAST`;
    case "stock":
      return Prisma.sql`a.on_hand ${direction} NULLS LAST`;
    case "category":
      return Prisma.sql`c.name ${direction}, p.name ASC`;
    case "updated":
    default:
      return Prisma.sql`p."updatedAt" ${direction}`;
  }
}

export type ProductListResult = {
  rows: ProductListRow[];
  total: number;
  page: number;
  pageCount: number;
};

export async function listProducts(filters: ProductFilters): Promise<ProductListResult> {
  const conditions = buildConditions(filters);
  const where = Prisma.join(conditions, " AND ");
  const page = Math.max(1, filters.page);
  const offset = (page - 1) * PRODUCT_PAGE_SIZE;

  const [rows, counted] = await Promise.all([
    db.$queryRaw<RawListRow[]>`
      ${VARIANT_ROLLUP}
      SELECT
        p.id, p.name, p.slug, p.status, p."updatedAt", p.tags,
        c.name AS category_name,
        b.name AS brand_name,
        img.url AS image_url,
        img.alt AS image_alt,
        a.variant_count, a.lead_sku, a.min_price, a.max_price,
        a.avg_cost, a.avg_margin_bps, a.on_hand, a.reorder_total, a.any_low
      FROM "Product" p
      JOIN "Category" c ON c.id = p."categoryId"
      JOIN "Brand" b ON b.id = p."brandId"
      LEFT JOIN variant_agg a ON a."productId" = p.id
      LEFT JOIN LATERAL (
        SELECT url, alt FROM "ProductImage"
        WHERE "productId" = p.id
        ORDER BY "isPrimary" DESC, "sortOrder" ASC
        LIMIT 1
      ) img ON TRUE
      WHERE ${where}
      ORDER BY ${orderBy(filters)}
      LIMIT ${PRODUCT_PAGE_SIZE} OFFSET ${offset}
    `,
    db.$queryRaw<{ total: bigint }[]>`
      ${VARIANT_ROLLUP}
      SELECT COUNT(*)::bigint AS total
      FROM "Product" p
      JOIN "Category" c ON c.id = p."categoryId"
      JOIN "Brand" b ON b.id = p."brandId"
      LEFT JOIN variant_agg a ON a."productId" = p.id
      WHERE ${where}
    `,
  ]);

  const total = Number(counted[0]?.total ?? 0);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      updatedAt: row.updatedAt,
      categoryName: row.category_name,
      brandName: row.brand_name,
      imageUrl: row.image_url,
      imageAlt: row.image_alt,
      variantCount: row.variant_count ?? 0,
      leadSku: row.lead_sku ?? "",
      minPriceCentavos: row.min_price ?? 0,
      maxPriceCentavos: row.max_price ?? 0,
      avgCostCentavos: row.avg_cost ?? 0,
      marginBps: row.avg_margin_bps,
      onHand: row.on_hand ?? 0,
      reorderTotal: row.reorder_total ?? 0,
      stock: row.any_low && (row.on_hand ?? 0) > 0 ? "low" : stockHealth(row.on_hand ?? 0, 0),
      tags: row.tags,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)),
  };
}

/** Category and brand pickers, with the counts that make them useful. */
export async function productFilterOptions() {
  const [categories, brands] = await Promise.all([
    db.category.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
      orderBy: { sortOrder: "asc" },
    }),
    db.brand.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    categories: categories.map((row) => ({
      id: row.id,
      name: row.name,
      count: row._count.products,
    })),
    brands: brands.map((row) => ({ id: row.id, name: row.name, count: row._count.products })),
  };
}

const PRODUCT_DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  tags: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true, website: true } },
  images: {
    select: { id: true, url: true, alt: true, isPrimary: true },
    orderBy: { sortOrder: "asc" },
  },
  specs: { select: { id: true, key: true, value: true }, orderBy: { sortOrder: "asc" } },
  variants: {
    where: { deletedAt: null },
    orderBy: { sku: "asc" },
    select: {
      id: true,
      optionSummary: true,
      sku: true,
      barcode: true,
      priceCentavos: true,
      compareAtCentavos: true,
      lastCostCentavos: true,
      avgCostCentavos: true,
      reorderLevel: true,
      reorderQty: true,
      weightGrams: true,
      warrantyMonths: true,
      isActive: true,
      attributes: { select: { name: true, value: true }, orderBy: { sortOrder: "asc" } },
      stockLevels: {
        select: {
          onHand: true,
          reserved: true,
          warehouse: { select: { id: true, code: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

export type ProductDetail = Prisma.ProductGetPayload<{ select: typeof PRODUCT_DETAIL_SELECT }>;

export async function getProductDetail(id: string): Promise<ProductDetail | null> {
  return db.product.findFirst({ where: { id }, select: PRODUCT_DETAIL_SELECT });
}

/** The same record, shaped as the form expects it. */
export async function getProductFormValues(
  id: string,
): Promise<{ values: ProductFormValues; name: string } | null> {
  const product = await getProductDetail(id);
  if (!product) return null;

  return {
    name: product.name,
    values: {
      name: product.name,
      description: product.description,
      categoryId: product.category.id,
      brandId: product.brand.id,
      status: product.status,
      tags: product.tags.join(", "),
      specs: product.specs.map((spec) => ({ key: spec.key, value: spec.value })),
      images: product.images.map((image) => ({ url: image.url, alt: image.alt })),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        optionSummary: variant.optionSummary,
        sku: variant.sku,
        barcode: variant.barcode ?? "",
        price: toPesoInput(variant.priceCentavos),
        compareAt: variant.compareAtCentavos === null ? "" : toPesoInput(variant.compareAtCentavos),
        cost: toPesoInput(variant.lastCostCentavos),
        reorderLevel: variant.reorderLevel,
        reorderQty: variant.reorderQty,
        weightGrams: variant.weightGrams ?? 0,
        warrantyMonths: variant.warrantyMonths,
        isActive: variant.isActive,
        attributes: variant.attributes.map((attribute) => ({
          name: attribute.name,
          value: attribute.value,
        })),
      })),
    },
  };
}

/** Category and brand options for the product form. */
export async function catalogueOptions() {
  const [categories, brands] = await Promise.all([
    db.category.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.brand.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { categories, brands };
}

/** Variants behind a set of products, for the bulk price preview and write. */
export async function variantsForProducts(productIds: readonly string[]) {
  return db.productVariant.findMany({
    where: { productId: { in: [...productIds] }, deletedAt: null },
    select: {
      id: true,
      sku: true,
      priceCentavos: true,
      optionSummary: true,
      product: { select: { id: true, name: true } },
    },
    orderBy: { sku: "asc" },
  });
}

/**
 * Every matching variant, flattened for CSV. The export deliberately ignores
 * pagination: exporting page three of a filter is never what anyone means.
 */
export async function exportRows(filters: ProductFilters): Promise<ExportRow[]> {
  const ids = await matchingProductIds(filters);

  const products = await db.product.findMany({
    where: { id: { in: ids } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      tags: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
      variants: {
        where: { deletedAt: null },
        orderBy: { sku: "asc" },
        select: {
          optionSummary: true,
          sku: true,
          barcode: true,
          priceCentavos: true,
          compareAtCentavos: true,
          lastCostCentavos: true,
          avgCostCentavos: true,
          reorderLevel: true,
          reorderQty: true,
          warrantyMonths: true,
          weightGrams: true,
          isActive: true,
          stockLevels: { select: { onHand: true } },
        },
      },
    },
  });

  return products.flatMap((product) =>
    product.variants.map((variant) => ({
      productId: product.id,
      product: product.name,
      slug: product.slug,
      category: product.category.name,
      brand: product.brand.name,
      status: product.status,
      tags: product.tags,
      variant: variant.optionSummary,
      sku: variant.sku,
      barcode: variant.barcode,
      priceCentavos: variant.priceCentavos,
      compareAtCentavos: variant.compareAtCentavos,
      lastCostCentavos: variant.lastCostCentavos,
      avgCostCentavos: variant.avgCostCentavos,
      reorderLevel: variant.reorderLevel,
      reorderQty: variant.reorderQty,
      onHand: variant.stockLevels.reduce((sum, level) => sum + level.onHand, 0),
      warrantyMonths: variant.warrantyMonths,
      weightGrams: variant.weightGrams,
      isActive: variant.isActive,
    })),
  );
}

/** Ids matching a filter, ignoring pagination. Used by export and bulk edit. */
export async function matchingProductIds(filters: ProductFilters): Promise<string[]> {
  const where = Prisma.join(buildConditions(filters), " AND ");
  const rows = await db.$queryRaw<{ id: string }[]>`
    ${VARIANT_ROLLUP}
    SELECT p.id
    FROM "Product" p
    JOIN "Category" c ON c.id = p."categoryId"
    JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN variant_agg a ON a."productId" = p.id
    WHERE ${where}
    ORDER BY p.name ASC
    LIMIT 5000
  `;
  return rows.map((row) => row.id);
}

/** Lookup tables the CSV importer matches rows against. */
export async function importContext() {
  const [variants, products, categories, brands] = await Promise.all([
    db.productVariant.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        sku: true,
        productId: true,
        optionSummary: true,
        barcode: true,
        priceCentavos: true,
        lastCostCentavos: true,
        reorderLevel: true,
        reorderQty: true,
        warrantyMonths: true,
        isActive: true,
        product: { select: { name: true } },
      },
    }),
    db.product.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    db.category.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    db.brand.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
  ]);

  const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

  return {
    variantsBySku: new Map(
      variants.map((variant) => [
        variant.sku.toUpperCase(),
        {
          id: variant.id,
          sku: variant.sku,
          productId: variant.productId,
          productName: variant.product.name,
          optionSummary: variant.optionSummary,
          barcode: variant.barcode,
          priceCentavos: variant.priceCentavos,
          lastCostCentavos: variant.lastCostCentavos,
          reorderLevel: variant.reorderLevel,
          reorderQty: variant.reorderQty,
          warrantyMonths: variant.warrantyMonths,
          isActive: variant.isActive,
        },
      ]),
    ),
    productIdsByName: new Map(products.map((product) => [key(product.name), product.id])),
    categoryIdsByName: new Map(categories.map((category) => [key(category.name), category.id])),
    brandIdsByName: new Map(brands.map((brand) => [key(brand.name), brand.id])),
    categoryNames: new Set(categories.map((category) => key(category.name))),
    brandNames: new Set(brands.map((brand) => key(brand.name))),
  };
}
