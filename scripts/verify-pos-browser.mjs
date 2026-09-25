#!/usr/bin/env node
/**
 * Drives the register through a real browser at tablet size, as Sales, and
 * checks the database after the sale, so "it works" means stock left the
 * shelf and money was recorded, not that a page rendered.
 *
 *   - Warehouse cannot open the register
 *   - Sales scans one item by barcode and another by SKU, raises a quantity,
 *     attaches a customer
 *   - a 15 percent discount is over the Sales limit: the cart says so and
 *     will not charge; 10 percent goes through
 *   - the sale is split between cash (with change) and GCash
 *   - the order is completed, stock is down by exactly what was sold, the
 *     SALE movements and payments are written, and the order shows in the
 *     orders list and on its own page
 *   - the register refuses to put more of an item in the cart than the shelf
 *     holds, and voiding clears the cart
 *
 * Needs the dev server and a freshly seeded database. It changes demo data,
 * so run `npm run db:seed` afterwards if you want the pristine set back.
 *
 * Usage: npm run verify:pos
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
const SESSION = "-s=pos-verify";

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

function wait(ms) {
  cli("--raw", "eval", `() => new Promise((r) => setTimeout(r, ${ms}))`);
}

function goto(path) {
  try {
    cli("goto", `${BASE_URL}${path}`);
  } catch {
    // A rewrite to the 403 page can abort the navigation; assertions look at what rendered.
  }
}

/** Poll the page until a condition holds, instead of guessing how long a step takes. */
function waitFor(predicate, timeoutMs = 15_000) {
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

const cartLines = `document.querySelectorAll('[aria-label="Items in this sale"] li').length`;

function scan(code, expectedLines) {
  cli("fill", "#pos-scan", code);
  cli("press", "Enter");
  return waitFor(`${cartLines} === ${expectedLines}`);
}

/** "₱2,470.00" to 247000. */
function centavosIn(selector) {
  const raw = String(
    evaluate(`() => document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`),
  );
  const digits = raw.replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
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

async function all(sql, params = []) {
  return (await db.query(sql, params)).rows;
}

const peso = (centavos) => (centavos / 100).toFixed(2);

async function position(variantId, warehouseId) {
  return (
    (await one(
      `SELECT "onHand", reserved FROM "StockLevel" WHERE "variantId" = $1 AND "warehouseId" = $2`,
      [variantId, warehouseId],
    )) ?? { onHand: 0, reserved: 0 }
  );
}

/** applyBps, as src/lib/money.ts rounds it: half away from zero. */
const bps = (centavos, rate) => Math.round((centavos * rate) / 10_000);

async function main() {
  await db.connect();
  mkdirSync(OUT_DIR, { recursive: true });
  cli("open", `${BASE_URL}/login`);
  // A 10-inch tablet in landscape: the register's home.
  cli("resize", "1024", "768");
  cli("set-color-scheme", "light");

  const main = await one(`SELECT id FROM "Warehouse" WHERE code = 'MNL-MAIN'`);
  const sales = await one(`SELECT id FROM "User" WHERE email = 'sales@techgear.ph'`);
  const sellable = `
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = $1
    WHERE v."deletedAt" IS NULL AND v."isActive" AND p.status = 'ACTIVE' AND p."deletedAt" IS NULL`;
  const [itemA, itemB] = await all(
    `SELECT v.id, v.sku, v.barcode, v."priceCentavos" AS price ${sellable}
       AND v.barcode IS NOT NULL AND sl."onHand" - sl.reserved >= 6
       AND v."priceCentavos" BETWEEN 50000 AND 400000
     ORDER BY v.sku DESC LIMIT 2`,
    [main.id],
  );
  const scarce = await one(
    `SELECT v.id, v.sku, (sl."onHand" - sl.reserved)::int AS available ${sellable}
       AND sl."onHand" - sl.reserved BETWEEN 1 AND 3
     ORDER BY v.sku LIMIT 1`,
    [main.id],
  );
  const customer = await one(
    `SELECT id, code, "displayName" FROM "Customer"
      WHERE "deletedAt" IS NULL AND type = 'INDIVIDUAL' ORDER BY code LIMIT 1`,
  );
  const beforeA = await position(itemA.id, main.id);
  const beforeB = await position(itemB.id, main.id);

  // ------------------------------------------------------------- access
  heading("Warehouse cannot open the register");
  login("warehouse@techgear.ph");
  goto("/pos");
  wait(800);
  check("/pos renders the 403 naming pos.use", text().includes("Missing: pos.use"));

  // --------------------------------------------------------------- cart
  heading("Sales builds a sale at tablet size");
  login("sales@techgear.ph");
  goto("/pos");
  waitFor(`document.querySelector("#pos-scan")`);
  check(
    "The scan field has focus on arrival",
    evaluate(`() => document.activeElement?.id`) === "pos-scan",
  );

  check(`Scanning barcode ${itemA.barcode} adds ${itemA.sku}`, scan(itemA.barcode, 1));
  check(`Typing SKU ${itemB.sku} and Enter adds it`, scan(itemB.sku, 2));
  cli("click", `button[aria-label="One more ${itemA.sku}"]`);
  waitFor(`document.querySelector('[aria-label="Quantity of ${itemA.sku}"]')?.value === "2"`);
  check(
    `The stepper raises ${itemA.sku} to 2`,
    evaluate(`() => document.querySelector('[aria-label="Quantity of ${itemA.sku}"]').value`) ===
      "2",
  );

  cli("click", "button:has-text('Walk-in customer')");
  waitFor(`document.querySelector("#pos-customer")`);
  cli("fill", "#pos-customer", customer.code);
  wait(1200);
  cli("press", "Enter");
  waitFor(`document.querySelector("#cart")?.innerText.includes(${JSON.stringify(customer.code)})`);
  check(`Customer ${customer.code} is attached`, text().includes(customer.displayName));

  const subtotal = 2 * itemA.price + itemB.price;
  check(
    `The cart totals ${peso(subtotal)} before any discount`,
    centavosIn("[data-testid=cart-total]") === subtotal,
    `${centavosIn("[data-testid=cart-total]")} vs ${subtotal}`,
  );

  // ----------------------------------------------------------- discount
  heading("The Sales discount cap");
  cli("click", "button:has-text('Add discount or promo')");
  waitFor(`document.querySelector('[role=dialog]')`);
  cli("click", "button[role=radio]:has-text('Percent')");
  cli("fill", "#pos-discount-value", "15");
  cli("click", "button[type=submit]:has-text('Done')");
  waitFor(`!document.querySelector('[role=dialog]')`);
  check("15 percent is flagged as over the 10 percent limit", /your limit is 10%/.test(text()));
  check(
    "Charge is disabled while the discount is over the limit",
    evaluate(
      `() => [...document.querySelectorAll("#cart button")].find((b) => b.textContent.startsWith("Charge"))?.disabled`,
    ) === true,
  );

  cli("click", "button:has-text('15% off')");
  waitFor(`document.querySelector("#pos-discount-value")`);
  cli("fill", "#pos-discount-value", "10");
  cli("click", "button[type=submit]:has-text('Done')");
  waitFor(`!document.querySelector('[role=dialog]')`);
  const total = subtotal - bps(subtotal, 1000);
  check(
    `10 percent is accepted: total ${peso(total)}`,
    centavosIn("[data-testid=cart-total]") === total,
    `${centavosIn("[data-testid=cart-total]")} vs ${total}`,
  );
  shoot("pos-flow-cart-light-1024");

  // ------------------------------------------------------------ payment
  heading("Split payment: cash with change, the rest by GCash");
  cli("click", "#cart button:has-text('Charge')");
  waitFor(`document.querySelector("[data-testid=amount-due]")`);
  check(
    "The payment dialog asks for the cart total",
    centavosIn("[data-testid=amount-due]") === total,
  );
  cli("click", "button:has-text('Split payment')");
  waitFor(`document.querySelector("#tender-1-reference")`);
  cli("fill", "#tender-0-amount", "1000");
  cli("fill", "#tender-0-tendered", "1500");
  cli("fill", "#tender-1-reference", "GC-4471200913");
  wait(200);
  check(
    `The GCash row fills in the balance, ${peso(total - 100000)}`,
    evaluate(`() => document.querySelector("#tender-1-amount").value`) === peso(total - 100000),
    String(evaluate(`() => document.querySelector("#tender-1-amount").value`)),
  );
  check("Change of 500.00 is shown", centavosIn("[data-testid=change-due]") === 50000);
  shoot("pos-flow-payment-light-1024");

  cli("click", "button[type=submit]:has-text('Complete sale')");
  const landed = waitFor(`location.pathname.startsWith("/pos/receipt/")`, 20_000);
  check("Completing the sale lands on the receipt", landed);
  const orderId = String(evaluate(`() => location.pathname.split("/").pop()`));
  waitFor(`document.querySelector("[data-testid=change-due]")`);
  shoot("pos-flow-receipt-light-1024");

  // ------------------------------------------------------------ database
  heading("The database after the sale");
  const order = await one(`SELECT * FROM "Order" WHERE id = $1`, [orderId]);
  check(
    `${order?.orderNumber} is a completed POS order`,
    order?.channel === "POS" && order?.status === "COMPLETED",
    `${order?.channel} ${order?.status}`,
  );
  check(
    `Total ${peso(total)}, discount ${peso(bps(subtotal, 1000))}, VAT at 12/112`,
    order?.totalCentavos === total &&
      order?.discountCentavos === bps(subtotal, 1000) &&
      order?.vatCentavos === Math.round((total * 12) / 112),
  );
  check(
    "Sold by Sales, to the attached customer",
    order?.salespersonId === sales.id && order?.customerId === customer.id,
  );
  const payments = await all(
    `SELECT method, "amountCentavos", "tenderedCentavos", "changeCentavos", reference
       FROM "Payment" WHERE "orderId" = $1 ORDER BY method::text`,
    [orderId],
  );
  check(
    "Payments: cash 1,000.00 of 1,500.00 with 500.00 change, GCash the rest with its reference",
    payments.length === 2 &&
      payments[0].method === "CASH" &&
      payments[0].amountCentavos === 100000 &&
      payments[0].tenderedCentavos === 150000 &&
      payments[0].changeCentavos === 50000 &&
      payments[1].method === "GCASH" &&
      payments[1].amountCentavos === total - 100000 &&
      payments[1].reference === "GC-4471200913",
    JSON.stringify(payments),
  );
  const afterA = await position(itemA.id, main.id);
  const afterB = await position(itemB.id, main.id);
  check(
    `${itemA.sku} on hand ${beforeA.onHand} to ${afterA.onHand}, ${itemB.sku} ${beforeB.onHand} to ${afterB.onHand}`,
    afterA.onHand === beforeA.onHand - 2 &&
      afterB.onHand === beforeB.onHand - 1 &&
      afterA.reserved === beforeA.reserved &&
      afterB.reserved === beforeB.reserved,
  );
  const movements = await all(
    `SELECT m.type, m."qtyDelta", m."balanceAfter"
       FROM "StockMovement" m JOIN "OrderItem" oi ON oi.id = m."orderItemId"
      WHERE oi."orderId" = $1 ORDER BY m."qtyDelta"`,
    [orderId],
  );
  check(
    "Two SALE movements, -2 and -1, whose running balances match the shelf",
    movements.length === 2 &&
      movements.every((movement) => movement.type === "SALE") &&
      movements[0].qtyDelta === -2 &&
      movements[1].qtyDelta === -1 &&
      movements[0].balanceAfter === afterA.onHand &&
      movements[1].balanceAfter === afterB.onHand,
    JSON.stringify(movements),
  );
  const events = await all(
    `SELECT "toStatus" FROM "OrderStatusEvent" WHERE "orderId" = $1 ORDER BY "createdAt"`,
    [orderId],
  );
  check(
    "The timeline walks every step to Completed",
    events.map((event) => event.toStatus).join(",") ===
      "DRAFT,PENDING,PAID,PACKED,SHIPPED,DELIVERED,COMPLETED",
    events.map((event) => event.toStatus).join(","),
  );
  const audit = await one(
    `SELECT summary FROM "AuditLog" WHERE "entityId" = $1 AND action = 'CREATE'`,
    [orderId],
  );
  check("The sale is in the audit log", Boolean(audit?.summary?.includes("at the register")));

  // -------------------------------------------------------------- lists
  heading("The sale shows up where people look for it");
  goto("/orders");
  waitFor(`document.body.innerText.includes(${JSON.stringify(order.orderNumber)})`);
  check(`${order.orderNumber} is in the orders list`, text().includes(order.orderNumber));
  goto(`/orders/${orderId}`);
  wait(600);
  const detail = text();
  check(
    "The order page shows it completed, from the store",
    detail.includes(order.orderNumber) && detail.includes("Completed"),
  );

  // ------------------------------------------------------ shelf and void
  heading("The register will not promise more than the shelf holds");
  goto("/pos");
  waitFor(`document.querySelector("#pos-scan")`);
  const scarceQty = `document.querySelector('[aria-label="Quantity of ${scarce.sku}"]')?.value`;
  for (let i = 1; i <= scarce.available; i += 1) {
    cli("fill", "#pos-scan", scarce.sku);
    cli("press", "Enter");
    waitFor(`${scarceQty} === "${i}"`);
  }
  cli("fill", "#pos-scan", scarce.sku);
  cli("press", "Enter");
  waitFor(`document.body.innerText.includes("left at MNL-MAIN")`);
  check(
    `Scanning ${scarce.sku} once more than the ${scarce.available} on the shelf is refused`,
    text().includes(`Only ${scarce.available} of ${scarce.sku} left at MNL-MAIN`),
  );
  check(
    `The cart holds exactly ${scarce.available}`,
    evaluate(`() => document.querySelector('[aria-label="Quantity of ${scarce.sku}"]').value`) ===
      String(scarce.available),
  );

  cli("click", "#cart button:has-text('Void')");
  waitFor(`document.querySelector('[role=dialog]')`);
  cli("click", "[role=dialog] button:has-text('Void sale')");
  waitFor(`${cartLines} === 0`);
  check("Voiding empties the cart", evaluate(`() => ${cartLines}`) === 0);
  const scarceAfter = await position(scarce.id, main.id);
  check(
    "A voided cart never touched stock",
    scarceAfter.onHand - scarceAfter.reserved === scarce.available,
  );

  cli("close");
  await db.end();
  console.log(`\n${checks - failures} of ${checks} checks passed.`);
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  try {
    cli("close");
  } catch {
    // already closed
  }
  await db.end().catch(() => {});
  process.exit(1);
});
