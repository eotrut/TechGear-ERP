#!/usr/bin/env node
/**
 * Drives purchasing through a real browser, role by role, and checks the
 * database after each step, so "it works" means stock arrived and the moving
 * average moved by exactly the formula, not that a page rendered.
 *
 *   - Sales cannot open purchasing; Warehouse cannot open bills
 *   - Manager raises a PO in the form, picks an item by SKU, sets a quantity
 *     and a quoted cost, and sends it to the supplier
 *   - Warehouse receives part of it at a different cost: stock goes up by
 *     exactly that, one RECEIPT movement is written, the variant's average
 *     cost equals the moving-average formula over every warehouse, and the
 *     PO reads partly received
 *   - Warehouse receives the balance at a third cost: the PO reads received
 *     and the average moves again
 *   - Manager records the supplier's invoice against the PO and pays it; the
 *     bill is paid and the payment is on file
 *
 * Needs the dev server and a seeded database. It changes demo data, so run
 * `npm run db:seed` afterwards if you want the pristine set back.
 *
 * Usage: npm run verify:purchasing
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "docs/screenshots";
const PASSWORD = "techgear123";
const SESSION = "-s=purchasing-verify";

const CLI_ENTRY = (() => {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules"),
    join(nodeDir, "node_modules"),
    join(nodeDir, "..", "lib", "node_modules"),
  ].filter(Boolean);
  for (const root of candidates) {
    const entry = join(root, "@playwright", "cli", "playwright-cli.js");
    if (existsSync(entry)) return entry;
  }
  console.error("Could not find @playwright/cli.");
  process.exit(1);
})();

function cli(...args) {
  return execFileSync(process.execPath, [CLI_ENTRY, SESSION, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function evaluate(fn) {
  const raw = cli("--raw", "eval", fn).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function goto(path) {
  try {
    cli("goto", `${BASE_URL}${path}`);
  } catch {
    // A rewrite to the 403 page can abort the navigation; assertions look at what rendered.
  }
}

/** Poll the page until a condition holds, instead of guessing how long a step takes. */
function waitFor(predicate, timeoutMs = 20_000) {
  return evaluate(`async () => {
    const deadline = Date.now() + ${timeoutMs};
    while (Date.now() < deadline) {
      if (${predicate}) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }`);
}

function text() {
  return String(evaluate("() => document.body.innerText")).replace(/\s+/g, " ");
}

function shoot(name) {
  cli("screenshot", "--filename", `${OUT_DIR}/${name}.png`);
}

function login(email) {
  cli("cookie-clear");
  goto("/login");
  cli("fill", "#email", email);
  cli("fill", "#password", PASSWORD);
  cli("click", "button[type=submit]");
  waitFor(`!location.pathname.startsWith("/login")`);
}

let failures = 0;
let checks = 0;

function check(label, passed, detail) {
  checks += 1;
  if (passed) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function heading(title) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function one(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] ?? null;
}

/** The variant's cost and its on-hand in the receiving warehouse and everywhere. */
async function costPosition(variantId, warehouseId) {
  return one(
    `SELECT v."avgCostCentavos" AS avg, v."lastCostCentavos" AS last,
            COALESCE((SELECT SUM("onHand") FROM "StockLevel" WHERE "variantId" = v.id), 0)::int AS total,
            COALESCE((SELECT "onHand" FROM "StockLevel" WHERE "variantId" = v.id AND "warehouseId" = $2), 0)::int AS here
     FROM "ProductVariant" v WHERE v.id = $1`,
    [variantId, warehouseId],
  );
}

/** src/lib/stock-math.ts movingAverageCost, restated so the check is independent. */
function movingAverage(onHandBefore, avgBefore, qtyIn, unitCost) {
  if (onHandBefore <= 0) return unitCost;
  return Math.round((onHandBefore * avgBefore + qtyIn * unitCost) / (onHandBefore + qtyIn));
}

const peso = (centavos) => (centavos / 100).toFixed(2);

function receive(sku, accept, costPesos) {
  cli("fill", `input[aria-label="Units accepted of ${sku}"]`, String(accept));
  cli("fill", `input[aria-label="Delivered unit cost of ${sku}"]`, costPesos);
}

async function main() {
  await db.connect();
  mkdirSync(OUT_DIR, { recursive: true });
  cli("open", `${BASE_URL}/login`);
  cli("resize", "1440", "900");
  cli("set-color-scheme", "light");

  const main = await one(`SELECT id, code FROM "Warehouse" WHERE code = 'MNL-MAIN'`);
  const supplier = await one(`SELECT id, name FROM "Supplier" WHERE code = 'SUP-001'`);
  // Stock in both warehouses, so the average has to count the other one too (D-8).
  const item = await one(
    `SELECT v.id, v.sku, v."avgCostCentavos" AS avg FROM "ProductVariant" v
     JOIN "Product" p ON p.id = v."productId"
     WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL AND p.status = 'ACTIVE'
       AND v."avgCostCentavos" BETWEEN 50000 AND 500000
       AND (SELECT COUNT(*) FROM "StockLevel" sl WHERE sl."variantId" = v.id AND sl."onHand" > 0) = 2
     ORDER BY v.sku DESC LIMIT 1`,
  );
  if (!main || !supplier || !item) throw new Error("Seed data missing. Run npm run db:seed.");

  // ------------------------------------------------------------- the gates
  heading("Role gates");
  login("sales@techgear.ph");
  goto("/purchasing");
  check("Sales is refused purchasing", text().includes("purchasing.view"));

  login("warehouse@techgear.ph");
  goto("/purchasing/bills");
  check("Warehouse is refused bills", text().includes("bills.view"));
  goto("/purchasing/new");
  check("Warehouse cannot raise a purchase order", text().includes("purchasing.manage"));

  // ----------------------------------------------------------- raise a PO
  heading(`Manager raises a PO for ${item.sku} from ${supplier.name}`);
  login("manager@techgear.ph");
  goto("/purchasing/new");
  waitFor(`document.querySelector("#supplierId")`);
  cli("select", "#supplierId", supplier.id);
  cli("fill", "input[aria-label='Add an item']", item.sku);
  waitFor(
    `[...document.querySelectorAll('[role=option]')].some((o) => o.textContent.includes(${JSON.stringify(item.sku)}))`,
  );
  cli("press", "Enter");
  waitFor(`document.querySelector('input[aria-label="Quantity of ${item.sku}"]')`);
  const ordered = 12;
  // Quote 8 percent above the current average, so the receipt visibly moves it.
  const quoted = Math.round(item.avg * 1.08);
  cli("fill", `input[aria-label="Quantity of ${item.sku}"]`, String(ordered));
  cli("fill", `input[aria-label="Unit cost of ${item.sku}"]`, peso(quoted));
  shoot("verify-po-new");
  cli("click", "button:has-text('Send to supplier')");
  waitFor(
    `/^\\/purchasing\\/[^/]+$/.test(location.pathname) && !location.pathname.endsWith("/new")`,
  );

  const po = await one(
    `SELECT po.id, po."poNumber", po.status, po."totalCentavos", po."subtotalCentavos", po."vatCentavos",
            poi.id AS "itemId", poi."qtyOrdered", poi."unitCostCentavos"
     FROM "PurchaseOrder" po JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
     WHERE po."supplierId" = $1 AND poi."variantId" = $2
     ORDER BY po."createdAt" DESC LIMIT 1`,
    [supplier.id, item.id],
  );
  check(`${po?.poNumber} is saved and sent`, po?.status === "SENT", JSON.stringify(po));
  check(
    `Line is ${ordered} at ${peso(quoted)}, VAT 12% on top`,
    po?.qtyOrdered === ordered &&
      po?.unitCostCentavos === quoted &&
      po?.subtotalCentavos === ordered * quoted &&
      po?.vatCentavos === Math.round((ordered * quoted * 12) / 100),
  );
  check("The PO page shows it", text().includes(po.poNumber) && text().includes("sent"));

  // --------------------------------------------------------- first delivery
  heading("Warehouse receives part of it at a different cost");
  login("warehouse@techgear.ph");
  const before1 = await costPosition(item.id, main.id);
  const movementsBefore = Number(
    (await one(`SELECT COUNT(*)::int AS n FROM "StockMovement" WHERE "variantId" = $1`, [item.id]))
      .n,
  );
  goto(`/purchasing/${po.id}/receive`);
  waitFor(`document.querySelector('input[aria-label="Units accepted of ${item.sku}"]')`);
  const firstQty = 5;
  const firstCost = Math.round(item.avg * 1.12);
  receive(item.sku, firstQty, peso(firstCost));
  const previewShown = text().includes(
    peso(movingAverage(before1.total, before1.avg, firstQty, firstCost)).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      ",",
    ),
  );
  shoot("verify-po-receive");
  cli("click", "button:has-text('Receive 5 units')");
  waitFor(`location.pathname === "/purchasing/${po.id}"`);
  waitFor(`document.body.innerText.includes("GRN-")`);

  const after1 = await costPosition(item.id, main.id);
  const expected1 = movingAverage(before1.total, before1.avg, firstQty, firstCost);
  check("The receiving screen previewed the new average", previewShown);
  check(
    `On hand in ${main.code}: ${before1.here} to ${after1.here} (+${firstQty})`,
    after1.here === before1.here + firstQty,
  );
  check(
    `Average cost ${peso(before1.avg)} to ${peso(after1.avg)}, formula over ${before1.total} on hand says ${peso(expected1)}`,
    after1.avg === expected1 && after1.avg !== before1.avg,
  );
  check("Last cost is the delivered cost", after1.last === firstCost);
  const movement = await one(
    `SELECT sm.type, sm."qtyDelta", sm."unitCostCentavos", sm."avgCostAfterCentavos", sm."balanceAfter",
            pr.reference
     FROM "StockMovement" sm
     JOIN "PurchaseReceiptItem" pri ON pri.id = sm."purchaseReceiptItemId"
     JOIN "PurchaseReceipt" pr ON pr.id = pri."receiptId"
     WHERE sm."variantId" = $1 ORDER BY sm."occurredAt" DESC LIMIT 1`,
    [item.id],
  );
  const movementsAfter = Number(
    (await one(`SELECT COUNT(*)::int AS n FROM "StockMovement" WHERE "variantId" = $1`, [item.id]))
      .n,
  );
  check(
    `One RECEIPT movement on ${movement?.reference}, carrying the cost and the new average`,
    movementsAfter === movementsBefore + 1 &&
      movement?.type === "RECEIPT" &&
      movement?.qtyDelta === firstQty &&
      movement?.unitCostCentavos === firstCost &&
      movement?.avgCostAfterCentavos === expected1 &&
      movement?.balanceAfter === after1.here,
    JSON.stringify(movement),
  );
  const partial = await one(
    `SELECT po.status, poi."qtyReceived" FROM "PurchaseOrder" po
     JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id WHERE po.id = $1`,
    [po.id],
  );
  check(
    "PO is partly received, 5 of 12",
    partial?.status === "PARTIALLY_RECEIVED" && partial?.qtyReceived === firstQty,
  );
  check(
    "The PO page lists the delivery",
    text().includes(movement?.reference ?? "GRN-") && text().includes("partly received"),
  );
  shoot("verify-po-partial");

  // -------------------------------------------------------- second delivery
  heading("Warehouse receives the balance at a third cost");
  const before2 = await costPosition(item.id, main.id);
  goto(`/purchasing/${po.id}/receive`);
  waitFor(`document.querySelector('input[aria-label="Units accepted of ${item.sku}"]')`);
  const secondQty = ordered - firstQty;
  const secondCost = Math.round(item.avg * 0.97);
  receive(item.sku, secondQty, peso(secondCost));
  cli("click", `button:has-text('Receive ${secondQty} units')`);
  waitFor(`location.pathname === "/purchasing/${po.id}"`);
  waitFor(`document.body.innerText.includes("received")`);

  const after2 = await costPosition(item.id, main.id);
  const expected2 = movingAverage(before2.total, before2.avg, secondQty, secondCost);
  check(
    `On hand in ${main.code}: ${before2.here} to ${after2.here} (+${secondQty})`,
    after2.here === before2.here + secondQty,
  );
  check(
    `Average cost ${peso(before2.avg)} to ${peso(after2.avg)}, formula says ${peso(expected2)}`,
    after2.avg === expected2,
  );
  const done = await one(
    `SELECT po.status, poi."qtyReceived", (SELECT COUNT(*)::int FROM "PurchaseReceipt" WHERE "purchaseOrderId" = po.id) AS receipts
     FROM "PurchaseOrder" po JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id WHERE po.id = $1`,
    [po.id],
  );
  check(
    "PO is received in full across two deliveries",
    done?.status === "RECEIVED" && done?.qtyReceived === ordered && done?.receipts === 2,
    JSON.stringify(done),
  );
  const ledger = await one(
    `SELECT COALESCE(SUM("qtyDelta"), 0)::int AS summed FROM "StockMovement" WHERE "variantId" = $1 AND "warehouseId" = $2`,
    [item.id, main.id],
  );
  check("The ledger still sums to on hand", ledger?.summed === after2.here);
  goto(`/inventory/ledger?search=${encodeURIComponent(po.poNumber)}`);
  check(
    "Searching the ledger by PO number finds both receipts",
    waitFor(`document.querySelectorAll("tbody tr").length === 2`, 10_000),
  );

  // ------------------------------------------------------------- bill it
  heading("Manager records the supplier's invoice and pays it");
  login("manager@techgear.ph");
  goto(`/purchasing/bills/new?purchaseOrderId=${po.id}`);
  waitFor(`document.querySelector("#supplierReference")`);
  const reference = `SI-V${Date.now().toString().slice(-6)}`;
  cli("fill", "#supplierReference", reference);
  cli("click", "button[type=submit]:has-text('Record bill')");
  waitFor(
    `/^\\/purchasing\\/bills\\/[^/]+$/.test(location.pathname) && !location.pathname.endsWith("/new")`,
  );

  const receivedValue = firstQty * firstCost + secondQty * secondCost;
  const bill = await one(
    `SELECT id, "billNumber", status, "subtotalCentavos", "vatCentavos", "totalCentavos", "dueDate", "issueDate"
     FROM "SupplierBill" WHERE "supplierReference" = $1`,
    [reference],
  );
  check(
    `${bill?.billNumber} is open for what actually arrived, ${peso(receivedValue)} plus VAT`,
    bill?.status === "OPEN" &&
      bill?.subtotalCentavos === receivedValue &&
      bill?.vatCentavos === Math.round((receivedValue * 12) / 100),
    JSON.stringify(bill),
  );
  check(
    "Due 30 days after the invoice, from Northgate's terms",
    Math.round((new Date(bill.dueDate) - new Date(bill.issueDate)) / 86_400_000) === 30,
  );

  cli("click", "button:has-text('Record payment')");
  waitFor(`document.querySelector("#pay-reference")`);
  cli("fill", "#pay-reference", "BDO 0048 1123");
  cli("click", "[role=dialog] button:has-text('Record payment')");
  waitFor(`!document.querySelector("[role=dialog]")`);
  const paid = await one(
    `SELECT b.status, b."amountPaidCentavos", COUNT(p.id)::int AS payments
     FROM "SupplierBill" b LEFT JOIN "SupplierPayment" p ON p."billId" = b.id
     WHERE b.id = $1 GROUP BY b.id`,
    [bill.id],
  );
  check(
    "Bill is paid in full by one bank transfer",
    paid?.status === "PAID" &&
      paid?.amountPaidCentavos === bill.totalCentavos &&
      paid?.payments === 1,
    JSON.stringify(paid),
  );
  waitFor(`document.body.innerText.includes("paid")`);
  shoot("verify-bill-paid");

  cli("close");
  await db.end();

  heading("Summary");
  if (failures === 0) console.log(`  All ${checks} checks passed.`);
  else {
    console.log(`  ${failures} of ${checks} checks FAILED.`);
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  try {
    cli("close");
  } catch {
    // already closed
  }
  await db.end().catch(() => undefined);
  process.exitCode = 1;
});
