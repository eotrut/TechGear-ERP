import { all, one } from "./support/db";
import { expect, signIn, test } from "./support/fixtures";

/**
 * A manager creates a product with one variant through the form, and the
 * product, its variant and the audit entry are in the database with the
 * price stored as exact centavos. Sales is refused the form.
 */
test("a manager creates a product and it is stored in centavos", async ({ page }) => {
  // Unique per run, so the spec can run twice against one seed.
  const stamp = Date.now().toString(36).toUpperCase();
  const name = `Tanay Studio 75 Keyboard ${stamp}`;
  const sku = `TG-E2E-${stamp}`;
  const barcode = String(Date.now()).slice(-13).padStart(13, "9");

  await signIn(page, "manager");
  await page.goto("/products/new");

  await page.locator("#name").fill(name);
  await page.locator("#categoryId").selectOption({ index: 1 });
  await page.locator("#brandId").selectOption({ index: 1 });
  await page.locator("#tags").fill("e2e, wireless");
  await page.locator("#variant-0-option").fill("Black / Linear / 75%");
  await page.locator("#variant-0-sku").fill(sku);
  await page.locator("#variant-0-barcode").fill(barcode);
  await page.locator("#variant-0-price").fill("4,190.50");
  await page.locator("#variant-0-cost").fill("2650");

  await page.getByRole("button", { name: "Create product" }).click();
  await page.waitForURL(/\/products\/(?!new)[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(sku).first()).toBeVisible();

  const product = await one<{ id: string; status: string }>(
    `SELECT id, status FROM "Product" WHERE name = $1`,
    [name],
  );
  expect(product, "the product row exists").not.toBeNull();

  const variants = await all<{ sku: string; priceCentavos: number; lastCostCentavos: number }>(
    `SELECT sku, "priceCentavos", "lastCostCentavos" FROM "ProductVariant" WHERE "productId" = $1`,
    [product!.id],
  );
  expect(variants).toEqual([{ sku, priceCentavos: 419050, lastCostCentavos: 265000 }]);

  const audit = await one<{ action: string }>(
    `SELECT action FROM "AuditLog" WHERE "entityType" = 'Product' AND "entityId" = $1`,
    [product!.id],
  );
  expect(audit?.action).toBe("CREATE");

  await signIn(page, "sales");
  await page.goto("/products/new");
  await expect(page.getByText("You do not have access to this page")).toBeVisible();
});
