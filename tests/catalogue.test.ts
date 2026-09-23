import { describe, expect, it } from "vitest";

import { parseCsv, parseCsvRows, toCsv, CSV_BOM } from "@/lib/csv";
import { isPesoInput, parsePesoInput, toPesoInput } from "@/lib/money";
import { slugify, uniqueSlug } from "@/lib/slug";
import { stockHealth } from "@/lib/stock-math";
import {
  nextPrice,
  percentToBps,
  planPriceChanges,
  type BulkPriceRule,
} from "@/features/products/services/pricing";
import { planImport, type ImportContext } from "@/features/products/services/csv";

/**
 * Catalogue logic, tested where it lives: pure functions in the service layer.
 * Money and stock rules are the two things SPEC section 9 singles out, and
 * both of them run through here before they ever reach the database.
 */

describe("peso input parsing", () => {
  it("parses whole pesos, centavos and formatted text", () => {
    expect(parsePesoInput("4190")).toBe(419_000);
    expect(parsePesoInput("4190.00")).toBe(419_000);
    expect(parsePesoInput("4,190.50")).toBe(419_050);
    expect(parsePesoInput(" 1234.5 ")).toBe(123_450);
    expect(parsePesoInput("-250.25")).toBe(-25_025);
  });

  it("never loses a centavo to floating point", () => {
    // Math.round(1.005 * 100) is 100, which is the bug this avoids.
    expect(parsePesoInput("1.005")).toBeNull();
    expect(parsePesoInput("0.07")).toBe(7);
    expect(parsePesoInput("8.11")).toBe(811);
    expect(parsePesoInput("1234567.89")).toBe(123_456_789);
  });

  it("rejects anything that is not an amount", () => {
    for (const bad of ["", "abc", "12.345", "1e5", "--5", "12,34.5.6"]) {
      expect(parsePesoInput(bad), bad).toBeNull();
      expect(isPesoInput(bad), bad).toBe(false);
    }
  });

  it("refuses values a 32-bit centavo column cannot hold", () => {
    expect(parsePesoInput("99999999.99")).toBeNull();
  });

  it("round trips through the form representation", () => {
    for (const centavos of [0, 5, 100, 419_000, 123_456_789]) {
      expect(parsePesoInput(toPesoInput(centavos))).toBe(centavos);
    }
  });
});

describe("slugs", () => {
  it("makes a URL-safe slug from a product name", () => {
    expect(slugify("Aureus K87 Tenkeyless")).toBe("aureus-k87-tenkeyless");
    expect(slugify("  Cables, Hubs and Mounts  ")).toBe("cables-hubs-and-mounts");
    expect(slugify("Niño Gaming Pad")).toBe("nino-gaming-pad");
  });

  it("suffixes until the slug is free", () => {
    const taken = ["aureus-k87", "aureus-k87-2"];
    expect(uniqueSlug("Aureus K87", taken)).toBe("aureus-k87-3");
    expect(uniqueSlug("Aureus K88", taken)).toBe("aureus-k88");
  });

  it("falls back rather than producing an empty slug", () => {
    expect(uniqueSlug("...", [])).toBe("item");
  });
});

describe("csv encoding", () => {
  it("quotes only the cells that need it, and doubles inner quotes", () => {
    const csv = toCsv(
      [{ a: 'He said "hi"', b: "one,two", c: "plain" }],
      [
        { header: "A", value: (row) => row.a },
        { header: "B", value: (row) => row.b },
        { header: "C", value: (row) => row.c },
      ],
    );

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('"He said ""hi"""');
    expect(csv).toContain('"one,two"');
    expect(csv).toContain(",plain");
  });

  it("guards cells Excel would treat as a formula", () => {
    const csv = toCsv([{ v: "=1+1" }], [{ header: "V", value: (row) => row.v }]);
    expect(csv).toContain("'=1+1");
  });

  it("parses quoted fields containing commas and newlines", () => {
    const rows = parseCsvRows('a,"b,still b","line1\nline2"\r\n1,2,3\r\n');
    expect(rows).toEqual([
      ["a", "b,still b", "line1\nline2"],
      ["1", "2", "3"],
    ]);
  });

  it("keys rows by normalised header and pads short rows", () => {
    const parsed = parseCsv("SKU,Reorder Level,Price\nTG-1,8\n");
    expect(parsed.rows[0]).toEqual({ sku: "TG-1", reorderlevel: "8", price: "" });
  });

  it("drops the byte-order mark and blank lines", () => {
    const parsed = parseCsv(`${CSV_BOM}SKU,Price\n\nTG-1,10\n`);
    expect(parsed.headers).toEqual(["SKU", "Price"]);
    expect(parsed.rows).toHaveLength(1);
  });
});

describe("bulk price rules", () => {
  const rule = (over: Partial<BulkPriceRule>): BulkPriceRule => ({
    mode: "percent",
    amount: 0,
    rounding: "none",
    ...over,
  });

  it("applies a percentage as basis points", () => {
    expect(percentToBps(7.5)).toBe(750);
    expect(nextPrice(400_000, rule({ amount: percentToBps(10) }))).toBe(440_000);
    expect(nextPrice(400_000, rule({ amount: percentToBps(-10) }))).toBe(360_000);
  });

  it("adds a fixed amount and sets an absolute price", () => {
    expect(nextPrice(419_000, rule({ mode: "amount", amount: 25_000 }))).toBe(444_000);
    expect(nextPrice(419_000, rule({ mode: "set", amount: 399_900 }))).toBe(399_900);
  });

  it("rounds the way a price list is actually published", () => {
    const base = 448_430;
    expect(nextPrice(base, rule({ mode: "amount", amount: 0, rounding: "peso" }))).toBe(448_400);
    expect(nextPrice(base, rule({ mode: "amount", amount: 0, rounding: "nearest5" }))).toBe(
      448_500,
    );
    expect(nextPrice(base, rule({ mode: "amount", amount: 0, rounding: "charm" }))).toBe(448_395);
  });

  it("clamps rather than letting a rule take a price to zero", () => {
    expect(nextPrice(300, rule({ mode: "amount", amount: -100_000 }))).toBe(1);
    expect(nextPrice(50, rule({ rounding: "charm", amount: 0 }))).toBe(95);
  });

  it("reports only the variants a rule actually moves", () => {
    const variants = [
      { id: "a", priceCentavos: 100_000 },
      { id: "b", priceCentavos: 100_050 },
    ];
    const changes = planPriceChanges(
      variants,
      rule({ mode: "amount", amount: 0, rounding: "peso" }),
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.variant.id).toBe("b");
    // 1000.50 rounds away from zero, so the stray 50 centavos becomes a peso.
    expect(changes[0]?.to).toBe(100_100);
  });
});

describe("stock health", () => {
  it("calls an empty bin out of stock", () => {
    expect(stockHealth(0, 5)).toBe("out");
    expect(stockHealth(0, 0)).toBe("out");
  });

  it("calls a position at or below its reorder level low", () => {
    expect(stockHealth(5, 5)).toBe("low");
    expect(stockHealth(4, 5)).toBe("low");
  });

  it("ignores a reorder level nobody set", () => {
    expect(stockHealth(1, 0)).toBe("in");
    expect(stockHealth(90, 5)).toBe("in");
  });
});

describe("csv import planning", () => {
  const context: ImportContext = {
    variantsBySku: new Map([
      [
        "TG-KB-1",
        {
          id: "var_1",
          sku: "TG-KB-1",
          productId: "prd_1",
          productName: "Aureus K87 Tenkeyless",
          optionSummary: "Black / Brown",
          barcode: "4806501234567",
          priceCentavos: 499_000,
          lastCostCentavos: 310_000,
          reorderLevel: 8,
          reorderQty: 24,
          warrantyMonths: 24,
          isActive: true,
        },
      ],
    ]),
    productIdsByName: new Map([["aureus k87 tenkeyless", "prd_1"]]),
    categoryNames: new Set(["keyboards"]),
    brandNames: new Set(["aureus peripherals"]),
  };

  it("names the columns it cannot work without", () => {
    const plan = planImport("Product,Category\nThing,Keyboards\n", context);
    expect(plan.missingHeaders).toEqual(["sku", "price"]);
    expect(plan.rows).toHaveLength(0);
  });

  it("reports an existing SKU with a new price as an update, field by field", () => {
    const plan = planImport("SKU,Price,Reorder level\nTG-KB-1,5490.00,10\n", context);

    expect(plan.counts.update).toBe(1);
    const row = plan.rows[0];
    expect(row?.variantId).toBe("var_1");
    expect(row?.changes).toEqual([
      { field: "price", from: "4990.00", to: "5490.00" },
      { field: "reorder level", from: "8", to: "10" },
    ]);
  });

  it("leaves an unchanged row alone", () => {
    const plan = planImport("SKU,Price\nTG-KB-1,4990.00\n", context);
    expect(plan.counts.unchanged).toBe(1);
    expect(plan.rows[0]?.changes).toHaveLength(0);
  });

  it("attaches a new SKU to a product that already exists", () => {
    const plan = planImport(
      "Product,Category,Brand,Variant,SKU,Price,Cost\nAureus K87 Tenkeyless,Keyboards,Aureus Peripherals,White / Red,TG-KB-2,5190.00,3200.00\n",
      context,
    );

    expect(plan.counts["create-variant"]).toBe(1);
    expect(plan.rows[0]?.productId).toBe("prd_1");
  });

  it("creates the product too when the name is unknown", () => {
    const plan = planImport(
      "Product,Category,Brand,Variant,SKU,Price,Cost\nCorvid Rook Full Size,Keyboards,Aureus Peripherals,Black,TG-KB-9,3290.00,2100.00\n",
      context,
    );

    expect(plan.counts["create-product"]).toBe(1);
    expect(plan.rows[0]?.productId).toBeUndefined();
  });

  it("refuses a new SKU whose category or brand does not exist yet", () => {
    const plan = planImport(
      "Product,Category,Brand,SKU,Price,Cost\nMystery Pad,Desk Mats,Nobody,TG-MP-1,990.00,500.00\n",
      context,
    );

    expect(plan.counts.error).toBe(1);
    expect(plan.rows[0]?.errors).toEqual([
      'No category named "Desk Mats". Create it first.',
      'No brand named "Nobody". Create it first.',
    ]);
  });

  it("catches a bad price, a bad barcode and a duplicated SKU", () => {
    const plan = planImport(
      ["SKU,Price,Barcode", "TG-KB-1,not a price,4806501234567", "TG-KB-1,1000.00,abc"].join("\n"),
      context,
    );

    expect(plan.counts.error).toBe(2);
    expect(plan.rows[0]?.errors).toContain("Price is not a valid peso amount.");
    expect(plan.rows[1]?.errors).toContain("This SKU appears more than once in the file.");
    expect(plan.rows[1]?.errors).toContain("A barcode is 6 to 32 digits.");
  });

  it("reports columns it does not understand rather than silently dropping them", () => {
    const plan = planImport("SKU,Price,Supplier notes\nTG-KB-1,4990.00,whatever\n", context);
    expect(plan.unknownHeaders).toEqual(["Supplier notes"]);
  });

  it("numbers rows the way the file does, counting the header", () => {
    const plan = planImport("SKU,Price\nTG-KB-1,4990.00\nTG-KB-1,4990.00\n", context);
    expect(plan.rows.map((row) => row.line)).toEqual([2, 3]);
  });
});
