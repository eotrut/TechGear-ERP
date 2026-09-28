#!/usr/bin/env node
/**
 * Drives the finance phase through a real browser and checks the database
 * after each step, so "the numbers reconcile" is measured on rendered pages,
 * not asserted from code.
 *
 *   - Role gates: Sales cannot open expenses or the P&L; Warehouse cannot
 *     open the sales report or export it
 *   - The revenue on the dashboard, the sales report and its CSV export are
 *     the same figure, and equal independent SQL over the orders table
 *   - Manager records an expense in the form: the row is written with its
 *     input VAT split out, the P&L's operating expenses rise by exactly the
 *     net amount, and the audit log has the entry
 *   - Manager corrects it; the VAT follows the new amount
 *   - Manager cannot delete it; Admin deletes it through the confirm dialog,
 *     and the P&L is back where it started
 *
 * Needs the dev server and a seeded database. The expense it creates is
 * deleted again, so the demo data is left as it was found.
 *
 * Usage: npm run verify:finance
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
const SESSION = "-s=finance-verify";

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

/** "₱1,945,004.00" to 194500400, parsed as integers so no float touches money. */
function centavos(display) {
  if (typeof display !== "string") return null;
  const match = /(-?)[^\d-]*([\d,]+)\.(\d{2})/.exec(display);
  if (!match) return null;
  const value = Number(match[2].replaceAll(",", "")) * 100 + Number(match[3]);
  return match[1] === "-" ? -value : value;
}

/** The value under a KPI tile, found by its exact label. */
function kpi(label) {
  return centavos(
    evaluate(`() => {
      const dt = [...document.querySelectorAll("dt")].find((d) => d.textContent.trim() === ${JSON.stringify(label)});
      return dt?.nextElementSibling?.textContent.trim() ?? null;
    }`),
  );
}

/** Fetch a CSV through the page, so it carries the page's session cookie. */
function fetchText(path) {
  return evaluate(`async () => {
    const response = await fetch(${JSON.stringify(path)});
    return { status: response.status, body: await response.text() };
  }`);
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

/** Midnight Manila, n days before today, as the UTC wall clock the columns hold. */
function manilaMidnightUtc(daysBack) {
  const shifted = new Date(Date.now() + 8 * 3_600_000);
  const day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(day - daysBack * 86_400_000 - 8 * 3_600_000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
}

async function main() {
  await db.connect();
  mkdirSync(OUT_DIR, { recursive: true });
  cli("open", `${BASE_URL}/login`);
  cli("resize", "1440", "900");
  cli("set-color-scheme", "light");

  // ------------------------------------------------------------- the gates
  heading("Role gates");
  login("sales@techgear.ph");
  goto("/expenses");
  check("Sales is refused expenses", text().includes("expenses.view"));
  goto("/reports/pl");
  check("Sales is refused the profit and loss", text().includes("reports.finance"));

  login("warehouse@techgear.ph");
  goto("/reports/sales");
  check("Warehouse is refused the sales report", text().includes("reports.sales"));
  goto("/dashboard");
  const denied = fetchText("/api/export/reports/sales?range=30d");
  check("Warehouse cannot export the sales report either", denied?.status === 403);

  // --------------------------------------------------------- reconciliation
  heading("Dashboard revenue equals report revenue equals the CSV");
  login("admin@techgear.ph");
  const independent = await one(
    `SELECT COALESCE(SUM(o."totalCentavos" - o."amountRefundedCentavos"), 0)::bigint AS revenue
     FROM "Order" o
     WHERE o.status IN ('PAID','PACKED','SHIPPED','DELIVERED','COMPLETED')
       AND o."placedAt" >= $1::timestamp
       AND NOT EXISTS (SELECT 1 FROM "WarrantyClaim" w WHERE w."replacementOrderId" = o.id)`,
    [manilaMidnightUtc(29)],
  );
  const expected = Number(independent.revenue);

  goto("/dashboard?range=30d");
  waitFor(`document.body.innerText.includes("Performance")`);
  const onDashboard = kpi("Revenue");
  goto("/reports/sales?range=30d&by=channel");
  waitFor(`document.body.innerText.includes("From merchandise to revenue")`);
  const onReport = kpi("Revenue");
  shoot("verify-finance-sales-report");
  const csv = fetchText("/api/export/reports/sales?range=30d&by=channel");
  const lines = String(csv?.body ?? "")
    .replace(/^﻿/, "")
    .trim()
    .split(/\r?\n/);
  const revenueColumn = lines[0]?.split(",").indexOf("Revenue PHP") ?? -1;
  const fromCsv = lines
    .slice(1)
    .reduce((sum, line) => sum + (centavos(line.split(",")[revenueColumn] ?? "") ?? 0), 0);

  check(`Last 30 days, independent SQL: PHP ${(expected / 100).toFixed(2)}`, expected > 0);
  check("The dashboard shows exactly that", onDashboard === expected, `dashboard ${onDashboard}`);
  check("The sales report shows exactly that", onReport === expected, `report ${onReport}`);
  check(
    "The CSV export's channels add up to exactly that",
    csv?.status === 200 && fromCsv === expected,
    `status ${csv?.status}, csv ${fromCsv}`,
  );

  // --------------------------------------------------------- expenses
  heading("Manager records an expense and the P&L moves by its net amount");
  login("manager@techgear.ph");
  goto("/reports/pl?range=mtd");
  waitFor(`document.body.innerText.includes("Statement")`);
  const opexBefore = kpi("Operating expenses");

  goto("/expenses/new");
  waitFor(`document.querySelector("#expense-amount")`);
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const description = "Packing tape and fragile stickers, verification run";
  cli("select", "#expense-category", "SUPPLIES");
  cli("fill", "#expense-date", today);
  cli("fill", "#expense-description", description);
  cli("fill", "#expense-vendor", "Pacific Packaging");
  cli("fill", "#expense-amount", "11200");
  shoot("verify-expense-form");
  cli("click", "button[type=submit]");
  waitFor(`location.pathname === "/expenses"`);

  const created = await one(
    `SELECT id, reference, "amountCentavos", "vatCentavos", category FROM "Expense"
     WHERE description = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [description],
  );
  check(
    `Expense saved as ${created?.reference ?? "nothing"}: PHP 11,200.00 with PHP 1,200.00 input VAT`,
    created?.amountCentavos === 1_120_000 &&
      created?.vatCentavos === 120_000 &&
      created?.category === "SUPPLIES",
    JSON.stringify(created),
  );
  const audit = await one(
    `SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE "entityType" = 'Expense' AND "entityId" = $1`,
    [created?.id ?? ""],
  );
  check("The audit log recorded it", audit?.n === 1);

  goto("/reports/pl?range=mtd");
  waitFor(`document.body.innerText.includes("Statement")`);
  const opexAfter = kpi("Operating expenses");
  check(
    "P&L operating expenses rose by exactly PHP 10,000.00, the amount net of VAT",
    opexBefore !== null && opexAfter - opexBefore === 1_000_000,
    `before ${opexBefore}, after ${opexAfter}`,
  );

  heading("Manager corrects it, and cannot delete it");
  goto(`/expenses/${created.id}`);
  waitFor(`document.querySelector("#expense-amount")`);
  check("Manager has no delete button", !text().includes("Delete"));
  cli("fill", "#expense-amount", "5600");
  cli("click", "button[type=submit]");
  waitFor(`document.body.innerText.includes("saved")`);
  const edited = await one(`SELECT "amountCentavos", "vatCentavos" FROM "Expense" WHERE id = $1`, [
    created.id,
  ]);
  check(
    "The corrected amount carries its own VAT",
    edited?.amountCentavos === 560_000 && edited?.vatCentavos === 60_000,
    JSON.stringify(edited),
  );

  heading("Admin deletes it and the P&L is back where it started");
  login("admin@techgear.ph");
  goto(`/expenses/${created.id}`);
  waitFor(`document.body.innerText.includes("Delete")`);
  cli("click", "button:has-text('Delete')");
  waitFor(`document.querySelector("[role=dialog]")`);
  shoot("verify-expense-delete");
  cli("click", "[role=dialog] button:has-text('Delete expense')");
  waitFor(`location.pathname === "/expenses"`);
  const gone = await one(`SELECT COUNT(*)::int AS n FROM "Expense" WHERE id = $1`, [created.id]);
  check("The expense is gone", gone?.n === 0);
  goto("/reports/pl?range=mtd");
  waitFor(`document.body.innerText.includes("Statement")`);
  check(
    "Operating expenses are back to their starting figure",
    kpi("Operating expenses") === opexBefore,
  );

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
