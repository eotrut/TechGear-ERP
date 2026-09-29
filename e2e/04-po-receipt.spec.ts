import { one, positionOf } from "./support/db";
import { expect, signIn, test } from "./support/fixtures";

/**
 * A manager raises and sends a purchase order; the warehouse receives it in
 * full. On-hand at the receiving warehouse rises by exactly the delivery,
 * through one RECEIPT movement, and the PO reads as received.
 */
test("a PO receipt increases stock through the ledger", async ({ page }) => {
  const supplier = await one<{ id: string }>(`SELECT id FROM "Supplier" WHERE code = 'SUP-001'`);
  const item = await one<{ id: string; sku: string; avg: number }>(
    `SELECT v.id, v.sku, v."avgCostCentavos" AS avg
       FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
      WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL AND p.status = 'ACTIVE'
        AND v."avgCostCentavos" BETWEEN 50000 AND 500000
      ORDER BY v.sku LIMIT 1`,
  );
  expect(supplier && item, "the seed has SUP-001 and a costed variant").toBeTruthy();
  const quantity = 8;
  const unitCost = (item!.avg / 100).toFixed(2);

  // ------------------------------------------------------------ raise it
  await signIn(page, "manager");
  await page.goto("/purchasing/new");
  await page.locator("#supplierId").selectOption(supplier!.id);
  const picker = page.getByLabel("Add an item");
  await picker.fill(item!.sku);
  await expect(page.getByRole("option").filter({ hasText: item!.sku }).first()).toBeVisible();
  await picker.press("Enter");
  await page.getByLabel(`Quantity of ${item!.sku}`).fill(String(quantity));
  await page.getByLabel(`Unit cost of ${item!.sku}`).fill(unitCost);
  await page.getByRole("button", { name: "Send to supplier" }).click();
  await page.waitForURL(/\/purchasing\/(?!new)[^/]+$/);
  const poId = new URL(page.url()).pathname.split("/").pop()!;

  const sent = await one<{ status: string; poNumber: string }>(
    `SELECT status, "poNumber" FROM "PurchaseOrder" WHERE id = $1`,
    [poId],
  );
  expect(sent?.status).toBe("SENT");

  // ----------------------------------------------------------- receive it
  const warehouseCode = (await one<{ code: string }>(
    `SELECT w.code FROM "PurchaseOrder" po JOIN "Warehouse" w ON w.id = po."warehouseId"
      WHERE po.id = $1`,
    [poId],
  ))!.code;
  const before = await positionOf(item!.id, warehouseCode);

  await signIn(page, "warehouse");
  await page.goto(`/purchasing/${poId}/receive`);
  await page.getByLabel(`Units accepted of ${item!.sku}`).fill(String(quantity));
  await page.getByLabel(`Delivered unit cost of ${item!.sku}`).fill(unitCost);
  await page.getByRole("button", { name: `Receive ${quantity} units` }).click();
  await page.waitForURL(new RegExp(`/purchasing/${poId}$`));
  await expect(page.getByText(/GRN-/).first()).toBeVisible();

  const after = await positionOf(item!.id, warehouseCode);
  expect(after.onHand).toBe(before.onHand + quantity);

  const movement = await one<{ type: string; qtyDelta: number; balanceAfter: number }>(
    `SELECT sm.type, sm."qtyDelta", sm."balanceAfter"
       FROM "StockMovement" sm
       JOIN "PurchaseReceiptItem" pri ON pri.id = sm."purchaseReceiptItemId"
       JOIN "PurchaseReceipt" pr ON pr.id = pri."receiptId"
      WHERE pr."purchaseOrderId" = $1`,
    [poId],
  );
  expect(movement).toEqual({ type: "RECEIPT", qtyDelta: quantity, balanceAfter: after.onHand });

  const received = await one<{ status: string }>(
    `SELECT status FROM "PurchaseOrder" WHERE id = $1`,
    [poId],
  );
  expect(received?.status).toBe("RECEIVED");
});
