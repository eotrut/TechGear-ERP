import { all, one, positionOf } from "./support/db";
import { expect, signIn, test } from "./support/fixtures";

/**
 * Sales rings up a register sale at tablet size. Stock at the store drops by
 * exactly what was sold, through SALE movements in the ledger, and the order
 * is completed and paid in cash with the change recorded.
 */
test.use({ viewport: { width: 1024, height: 768 } });

test("a POS sale reduces stock through the ledger", async ({ page }) => {
  const item = await one<{ id: string; sku: string; barcode: string; price: number }>(
    `SELECT v.id, v.sku, v.barcode, v."priceCentavos" AS price
       FROM "ProductVariant" v
       JOIN "Product" p ON p.id = v."productId"
       JOIN "StockLevel" sl ON sl."variantId" = v.id
       JOIN "Warehouse" w ON w.id = sl."warehouseId" AND w.code = 'MNL-MAIN'
      WHERE v."deletedAt" IS NULL AND v."isActive" AND p.status = 'ACTIVE' AND p."deletedAt" IS NULL
        AND v.barcode IS NOT NULL AND sl."onHand" - sl.reserved >= 5
        AND v."priceCentavos" BETWEEN 50000 AND 300000
      ORDER BY v.sku LIMIT 1`,
  );
  expect(item, "the seed has a sellable item at MNL-MAIN").not.toBeNull();
  const before = await positionOf(item!.id, "MNL-MAIN");

  await signIn(page, "sales");
  await page.goto("/pos");
  const scan = page.locator("#pos-scan");
  await expect(scan).toBeFocused();

  // A barcode scanner types the code and presses Enter.
  await scan.fill(item!.barcode);
  await scan.press("Enter");
  const quantity = page.getByLabel(`Quantity of ${item!.sku}`);
  await expect(quantity).toHaveValue("1");
  await page.getByRole("button", { name: `One more ${item!.sku}` }).click();
  await expect(quantity).toHaveValue("2");

  const total = item!.price * 2;
  await page
    .locator("#cart")
    .getByRole("button", { name: /^Charge/ })
    .click();
  await expect(page.getByTestId("amount-due")).toContainText(pesos(total));

  // Round the tender up to the next thousand, so there is change to give.
  const tendered = Math.ceil((total + 1) / 100_000) * 1000;
  await page.locator("#tender-0-tendered").fill(String(tendered));
  await expect(page.getByTestId("change-due")).toContainText(pesos(tendered * 100 - total));
  await page.getByRole("button", { name: "Complete sale" }).click();

  await page.waitForURL(/\/pos\/receipt\/[^/]+$/);
  const orderId = new URL(page.url()).pathname.split("/").pop()!;

  const order = await one<{
    orderNumber: string;
    status: string;
    channel: string;
    totalCentavos: number;
  }>(`SELECT "orderNumber", status, channel, "totalCentavos" FROM "Order" WHERE id = $1`, [
    orderId,
  ]);
  expect(order).toMatchObject({ status: "COMPLETED", channel: "POS", totalCentavos: total });

  const payment = await one<{ method: string; changeCentavos: number }>(
    `SELECT method, "changeCentavos" FROM "Payment" WHERE "orderId" = $1`,
    [orderId],
  );
  expect(payment).toEqual({ method: "CASH", changeCentavos: tendered * 100 - total });

  const after = await positionOf(item!.id, "MNL-MAIN");
  expect(after.onHand).toBe(before.onHand - 2);
  expect(after.reserved).toBe(before.reserved);

  const movements = await all<{ type: string; qtyDelta: number; balanceAfter: number }>(
    `SELECT m.type, m."qtyDelta", m."balanceAfter"
       FROM "StockMovement" m JOIN "OrderItem" oi ON oi.id = m."orderItemId"
      WHERE oi."orderId" = $1`,
    [orderId],
  );
  expect(movements).toEqual([{ type: "SALE", qtyDelta: -2, balanceAfter: after.onHand }]);

  // The movement is on the ledger page, where a manager would look for it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, "manager");
  await page.goto(`/inventory/ledger?variantId=${item!.id}&type=SALE`);
  await expect(page.getByRole("row").filter({ hasText: order!.orderNumber })).toBeVisible();
});

/** 247000 to "2,470.00", the digits the page prints after the peso sign. */
function pesos(centavos: number): string {
  return (centavos / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
