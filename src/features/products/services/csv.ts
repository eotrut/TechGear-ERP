import { parsePesoInput, toPesoInput } from "@/lib/money";
import { normaliseHeader, parseCsv, toCsv, type CsvColumn, type CsvRow } from "@/lib/csv";

/**
 * Catalogue CSV, in and out.
 *
 * One row is one variant, because a variant is what carries a SKU, a price and
 * a cost. The SKU is the key: a row whose SKU already exists is an update, a
 * row whose SKU is new is an insert, and the product it belongs to is matched
 * by name so a multi-variant product can arrive as several rows.
 *
 * Everything here is pure. The action runs `planImport` first for the dry-run
 * diff the import page shows, then again inside the transaction that writes,
 * so what the reviewer approved is what gets applied.
 */

export type ExportRow = {
  /** Not a column: the route uses it to narrow an export to selected rows. */
  productId: string;
  product: string;
  slug: string;
  category: string;
  brand: string;
  status: string;
  tags: string[];
  variant: string;
  sku: string;
  barcode: string | null;
  priceCentavos: number;
  compareAtCentavos: number | null;
  lastCostCentavos: number;
  avgCostCentavos: number;
  reorderLevel: number;
  reorderQty: number;
  onHand: number;
  warrantyMonths: number;
  weightGrams: number | null;
  isActive: boolean;
};

/**
 * Column order is also the import contract, so the file a person exports,
 * edits in Excel and uploads again round trips without any mapping work.
 * Cost columns are dropped for roles without `products.viewCost`.
 */
export function exportColumns(includeCost: boolean): CsvColumn<ExportRow>[] {
  const columns: CsvColumn<ExportRow>[] = [
    { header: "Product", value: (row) => row.product },
    { header: "Slug", value: (row) => row.slug },
    { header: "Category", value: (row) => row.category },
    { header: "Brand", value: (row) => row.brand },
    { header: "Status", value: (row) => row.status },
    { header: "Tags", value: (row) => row.tags.join(" ") },
    { header: "Variant", value: (row) => row.variant },
    { header: "SKU", value: (row) => row.sku },
    { header: "Barcode", value: (row) => row.barcode ?? "" },
    { header: "Price", value: (row) => toPesoInput(row.priceCentavos) },
    {
      header: "Compare at",
      value: (row) => (row.compareAtCentavos === null ? "" : toPesoInput(row.compareAtCentavos)),
    },
  ];

  if (includeCost) {
    columns.push(
      { header: "Cost", value: (row) => toPesoInput(row.lastCostCentavos) },
      { header: "Average cost", value: (row) => toPesoInput(row.avgCostCentavos) },
    );
  }

  columns.push(
    { header: "Reorder level", value: (row) => row.reorderLevel },
    { header: "Reorder qty", value: (row) => row.reorderQty },
    { header: "On hand", value: (row) => row.onHand },
    { header: "Warranty months", value: (row) => row.warrantyMonths },
    { header: "Weight grams", value: (row) => row.weightGrams ?? "" },
    { header: "Active", value: (row) => (row.isActive ? "yes" : "no") },
  );

  return columns;
}

export function productsToCsv(rows: readonly ExportRow[], includeCost: boolean): string {
  return toCsv(rows, exportColumns(includeCost));
}

/* -------------------------------------------------------------------------- */

/** Fields an import may set, already converted to what the database stores. */
export type ImportValues = {
  productName: string;
  categoryName: string;
  brandName: string;
  variantName: string;
  sku: string;
  barcode: string | null;
  priceCentavos: number;
  lastCostCentavos: number;
  reorderLevel: number;
  reorderQty: number;
  warrantyMonths: number;
  isActive: boolean;
};

export type ImportAction = "create-product" | "create-variant" | "update" | "unchanged" | "error";

export type ImportChange = { field: string; from: string; to: string };

export type ImportPlanRow = {
  /** 1-based line in the file, counting the header, so it matches the editor. */
  line: number;
  sku: string;
  label: string;
  action: ImportAction;
  changes: ImportChange[];
  errors: string[];
  values: ImportValues | null;
  /** Set when the row updates an existing variant. */
  variantId?: string;
  /** Set when the row adds a variant to a product that already exists. */
  productId?: string;
};

export type ImportPlan = {
  rows: ImportPlanRow[];
  counts: Record<ImportAction, number>;
  /** Header names in the file that the importer does not understand. */
  unknownHeaders: string[];
  missingHeaders: string[];
};

export type ExistingVariant = {
  id: string;
  sku: string;
  productId: string;
  productName: string;
  optionSummary: string;
  barcode: string | null;
  priceCentavos: number;
  lastCostCentavos: number;
  reorderLevel: number;
  reorderQty: number;
  warrantyMonths: number;
  isActive: boolean;
};

export type ImportContext = {
  variantsBySku: Map<string, ExistingVariant>;
  productIdsByName: Map<string, string>;
  categoryNames: Set<string>;
  brandNames: Set<string>;
};

const REQUIRED_HEADERS = ["sku", "price"];

const KNOWN_HEADERS = new Set([
  "product",
  "slug",
  "category",
  "brand",
  "status",
  "tags",
  "variant",
  "sku",
  "barcode",
  "price",
  "compareat",
  "cost",
  "averagecost",
  "reorderlevel",
  "reorderqty",
  "onhand",
  "warrantymonths",
  "weightgrams",
  "active",
]);

function truthy(value: string, fallback: boolean): boolean {
  const text = value.trim().toLowerCase();
  if (text === "") return fallback;
  return ["yes", "y", "true", "1", "active"].includes(text);
}

function wholeNumber(value: string, fallback: number): number | null {
  if (value.trim() === "") return fallback;
  const parsed = Number(value.replace(/[\s,]/g, ""));
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) return null;
  return parsed;
}

/** The key products are matched on. Case and spacing are not meaningful. */
function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function planImport(csv: string, context: ImportContext): ImportPlan {
  const parsed = parseCsv(csv);
  const present = new Set(parsed.headers.map(normaliseHeader).filter((header) => header !== ""));

  const plan: ImportPlan = {
    rows: [],
    counts: { "create-product": 0, "create-variant": 0, update: 0, unchanged: 0, error: 0 },
    unknownHeaders: parsed.headers.filter(
      (header) => header.trim() !== "" && !KNOWN_HEADERS.has(normaliseHeader(header)),
    ),
    missingHeaders: REQUIRED_HEADERS.filter((header) => !present.has(header)),
  };

  if (plan.missingHeaders.length > 0) return plan;

  // A SKU repeated inside one file would apply twice against stale state.
  const seenSkus = new Set<string>();

  parsed.rows.forEach((row, index) => {
    const planned = planRow(row, index + 2, context, seenSkus);
    plan.rows.push(planned);
    plan.counts[planned.action] += 1;
  });

  return plan;
}

function planRow(
  row: CsvRow,
  line: number,
  context: ImportContext,
  seenSkus: Set<string>,
): ImportPlanRow {
  const errors: string[] = [];
  const sku = (row.sku ?? "").trim();
  const productName = (row.product ?? "").trim();
  const label = productName !== "" ? productName : sku;

  if (sku === "") errors.push("This row has no SKU.");
  if (sku !== "" && !/^[A-Za-z0-9._-]{3,40}$/.test(sku)) {
    errors.push("A SKU is 3 to 40 characters of letters, numbers, dots, hyphens or underscores.");
  }
  if (sku !== "" && seenSkus.has(sku.toUpperCase())) {
    errors.push("This SKU appears more than once in the file.");
  }
  seenSkus.add(sku.toUpperCase());

  const existing = context.variantsBySku.get(sku.toUpperCase());

  const priceCentavos = parsePesoInput(row.price ?? "");
  if (priceCentavos === null) errors.push("Price is not a valid peso amount.");
  else if (priceCentavos < 1) errors.push("Price must be greater than zero.");

  const costText = row.cost ?? "";
  const costCentavos =
    costText.trim() === "" ? (existing?.lastCostCentavos ?? 0) : parsePesoInput(costText);
  if (costCentavos === null) errors.push("Cost is not a valid peso amount.");

  const reorderLevel = wholeNumber(row.reorderlevel ?? "", existing?.reorderLevel ?? 0);
  if (reorderLevel === null) errors.push("Reorder level must be a whole number.");

  const reorderQty = wholeNumber(row.reorderqty ?? "", existing?.reorderQty ?? 0);
  if (reorderQty === null) errors.push("Reorder qty must be a whole number.");

  const warrantyMonths = wholeNumber(row.warrantymonths ?? "", existing?.warrantyMonths ?? 12);
  if (warrantyMonths === null) errors.push("Warranty months must be a whole number.");

  // A column the file does not carry must leave that field alone. Only a
  // column that is present and blank means "clear this", which is why the
  // parser keeps absent and empty distinguishable.
  const barcodeText = row.barcode?.trim();
  const barcode =
    barcodeText === undefined
      ? (existing?.barcode ?? null)
      : barcodeText === ""
        ? null
        : barcodeText;
  if (barcodeText !== undefined && barcodeText !== "" && !/^[0-9]{6,32}$/.test(barcodeText)) {
    errors.push("A barcode is 6 to 32 digits.");
  }

  const variantName = (row.variant ?? "").trim() || existing?.optionSummary || "Default";
  const categoryName = (row.category ?? "").trim();
  const brandName = (row.brand ?? "").trim();
  const isActive = truthy(row.active ?? "", existing?.isActive ?? true);

  // A new SKU has to say enough to build the row it is asking for.
  if (!existing) {
    if (productName === "") errors.push("A new SKU needs a product name.");
    if (categoryName === "") errors.push("A new SKU needs a category.");
    if (brandName === "") errors.push("A new SKU needs a brand.");
    if (categoryName !== "" && !context.categoryNames.has(nameKey(categoryName))) {
      errors.push(`No category named "${categoryName}". Create it first.`);
    }
    if (brandName !== "" && !context.brandNames.has(nameKey(brandName))) {
      errors.push(`No brand named "${brandName}". Create it first.`);
    }
  }

  if (errors.length > 0) {
    return { line, sku, label, action: "error", changes: [], errors, values: null };
  }

  const values: ImportValues = {
    productName: productName || existing?.productName || "",
    categoryName,
    brandName,
    variantName,
    sku,
    barcode,
    priceCentavos: priceCentavos as number,
    lastCostCentavos: costCentavos as number,
    reorderLevel: reorderLevel as number,
    reorderQty: reorderQty as number,
    warrantyMonths: warrantyMonths as number,
    isActive,
  };

  if (!existing) {
    const productId = context.productIdsByName.get(nameKey(values.productName));
    return {
      line,
      sku,
      label,
      action: productId ? "create-variant" : "create-product",
      changes: [
        { field: "sku", from: "", to: values.sku },
        { field: "price", from: "", to: toPesoInput(values.priceCentavos) },
      ],
      errors: [],
      values,
      productId,
    };
  }

  const changes: ImportChange[] = [];
  const compare = (field: string, from: string, to: string) => {
    if (from !== to) changes.push({ field, from, to });
  };

  compare("variant", existing.optionSummary, values.variantName);
  compare("barcode", existing.barcode ?? "", values.barcode ?? "");
  compare("price", toPesoInput(existing.priceCentavos), toPesoInput(values.priceCentavos));
  compare("cost", toPesoInput(existing.lastCostCentavos), toPesoInput(values.lastCostCentavos));
  compare("reorder level", String(existing.reorderLevel), String(values.reorderLevel));
  compare("reorder qty", String(existing.reorderQty), String(values.reorderQty));
  compare("warranty months", String(existing.warrantyMonths), String(values.warrantyMonths));
  compare("active", existing.isActive ? "yes" : "no", values.isActive ? "yes" : "no");

  return {
    line,
    sku,
    label: existing.productName,
    action: changes.length === 0 ? "unchanged" : "update",
    changes,
    errors: [],
    values,
    variantId: existing.id,
    productId: existing.productId,
  };
}

/** The template offered on the import page, so nobody has to guess the shape. */
export const IMPORT_TEMPLATE = [
  "Product,Category,Brand,Variant,SKU,Barcode,Price,Cost,Reorder level,Reorder qty,Warranty months,Active",
  "Aureus K87 Tenkeyless,Keyboards,Aureus Peripherals,Black / Brown,TG-KB-A87-BLK-BR,4806501234567,4990.00,3100.00,8,24,24,yes",
].join("\n");
