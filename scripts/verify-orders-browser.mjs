#!/usr/bin/env node
/**
 * Drives orders, returns and warranty through a real browser, as the role
 * that does each step, and checks the database after every one, so "it works"
 * means stock and money moved, not that a page rendered.
 *
 *   - Sales keys an order with a promo and a split payment (GCash plus cash
 *     with change); placement, payment and the SALE movements land together
 *   - Sales tries to sell more than the shelf holds and is refused, with
 *     nothing written
 *   - Warehouse packs, ships and delivers it, and never sees a peso amount
 *   - Sales raises a return, Manager approves, Warehouse receives, Manager
 *     completes it: stock comes back and the refund is the line's exact share
 *   - Sales raises a warranty claim, Manager approves it and sends a
 *     replacement: a zero-value order with a real SALE movement
 *   - Manager prints the invoice and downloads a real PDF; Warehouse cannot
 *   - Sales cancels a pending order and its reservation is released
 *
 * Needs the dev server and a freshly seeded database. It changes demo data,
 * so run `npm run db:seed` afterwards if you want the pristine set back.
 *
 * Usage: npm run verify:orders
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
const SESSION = "-s=orders";

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

/** Poll the page until a condition holds, instead of guessing how long a navigation takes. */
function waitFor(predicate, timeoutMs = 15_000) {
  return evaluate(`async () => {
    const deadline = Date.now() + ${timeoutMs};
    while (Date.now() < deadline) {
      if (${predicate}) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  }`);
}

function text() {
  return String(evaluate("() => document.body.innerText")).replace(/\s+/g, " ");
}

function shoot(name) {
  cli("screenshot", "--filename", `${OUT_DIR}/${name}.png`, "--full-page");
}

function login(email) {
  cli("cookie-clear");
  goto("/login");
  cli("fill", "#email", email);
  cli("fill", "#password", PASSWORD);
  cli("click", "button[type=submit]");
  wait(1500);
}

/** Type into a search combobox, wait for the server's answer, take the first match. */
function pickFrom(selector, query) {
  cli("fill", selector, query);
  wait(1200);
  cli("press", "Enter");
  wait(600);
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

/** One client, one query at a time. */
async function positions(items, warehouseId) {
  const rows = [];
  for (const item of items) rows.push(await position(item.variantId, warehouseId));
  return rows;
}

async function main() {
  await db.connect();
  mkdirSync(OUT_DIR, { recursive: true });
  cli("open", `${BASE_URL}/login`);
  cli("resize", "1440", "900");
  cli("set-color-scheme", "light");

  const main = await one(`SELECT id FROM "Warehouse" WHERE code = 'MNL-MAIN'`);
  const sales = await one(`SELECT id FROM "User" WHERE email = 'sales@techgear.ph'`);
  // Two well-stocked items, priced so two of the first clear the promo's minimum spend.
  const [itemA, itemB] = await all(
    `SELECT v.id, v.sku, v."priceCentavos" AS price, sl."onHand" - sl.reserved AS available
       FROM "ProductVariant" v
       JOIN "Product" p ON p.id = v."productId"
       JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = $1
      WHERE v."deletedAt" IS NULL AND v."isActive" AND p.status = 'ACTIVE' AND p."deletedAt" IS NULL
        AND sl."onHand" - sl.reserved >= 8 AND v."priceCentavos" BETWEEN 100000 AND 600000
        AND v."warrantyMonths" > 0
      ORDER BY v.sku LIMIT 2`,
    [main.id],
  );
  const scarce = await one(
    `SELECT v.id, v.sku, sl."onHand" - sl.reserved AS available
       FROM "ProductVariant" v
       JOIN "Product" p ON p.id = v."productId"
       JOIN "StockLevel" sl ON sl."variantId" = v.id AND sl."warehouseId" = $1
      WHERE v."deletedAt" IS NULL AND v."isActive" AND p.status = 'ACTIVE'
        AND sl."onHand" - sl.reserved BETWEEN 1 AND 4
      ORDER BY v.sku LIMIT 1`,
    [main.id],
  );
  const buyer = await one(
    `SELECT c.id, c.code FROM "Customer" c
      WHERE c."deletedAt" IS NULL AND c.type = 'BUSINESS'
        AND EXISTS (SELECT 1 FROM "Address" a WHERE a."customerId" = c.id)
      ORDER BY c.code LIMIT 1`,
  );
  const promoBefore = await one(`SELECT "usageCount" FROM "Promo" WHERE code = 'TECHGEAR10'`);
  const beforeA = await position(itemA.id, main.id);
  const beforeB = await position(itemB.id, main.id);

  // --------------------------------------------------------------- place
  heading("Order placed and paid in one step, as Sales");
  login("sales@techgear.ph");
  goto("/orders/new");
  wait(800);
  pickFrom("#customer", buyer.code);
  pickFrom("input[aria-label='Add an item']", itemA.sku);
  pickFrom("input[aria-label='Add an item']", itemB.sku);
  cli("fill", `input[aria-label='Quantity for ${itemA.sku}']`, "2");
  cli("fill", "#promo", "TECHGEAR10");
  cli("click", "button:has-text('Apply')");
  wait(1200);

  const merchandise = 2 * itemA.price + itemB.price;
  const promo = Math.round((merchandise * 1000) / 10_000);
  const total = merchandise - promo;
  const vat = Math.round((total * 12) / 112);

  cli("click", "#paying");
  wait(300);
  cli("fill", "#tender-0-amount", "1000");
  cli("fill", "#tender-0-reference", "GC-E2E-0001");
  cli("click", "button:has-text('Split payment')");
  wait(300);
  const cashDue = total - 100000;
  const handed = Math.ceil((cashDue + 1) / 50000) * 50000;
  cli("fill", "#tender-1-amount", peso(cashDue));
  cli("fill", "#tender-1-tendered", peso(handed));
  wait(300);
  shoot("order-new-filled-light-1440");
  cli("click", "button[type=submit]");
  // The form navigates to the new order once the action returns.
  waitFor(
    `!location.pathname.endsWith("/new") && (document.querySelector("h1")?.textContent ?? "").startsWith("SO-")`,
  );
  wait(500);

  const order = await one(
    `SELECT * FROM "Order" WHERE "createdById" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [sales.id],
  );
  check("The order was created and paid", order?.status === "PAID", order?.status);
  check(
    `Totals: merchandise ${peso(merchandise)} less 10% promo, VAT extracted at 12/112`,
    order?.totalCentavos === total &&
      order?.discountCentavos === promo &&
      order?.vatCentavos === vat &&
      order?.promoCodeSnapshot === "TECHGEAR10",
    `total ${order?.totalCentavos} vs ${total}, discount ${order?.discountCentavos} vs ${promo}, vat ${order?.vatCentavos} vs ${vat}`,
  );
  const payments = await all(
    `SELECT method, "amountCentavos", "tenderedCentavos", "changeCentavos" FROM "Payment" WHERE "orderId" = $1 ORDER BY method`,
    [order.id],
  );
  check(
    "Split payment recorded: GCash plus cash with change",
    payments.length === 2 &&
      payments.some((p) => p.method === "GCASH" && p.amountCentavos === 100000) &&
      payments.some(
        (p) =>
          p.method === "CASH" &&
          p.amountCentavos === cashDue &&
          p.changeCentavos === handed - cashDue,
      ),
    JSON.stringify(payments),
  );
  const sales_ = await all(
    `SELECT m."variantId", m."qtyDelta" FROM "StockMovement" m
       JOIN "OrderItem" oi ON oi.id = m."orderItemId" WHERE oi."orderId" = $1 AND m.type = 'SALE'`,
    [order.id],
  );
  const afterA = await position(itemA.id, main.id);
  const afterB = await position(itemB.id, main.id);
  check(
    "SALE movements took the stock off the shelf",
    sales_.length === 2 &&
      afterA.onHand === beforeA.onHand - 2 &&
      afterB.onHand === beforeB.onHand - 1 &&
      afterA.reserved === beforeA.reserved,
    `A ${beforeA.onHand} -> ${afterA.onHand}, B ${beforeB.onHand} -> ${afterB.onHand}`,
  );
  const promoAfter = await one(`SELECT "usageCount" FROM "Promo" WHERE code = 'TECHGEAR10'`);
  check("The promo use was counted", promoAfter.usageCount === promoBefore.usageCount + 1);
  const created = await one(
    `SELECT summary FROM "AuditLog" WHERE "entityType" = 'Order' AND "entityId" = $1`,
    [order.id],
  );
  check("Placement is in the audit log", Boolean(created?.summary?.includes(order.orderNumber)));
  check(
    "The browser landed on the new order",
    text().includes(order.orderNumber) && text().includes("paid"),
  );
  shoot("order-placed-light-1440");

  // ------------------------------------------------------------ oversell
  heading("Overselling is refused, as Sales");
  const ordersBefore = await one(`SELECT COUNT(*)::int AS n FROM "Order"`);
  goto("/orders/new");
  wait(800);
  pickFrom("input[aria-label='Add an item']", scarce.sku);
  cli("fill", `input[aria-label='Quantity for ${scarce.sku}']`, String(scarce.available + 1));
  wait(300);
  cli("click", "button[type=submit]");
  wait(2500);
  const ordersAfter = await one(`SELECT COUNT(*)::int AS n FROM "Order"`);
  check(
    `Asking for ${scarce.available + 1} of ${scarce.sku} (${scarce.available} free) shows the shortfall`,
    text().includes(`${scarce.available} available`),
    text().slice(0, 300),
  );
  check("Nothing was written", ordersAfter.n === ordersBefore.n);
  shoot("order-oversell-light-1440");

  // ---------------------------------------------------------- fulfilment
  heading("Pack, ship and deliver, as Warehouse");
  login("warehouse@techgear.ph");
  goto(`/orders/${order.id}`);
  wait(800);
  check("Warehouse sees the order without any peso amount", !text().includes("₱"));
  for (const [button, status] of [
    ["Mark packed", "PACKED"],
    ["Mark shipped", "SHIPPED"],
    ["Mark delivered", "DELIVERED"],
  ]) {
    cli("click", `button:has-text('${button}')`);
    wait(2000);
    const row = await one(`SELECT status FROM "Order" WHERE id = $1`, [order.id]);
    check(`${button} moves it to ${status.toLowerCase()}`, row.status === status, row.status);
  }
  const events = await one(
    `SELECT COUNT(*)::int AS n FROM "OrderStatusEvent" WHERE "orderId" = $1`,
    [order.id],
  );
  check("Every step is on the timeline", events.n === 6, String(events.n));
  shoot("order-delivered-warehouse-light-1440");

  // -------------------------------------------------------------- return
  heading("A return, handed from role to role");
  const [lineA, lineB] = await all(
    `SELECT id, "variantId", qty, "lineTotalCentavos" FROM "OrderItem" WHERE "orderId" = $1 ORDER BY qty DESC`,
    [order.id],
  );
  login("sales@techgear.ph");
  goto(`/returns/new?orderId=${order.id}`);
  wait(800);
  cli("fill", `input[aria-label='Units of ${itemA.sku} to return']`, "1");
  cli("fill", "#reason", "Two keys chatter on a single press");
  cli("click", "button:has-text('Raise return')");
  wait(2500);
  const rma = await one(`SELECT * FROM "Return" WHERE "orderId" = $1`, [order.id]);
  check("Sales raised the return", rma?.status === "REQUESTED", rma?.status);

  login("manager@techgear.ph");
  goto(`/returns/${rma.id}`);
  wait(800);
  cli("click", "button:has-text('Approve')");
  wait(2000);
  check(
    "Manager approved it",
    (await one(`SELECT status FROM "Return" WHERE id = $1`, [rma.id])).status === "APPROVED",
  );

  login("warehouse@techgear.ph");
  goto(`/returns/${rma.id}`);
  wait(800);
  cli("click", "button:has-text('Receive goods')");
  wait(500);
  cli("click", "button:has-text('Mark received')");
  wait(2000);
  check(
    "Warehouse received it",
    (await one(`SELECT status FROM "Return" WHERE id = $1`, [rma.id])).status === "RECEIVED",
  );

  const beforeReturn = await position(itemA.id, main.id);
  login("manager@techgear.ph");
  goto(`/returns/${rma.id}`);
  wait(800);
  cli("click", "button:has-text('Complete and refund')");
  wait(500);
  cli("click", "[role=dialog] button:has-text('Complete return')");
  wait(2500);
  const completed = await one(`SELECT status FROM "Return" WHERE id = $1`, [rma.id]);
  const refund = await one(`SELECT "amountCentavos" FROM "Refund" WHERE "returnId" = $1`, [rma.id]);
  const expectedRefund = Math.round(lineA.lineTotalCentavos / lineA.qty);
  const afterReturn = await position(itemA.id, main.id);
  const refreshed = await one(
    `SELECT status, "amountRefundedCentavos" FROM "Order" WHERE id = $1`,
    [order.id],
  );
  check("Manager completed it", completed.status === "COMPLETED");
  check(
    `The refund is one unit's share of the discounted line, ${peso(expectedRefund)}`,
    refund?.amountCentavos === expectedRefund,
    String(refund?.amountCentavos),
  );
  check("The unit is back on the shelf", afterReturn.onHand === beforeReturn.onHand + 1);
  check(
    "The order is partly refunded and still delivered",
    refreshed.status === "DELIVERED" && refreshed.amountRefundedCentavos === expectedRefund,
  );
  shoot("return-completed-light-1440");

  // ------------------------------------------------------------ warranty
  heading("A warranty claim met with a replacement");
  login("sales@techgear.ph");
  goto(`/warranty/new?orderItemId=${lineB.id}`);
  wait(800);
  cli("fill", "#issue", "Left click registers twice on a single press after a week.");
  cli("click", "button:has-text('Submit claim')");
  wait(2500);
  const claim = await one(`SELECT id, status FROM "WarrantyClaim" WHERE "orderItemId" = $1`, [
    lineB.id,
  ]);
  check("Sales submitted the claim", claim?.status === "SUBMITTED", claim?.status);

  login("manager@techgear.ph");
  goto(`/warranty/${claim.id}`);
  wait(800);
  cli("click", "button:has-text('Start review')");
  wait(400);
  cli("click", "[role=dialog] button:has-text('Start review')");
  wait(2000);
  cli("click", "button:has-text('Approve')");
  wait(400);
  cli("click", "[role=dialog] button:has-text('Approve claim')");
  wait(2000);
  const onShelf = await position(itemB.id, main.id);
  cli("click", "button:has-text('Send replacement')");
  wait(400);
  cli("click", "[role=dialog] button:has-text('Send replacement')");
  wait(3000);
  const replaced = await one(
    `SELECT c.status, o.id AS "orderId", o.status AS "orderStatus", o."totalCentavos", o."costTotalCentavos"
       FROM "WarrantyClaim" c JOIN "Order" o ON o.id = c."replacementOrderId" WHERE c.id = $1`,
    [claim.id],
  );
  const replacementMove = replaced
    ? await one(
        `SELECT m.reason, m."qtyDelta" FROM "StockMovement" m
           JOIN "OrderItem" oi ON oi.id = m."orderItemId" WHERE oi."orderId" = $1`,
        [replaced.orderId],
      )
    : null;
  check("The claim is replaced", replaced?.status === "REPLACED");
  check(
    "The replacement is a paid, zero-value order carrying its cost",
    replaced?.orderStatus === "PAID" &&
      replaced?.totalCentavos === 0 &&
      replaced?.costTotalCentavos > 0,
  );
  check(
    "The unit left stock as a warranty replacement",
    replacementMove?.reason === "WARRANTY_REPLACEMENT" && replacementMove?.qtyDelta === -1,
  );
  check("Stock fell by one", (await position(itemB.id, main.id)).onHand === onShelf.onHand - 1);
  shoot("claim-replaced-light-1440");

  // ------------------------------------------------------------ documents
  heading("Invoice, receipt and PDF");
  goto(`/print/invoice/${order.id}`);
  wait(800);
  check(
    "The invoice shows the order and its VAT",
    text().includes(order.orderNumber) && text().includes("VAT, 12%"),
  );
  const pdf = evaluate(`async () => {
    const response = await fetch("/print/invoice/${order.id}/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    return JSON.stringify({
      status: response.status,
      type: response.headers.get("content-type"),
      magic: String.fromCharCode(...bytes.slice(0, 5)),
      size: bytes.length,
    });
  }`);
  const pdfInfo = typeof pdf === "string" ? JSON.parse(pdf) : pdf;
  check(
    "The invoice downloads as a real PDF",
    pdfInfo.status === 200 && pdfInfo.type === "application/pdf" && pdfInfo.magic === "%PDF-",
    JSON.stringify(pdfInfo),
  );
  const receipt = evaluate(`async () => (await fetch("/print/receipt/${order.id}/pdf")).status`);
  check("The receipt PDF downloads too", Number(receipt) === 200, String(receipt));

  login("warehouse@techgear.ph");
  const blocked = evaluate(`async () => (await fetch("/print/invoice/${order.id}/pdf")).status`);
  check(
    "Warehouse cannot download a priced document",
    Number(blocked) === 403 || Number(blocked) === 404,
    String(blocked),
  );

  // -------------------------------------------------------------- cancel
  heading("Cancelling a pending order, as Sales");
  const pending = await one(
    `SELECT o.id, o."orderNumber" FROM "Order" o
      WHERE o.status = 'PENDING' AND (o."salespersonId" = $1 OR o."createdById" = $1)
      ORDER BY o."placedAt" DESC LIMIT 1`,
    [sales.id],
  );
  if (!pending) {
    check("A pending order of Sales' own exists to cancel", false);
  } else {
    const items = await all(`SELECT "variantId", qty FROM "OrderItem" WHERE "orderId" = $1`, [
      pending.id,
    ]);
    const warehouse = await one(`SELECT "warehouseId" FROM "Order" WHERE id = $1`, [pending.id]);
    const before = await positions(items, warehouse.warehouseId);
    login("sales@techgear.ph");
    goto(`/orders/${pending.id}`);
    wait(800);
    cli("click", "button:has-text('More')");
    wait(300);
    cli("click", "[role=menuitem]:has-text('Cancel order')");
    wait(400);
    cli("fill", "#cancel-reason", "Customer asked to cancel before paying");
    cli("click", "[role=dialog] button:has-text('Cancel order')");
    wait(2500);
    const after = await positions(items, warehouse.warehouseId);
    const row = await one(`SELECT status FROM "Order" WHERE id = $1`, [pending.id]);
    check(`${pending.orderNumber} is cancelled`, row.status === "CANCELLED", row.status);
    check(
      "Its reservations were released and nothing left the shelf",
      items.every(
        (item, index) =>
          after[index].reserved === before[index].reserved - item.qty &&
          after[index].onHand === before[index].onHand,
      ),
    );
  }

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
