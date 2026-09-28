#!/usr/bin/env node
/**
 * Drives the CRM through a real browser and checks the database after each
 * step, so "it works" means the data changed, not that a page rendered.
 *
 *   - drag a lead one stage along the kanban, as Sales
 *   - drag a lead two stages at once, and see it refused and put back
 *   - see another salesperson's lead locked
 *   - drag a quoted lead onto Won and convert it into a new customer
 *   - tick a task off in My tasks
 *   - open a ticket from Customer 360 and reply to it
 *   - add a customer with a Philippine address
 *   - check Warehouse and Sales are kept out of what they may not see
 *
 * Needs the dev server and a freshly seeded database. It changes demo data,
 * so run `npm run db:seed` afterwards if you want the pristine set back.
 *
 * Usage: npm run verify:crm
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
const SESSION = "-s=crm";

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

/** Evaluate in the page and return the value, not the CLI's report around it. */
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
  wait(1500);
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

/**
 * A real pointer drag: press on the card, travel in steps so dnd-kit sees the
 * activation distance and then the columns it passes over, and release over
 * the target. One jump from A to B would skip the events a hand produces.
 */
function drag(cardCode, stage) {
  const points = evaluate(`() => {
    const card = document.querySelector('[data-lead-card="${cardCode}"]');
    const column = document.querySelector('[data-stage="${stage}"]');
    if (!card || !column) return null;
    column.scrollIntoView({ block: "nearest", inline: "center" });
    card.scrollIntoView({ block: "center", inline: "nearest" });
    const c = card.getBoundingClientRect();
    const t = column.querySelector("ol").getBoundingClientRect();
    return JSON.stringify({ from: [c.x + c.width / 2, c.y + 18], to: [t.x + t.width / 2, t.y + 24] });
  }`);
  if (!points) return false;
  const { from, to } = typeof points === "string" ? JSON.parse(points) : points;
  cli("mousemove", String(Math.round(from[0])), String(Math.round(from[1])));
  cli("mousedown");
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    const x = from[0] + ((to[0] - from[0]) * step) / steps;
    const y = from[1] + ((to[1] - from[1]) * step) / steps;
    cli("mousemove", String(Math.round(x)), String(Math.round(y)));
  }
  return true;
}

function drop() {
  cli("mouseup");
}

async function main() {
  await db.connect();
  mkdirSync(OUT_DIR, { recursive: true });
  cli("open", `${BASE_URL}/login`);
  cli("resize", "1440", "900");
  cli("set-color-scheme", "light");

  const sales = await one(`SELECT id, name FROM "User" WHERE email = 'sales@techgear.ph'`);

  // ------------------------------------------------------------ kanban
  heading("Lead kanban, as Sales");
  login("sales@techgear.ph");
  goto("/leads");
  wait(800);

  const forward = await one(
    `SELECT id, code FROM "Lead" WHERE "ownerId" = $1 AND stage = 'NEW' ORDER BY position LIMIT 1`,
    [sales.id],
  );
  drag(forward.code, "CONTACTED");
  shoot("leads-dragging-light-1440");
  drop();
  wait(2000);
  const afterForward = await one(`SELECT stage FROM "Lead" WHERE id = $1`, [forward.id]);
  check(
    `Dragging ${forward.code} to Contacted moves it in the database`,
    afterForward.stage === "CONTACTED",
  );
  check(
    "The card is shown in Contacted",
    Boolean(
      evaluate(
        `() => !!document.querySelector('[data-stage="CONTACTED"] [data-lead-card="${forward.code}"]')`,
      ),
    ),
  );
  const audit = await one(
    `SELECT summary FROM "AuditLog" WHERE "entityType" = 'Lead' AND "entityId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
    [forward.id],
  );
  check(
    "The stage change is in the audit log",
    audit?.summary?.includes("to Contacted"),
    audit?.summary,
  );

  const skip = await one(
    `SELECT id, code FROM "Lead" WHERE "ownerId" = $1 AND stage = 'NEW' ORDER BY position LIMIT 1`,
    [sales.id],
  );
  drag(skip.code, "QUOTED");
  drop();
  wait(600);
  const refusal = text();
  shoot("leads-refused-light-1440");
  check(
    "A two-stage jump is refused with the missing step named",
    refusal.includes("Move it to Contacted first"),
  );
  const afterSkip = await one(`SELECT stage FROM "Lead" WHERE id = $1`, [skip.id]);
  check(`${skip.code} stays in New`, afterSkip.stage === "NEW");
  check(
    "The card is back in its column",
    Boolean(
      evaluate(
        `() => !!document.querySelector('[data-stage="NEW"] [data-lead-card="${skip.code}"]')`,
      ),
    ),
  );

  const foreign = await one(
    `SELECT code FROM "Lead" WHERE "ownerId" <> $1 AND stage IN ('NEW','CONTACTED','QUOTED') LIMIT 1`,
    [sales.id],
  );
  check(
    `Another salesperson's lead (${foreign.code}) is locked for Sales`,
    // A locked card offers no move handle: the keyboard cannot pick it up and
    // the pointer sensor is disabled for it.
    evaluate(
      `() => String(document.querySelector('[data-lead-card="${foreign.code}"] [aria-roledescription="draggable lead"]') === null)`,
    ) === "true",
  );

  const quoted = await one(
    `SELECT id, code, "customerId" FROM "Lead" WHERE "ownerId" = $1 AND stage = 'QUOTED' AND "customerId" IS NULL ORDER BY position LIMIT 1`,
    [sales.id],
  );
  if (quoted) {
    drag(quoted.code, "WON");
    drop();
    wait(800);
    const dialogOpen = text().includes(`Win ${quoted.code}`);
    check("Dropping a quoted lead on Won asks to convert it", dialogOpen);
    shoot("leads-convert-light-1440");
    cli("click", "text=Mark won");
    wait(2200);
    const won = await one(
      `SELECT l.stage, c.code, c.tags FROM "Lead" l LEFT JOIN "Customer" c ON c.id = l."customerId" WHERE l.id = $1`,
      [quoted.id],
    );
    check(
      `${quoted.code} is won and became customer ${won?.code ?? "none"}`,
      won?.stage === "WON" && Boolean(won?.code) && won.tags.includes("from-lead"),
    );
  } else {
    check("A quoted lead without a customer exists for the convert flow", false);
  }

  // --------------------------------------------------------- my tasks
  heading("My tasks");
  goto("/activities/mine");
  wait(600);
  const task = await one(
    `SELECT id, subject FROM "Activity" WHERE "ownerId" = $1 AND status = 'OPEN' ORDER BY "dueAt" LIMIT 1`,
    [sales.id],
  );
  cli("click", `[data-activity="${task.id}"] button[role=checkbox]`);
  wait(1500);
  const ticked = await one(`SELECT status, "completedAt" FROM "Activity" WHERE id = $1`, [task.id]);
  check(
    `Ticking "${task.subject}" completes it`,
    ticked.status === "DONE" && ticked.completedAt !== null,
  );

  // ----------------------------------------------------------- ticket
  heading("Support ticket");
  goto("/customers/cus_000019");
  wait(500);
  cli("click", "text=New ticket");
  wait(1500);
  const subject = `Keycaps fading after two weeks ${Date.now() % 10000}`;
  cli("fill", "#ticket-subject", subject);
  cli(
    "fill",
    "#ticket-description",
    "Legends on the WASD keys are wearing off. Customer uses the board daily for work.",
  );
  cli("click", "text=High");
  cli("click", "button[type=submit]");
  wait(2500);
  const ticket = await one(
    `SELECT id, "ticketNumber", "assigneeId", "customerId", "slaDueAt", "firstResponseAt" FROM "Ticket" WHERE subject = $1`,
    [subject],
  );
  check(
    `Opening a ticket from Customer 360 creates ${ticket?.ticketNumber ?? "nothing"}`,
    Boolean(ticket),
  );
  check(
    "It belongs to that customer and is assigned to its opener",
    ticket?.customerId === "cus_000019" && ticket?.assigneeId === sales.id,
  );
  check("It has no first response yet", ticket?.firstResponseAt === null);
  cli(
    "fill",
    "#ticket-reply",
    "Sorry to hear that. A replacement set of PBT keycaps is on its way today.",
  );
  cli("click", "text=Send reply");
  wait(1800);
  shoot("ticket-replied-light-1440");
  const replied = await one(`SELECT "firstResponseAt" FROM "Ticket" WHERE id = $1`, [ticket.id]);
  check("The first reply stamps the first response time", replied.firstResponseAt !== null);

  // --------------------------------------------------------- customer
  heading("New customer");
  goto("/customers/new");
  wait(800);
  const phone = `0917 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-7, -3)}`;
  cli("fill", "#firstName", "Josefina");
  cli("fill", "#lastName", "Macaraeg");
  cli("fill", "#phone", phone);
  cli("select", "#province", "Metro Manila");
  wait(200);
  cli("select", "#city", "Quezon City");
  cli("fill", "#barangay", "Loyola Heights");
  cli("fill", "#line1", "Unit 4C, 21 Esteban Abada Street");
  cli("click", "text=Add customer");
  wait(2500);
  const created = await one(
    `SELECT c.code, a.city, a."postalCode" FROM "Customer" c JOIN "Address" a ON a."customerId" = c.id WHERE c.phone = $1`,
    [phone],
  );
  check(
    `The customer is saved as ${created?.code ?? "nothing"} with a Quezon City address and postal code`,
    created?.city === "Quezon City" && created?.postalCode === "1101",
  );
  check(
    "The browser lands on their Customer 360",
    text().includes("Josefina Macaraeg") && text().includes("Purchase history"),
  );

  // ------------------------------------------------------------- rbac
  heading("Who sees what");
  goto("/activities");
  wait(400);
  check("Sales cannot open All activities", /do not have access/i.test(text()));

  login("warehouse@techgear.ph");
  goto("/leads");
  wait(400);
  check("Warehouse cannot open the lead board", /do not have access/i.test(text()));
  goto("/customers");
  wait(400);
  const directory = text();
  check("Warehouse can read the directory", directory.includes("Customers"));
  check(
    "...without lifetime value",
    !directory.includes("LIFETIME VALUE") && !directory.includes("Lifetime value"),
  );
  goto("/customers/cus_000019");
  wait(400);
  check("Warehouse cannot open Customer 360", /do not have access/i.test(text()));
  goto("/activities/mine");
  wait(400);
  check("Warehouse has its own task list", text().includes("Stage the pallet"));

  const consoleErrors = cli("console", "error");
  check(
    "No console errors during the run",
    !/\[ERROR\]/.test(consoleErrors),
    consoleErrors.slice(0, 400),
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
  await db.end().catch(() => undefined);
  process.exit(1);
});
