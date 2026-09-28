import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";

import { pesosToCentavos } from "../../src/lib/money";
import { netFromGross } from "../../src/lib/vat";
import { BRANDS, CATEGORIES, PRODUCTS } from "./data/catalogue";
import { PH_LOCATIONS } from "./data/philippines";
import { phLandline, phLocation, phPerson, phStreet, pick, slugify } from "./lib/helpers";
import type { SeedContext, UserRef, VariantRef, WarehouseRef } from "./lib/context";

/** Documented in the README. Four demo logins, one per role. */
export const DEMO_PASSWORD = "techgear123";

const DEMO_USERS = [
  { key: "admin", email: "admin@techgear.ph", name: "Rafael Bautista", role: "ADMIN" },
  { key: "manager", email: "manager@techgear.ph", name: "Katrina Ocampo", role: "MANAGER" },
  { key: "sales", email: "sales@techgear.ph", name: "Miguel Villanueva", role: "SALES" },
  { key: "warehouse", email: "warehouse@techgear.ph", name: "Divina Salazar", role: "WAREHOUSE" },
] as const;

const SUPPLIERS = [
  { name: "Northgate Distribution", city: "Quezon City", leadTime: 5, terms: "NET_30" },
  { name: "Pacific Rim Components", city: "Cebu City", leadTime: 12, terms: "NET_30" },
  { name: "Manila Input Devices", city: "Manila", leadTime: 4, terms: "NET_15" },
  { name: "Shenzhen Bridge Trading", city: "Pasig", leadTime: 21, terms: "NET_60" },
  { name: "Visayas Tech Supply", city: "Iloilo City", leadTime: 9, terms: "NET_30" },
  { name: "Clark Freeport Imports", city: "Angeles", leadTime: 14, terms: "NET_30" },
  { name: "Southline Audio Trading", city: "Makati", leadTime: 7, terms: "NET_15" },
  { name: "Batangas Cable Works", city: "Lipa", leadTime: 6, terms: "COD" },
] as const;

/**
 * Demand weight by category. Without this every SKU sells at the same rate and
 * the top-products chart is a flat line, which reads as fake immediately.
 */
const CATEGORY_POPULARITY: Record<string, number> = {
  keyboards: 1.0,
  switches: 1.35,
  keycaps: 0.85,
  mice: 1.1,
  mousepads: 0.95,
  audio: 0.7,
  streaming: 0.45,
  connectivity: 0.9,
};

export async function buildCatalogue(ctx: SeedContext): Promise<void> {
  const { tables } = ctx;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --------------------------------------------------------------- users
  const users: Partial<Record<string, UserRef>> = {};
  DEMO_USERS.forEach((user, index) => {
    const id = `usr_${String(index + 1).padStart(6, "0")}`;
    tables.users.push({
      id,
      email: user.email,
      name: user.name,
      passwordHash,
      role: user.role,
      isActive: true,
      phone: phLandline(),
      lastLoginAt: faker.date.between({
        from: new Date(ctx.now.getTime() - 5 * 86_400_000),
        to: ctx.now,
      }),
      createdAt: ctx.windowStart,
    });
    users[user.key] = { id, name: user.name, email: user.email, role: user.role };
  });

  ctx.users = users as SeedContext["users"];

  // A deactivated former employee, so the users page has something to show
  // besides four identical active rows.
  tables.users.push({
    id: "usr_000005",
    email: "jerome.flores@techgear.ph",
    name: "Jerome Flores",
    passwordHash,
    role: "SALES",
    isActive: false,
    phone: phLandline(),
    lastLoginAt: new Date(ctx.now.getTime() - 121 * 86_400_000),
    createdAt: ctx.windowStart,
  });

  // ---------------------------------------------------------- warehouses
  const warehouseSeeds = [
    { id: "wh_000001", code: "MNL-MAIN", name: "Manila Main Warehouse", isDefault: true },
    { id: "wh_000002", code: "CEB-HUB", name: "Cebu Distribution Hub", isDefault: false },
  ];
  const warehouseCities = ["Quezon City", "Mandaue"];

  warehouseSeeds.forEach((warehouse, index) => {
    tables.warehouses.push({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      isDefault: warehouse.isDefault,
      isActive: true,
      createdAt: ctx.windowStart,
    });

    const location =
      phLocation().city === warehouseCities[index]
        ? phLocation()
        : { ...phLocation(), city: warehouseCities[index] ?? "Quezon City" };

    tables.addresses.push({
      id: `adr_wh_${index + 1}`,
      type: "BUSINESS",
      warehouseId: warehouse.id,
      line1: phStreet(),
      barangay: pick(location.barangays),
      city: location.city,
      province: location.province,
      postalCode: location.postalCode,
      country: "PH",
      isDefault: true,
      createdAt: ctx.windowStart,
    });
  });

  ctx.warehouses = warehouseSeeds.map<WarehouseRef>((w) => ({
    id: w.id,
    code: w.code,
    name: w.name,
  }));

  // ---------------------------------------------------------- categories
  const categoryIds = new Map<string, string>();
  CATEGORIES.forEach((category, index) => {
    const id = `cat_${String(index + 1).padStart(6, "0")}`;
    categoryIds.set(category.slug, id);
    tables.categories.push({
      id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      sortOrder: index,
      createdAt: ctx.windowStart,
    });
  });

  // -------------------------------------------------------------- brands
  const brandIds = new Map<string, string>();
  BRANDS.forEach((brand, index) => {
    const id = `brd_${String(index + 1).padStart(6, "0")}`;
    brandIds.set(brand.slug, id);
    tables.brands.push({
      id,
      name: brand.name,
      slug: brand.slug,
      website: brand.website,
      createdAt: ctx.windowStart,
    });
  });

  // ------------------------------------------------------------ products
  const variants: VariantRef[] = [];
  let variantCounter = 0;

  PRODUCTS.forEach((product, productIndex) => {
    const productId = `prd_${String(productIndex + 1).padStart(6, "0")}`;
    const categoryId = categoryIds.get(product.category);
    const brandId = brandIds.get(product.brand);
    if (!categoryId || !brandId) {
      throw new Error(`Product ${product.name} references an unknown category or brand`);
    }

    tables.products.push({
      id: productId,
      name: product.name,
      slug: slugify(product.name),
      description: buildDescription(product.name, product.specs),
      status: "ACTIVE",
      categoryId,
      brandId,
      tags: product.tags,
      createdAt: ctx.windowStart,
    });

    product.specs.forEach(([key, value], specIndex) => {
      tables.productSpecs.push({
        id: `spc_${productId}_${specIndex}`,
        productId,
        key,
        value,
        sortOrder: specIndex,
      });
    });

    // Product illustrations drawn by scripts/draw-product-images.ts into
    // public/, in the product's own colourway (decision D-13).
    const imageCount = 2;
    for (let i = 0; i < imageCount; i += 1) {
      tables.productImages.push({
        id: `img_${productId}_${i}`,
        productId,
        url: `/products/${slugify(product.name)}-${i + 1}.svg`,
        alt: i === 0 ? product.name : `${product.name}, close up`,
        sortOrder: i,
        isPrimary: i === 0,
      });
    }

    const basePopularity = CATEGORY_POPULARITY[product.category] ?? 1;

    product.variants.forEach((variant, variantIndex) => {
      variantCounter += 1;
      const variantId = `var_${String(variantCounter).padStart(6, "0")}`;

      const pricePhp = product.pricePhp + (variant.priceDeltaPhp ?? 0);
      const priceCentavos = pesosToCentavos(pricePhp);

      // Cost is landed cost excluding VAT: input VAT is recoverable, so gross
      // margin compares VAT-exclusive revenue against it.
      const baseCostCentavos = Math.round(netFromGross(priceCentavos) * product.costRatio);

      const sku = buildSku(product, variant.suffix, variantCounter);

      tables.variants.push({
        id: variantId,
        productId,
        name: variant.suffix,
        optionSummary: variant.suffix,
        sku,
        barcode: `48${String(8_000_000_000 + variantCounter * 7919).slice(0, 11)}`,
        priceCentavos,
        compareAtCentavos:
          variantIndex === 0 && pricePhp > 3000
            ? pesosToCentavos(Math.round(pricePhp * 1.15))
            : null,
        lastCostCentavos: baseCostCentavos,
        avgCostCentavos: 0, // set from the ledger once opening stock lands
        reorderLevel: reorderLevelFor(pricePhp),
        reorderQty: reorderQtyFor(pricePhp),
        weightGrams: weightFor(product.category),
        warrantyMonths: warrantyFor(product.category),
        isActive: true,
        createdAt: ctx.windowStart,
      });

      variant.attributes.forEach(([name, value], attrIndex) => {
        tables.variantAttributes.push({
          id: `att_${variantId}_${attrIndex}`,
          variantId,
          name,
          value,
          sortOrder: attrIndex,
        });
      });

      variants.push({
        id: variantId,
        productId,
        sku,
        name: `${product.name} ${variant.suffix}`,
        optionSummary: variant.suffix,
        categorySlug: product.category,
        brandSlug: product.brand,
        priceCentavos,
        baseCostCentavos,
        warrantyMonths: warrantyFor(product.category),
        reorderLevel: reorderLevelFor(pricePhp),
        // First variants of a product are the ones people actually buy.
        popularity: basePopularity * (variantIndex === 0 ? 1.6 : variantIndex === 1 ? 1.0 : 0.55),
      });
    });
  });

  ctx.variants = variants;

  // ----------------------------------------------------------- suppliers
  SUPPLIERS.forEach((supplier, index) => {
    const id = `sup_${String(index + 1).padStart(6, "0")}`;
    const contact = phPerson();
    // Drawn anyway so the seeded sequence after this point stays the same;
    // the address itself comes from the supplier's real city.
    const drawn = phLocation();
    const location = PH_LOCATIONS.find((candidate) => candidate.city === supplier.city) ?? drawn;

    tables.suppliers.push({
      id,
      code: `SUP-${String(index + 1).padStart(3, "0")}`,
      name: supplier.name,
      contactName: contact.fullName,
      email: `purchasing@${slugify(supplier.name)}.example.ph`,
      phone: phLandline(),
      leadTimeDays: supplier.leadTime,
      paymentTerms: supplier.terms,
      // Messy, not round. Round rates read as invented.
      onTimeRateBps: faker.number.int({ min: 7420, max: 9870 }),
      defectRateBps: faker.number.int({ min: 12, max: 480 }),
      notes: null,
      isActive: true,
      createdAt: ctx.windowStart,
    });

    tables.addresses.push({
      id: `adr_sup_${index + 1}`,
      type: "BUSINESS",
      supplierId: id,
      line1: phStreet(),
      barangay: pick(location.barangays),
      city: supplier.city,
      province: location.province,
      postalCode: location.postalCode,
      country: "PH",
      isDefault: true,
      createdAt: ctx.windowStart,
    });

    ctx.supplierIds.push(id);
  });

  // ------------------------------------------------------------ settings
  tables.appSettings.push(
    { key: "company.name", value: "TechGear PH", updatedAt: ctx.now },
    { key: "company.tin", value: "008-472-915-000", updatedAt: ctx.now },
    {
      key: "company.address",
      value: "128 Katipunan Avenue, Loyola Heights, Quezon City, Metro Manila 1108",
      updatedAt: ctx.now,
    },
    { key: "tax.vatRateBps", value: 1200, updatedAt: ctx.now },
    { key: "tax.pricesIncludeVat", value: true, updatedAt: ctx.now },
    { key: "locale.currency", value: "PHP", updatedAt: ctx.now },
    { key: "locale.timezone", value: "Asia/Manila", updatedAt: ctx.now },
  );
}

function buildDescription(name: string, specs: [string, string][]): string {
  const lead = specs
    .slice(0, 3)
    .map(([key, value]) => `${key.toLowerCase()} ${value.toLowerCase()}`)
    .join(", ");
  return `${name}. ${capitalise(lead)}. Covered by the standard TechGear PH warranty and serviced locally.`;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildSku(
  product: { name: string; category: string; brand: string },
  suffix: string,
  counter: number,
): string {
  const categoryCode: Record<string, string> = {
    keyboards: "KB",
    keycaps: "KC",
    switches: "SW",
    mice: "MS",
    mousepads: "MP",
    audio: "AU",
    streaming: "ST",
    connectivity: "CN",
  };
  const brandCode = product.brand.slice(0, 3).toUpperCase();
  const variantCode = suffix
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(0, 4)
    .toUpperCase();
  return `${categoryCode[product.category] ?? "XX"}-${brandCode}-${variantCode}-${String(counter).padStart(3, "0")}`;
}

/**
 * Reorder point, sized as roughly two weeks of cover at the depth we stock.
 * Setting it near a third of opening stock, as an earlier pass did, flagged
 * half the catalogue as low and made the alerts page useless.
 */
function reorderLevelFor(pricePhp: number): number {
  if (pricePhp < 600) return 32;
  if (pricePhp < 2000) return 16;
  if (pricePhp < 6000) return 8;
  return 4;
}

function reorderQtyFor(pricePhp: number): number {
  if (pricePhp < 600) return 200;
  if (pricePhp < 2000) return 100;
  if (pricePhp < 6000) return 40;
  return 20;
}

function weightFor(category: string): number {
  const weights: Record<string, number> = {
    keyboards: 900,
    keycaps: 420,
    switches: 90,
    mice: 180,
    mousepads: 650,
    audio: 540,
    streaming: 380,
    connectivity: 260,
  };
  return weights[category] ?? 300;
}

function warrantyFor(category: string): number {
  const months: Record<string, number> = {
    keyboards: 12,
    keycaps: 6,
    switches: 6,
    mice: 24,
    mousepads: 6,
    audio: 12,
    streaming: 24,
    connectivity: 12,
  };
  return months[category] ?? 12;
}
