#!/usr/bin/env node
/**
 * Drives a real browser through every role and checks that each one sees
 * exactly what the permission matrix says it should.
 *
 * SPEC section 3.3: never claim a UI task is done from reading code. This signs
 * in as all four demo accounts, visits allowed and forbidden routes, asserts on
 * what actually rendered, and captures screenshots.
 *
 * Usage: npm run verify:rbac
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "docs/screenshots";
const PASSWORD = "techgear123";

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

/** Its own browser session, so it can run beside a screenshot sweep. */
const SESSION = "-s=rbac-verify";

function cli(...args) {
  return execFileSync(process.execPath, [CLI_ENTRY, SESSION, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Visible text of the page, which is what we assert against.
 * `--raw` returns only the evaluated value; without it the CLI wraps the result
 * in a status report and every assertion matches the wrapper instead.
 */
function pageText() {
  const raw = cli("--raw", "eval", "() => document.body.innerText");
  return raw.replace(/\s+/g, " ");
}

function currentUrl() {
  return cli("--raw", "eval", "() => location.pathname").trim().replace(/^"|"$/g, "");
}

/** Navigate, tolerating an aborted navigation so the run can report it. */
function goto(url) {
  try {
    cli("goto", url);
  } catch {
    // A rewrite to the 403 page can abort the original navigation in Chrome.
    // The assertions below look at what actually rendered.
  }
}

let failures = 0;
let checks = 0;

function check(label, passed, detail) {
  checks += 1;
  if (passed) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function login(email) {
  goto(`${BASE_URL}/login`);
  cli("fill", "#email", email);
  cli("fill", "#password", PASSWORD);
  cli("click", "button[type=submit]");
  // Server action plus redirect. Poll for it rather than sleeping a fixed
  // time: a cold dev server compiling /dashboard for the first time takes
  // several seconds, and a fixed wait read the URL before it had changed.
  cli(
    "--raw",
    "eval",
    `async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline && location.pathname.startsWith("/login")) {
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 300));
    }`,
  );
}

function logout() {
  // Clearing cookies is faster and less brittle than driving the menu, and the
  // sign-out flow itself is exercised separately below.
  cli("cookie-clear");
}

/**
 * Who should see what. "allowed" must render; "forbidden" must land on the 403
 * page rather than the real thing.
 */
const STOCK_ROUTES = [
  "/inventory",
  "/inventory/alerts",
  "/inventory/ledger",
  "/inventory/adjustments",
  "/inventory/adjustments/new",
  "/inventory/transfers",
  "/inventory/transfers/new",
  // Seeded, deterministic: the in-transit transfer.
  "/inventory/transfers/trf_000005",
];

/** The CRM, Phase 6. Seeded ids: a VIP account, a quoted lead, an urgent ticket. */
const CRM_ROUTES = [
  "/customers",
  "/customers/new",
  "/customers/cus_000019",
  "/customers/cus_000019/edit",
  "/leads",
  "/leads/led_000013",
  "/activities/mine",
  "/tickets",
  "/tickets/new",
  "/tickets/tkt_000016",
];

/** Finance, Phase 10. Every report, the index and the expense register. */
const ALL_REPORTS = [
  "/reports",
  "/reports/sales",
  "/reports/gross-profit",
  "/reports/pl",
  "/reports/vat",
  "/reports/aging",
  "/reports/purchases",
  "/reports/inventory-valuation",
  "/reports/stock-movement",
  "/reports/slow-moving",
  "/reports/customer-ltv",
];
const FINANCE_REPORTS = [
  "/reports/gross-profit",
  "/reports/pl",
  "/reports/vat",
  "/reports/aging",
  "/reports/purchases",
];
const INVENTORY_REPORTS = [
  "/reports/inventory-valuation",
  "/reports/stock-movement",
  "/reports/slow-moving",
];
const EXPORT_DENIED = "You do not have permission to export";

const EXPECTATIONS = [
  {
    role: "Admin",
    email: "admin@techgear.ph",
    allowed: [
      "/dashboard",
      "/audit",
      "/settings",
      "/settings/users",
      "/account",
      ...STOCK_ROUTES,
      ...CRM_ROUTES,
      "/activities",
      ...ALL_REPORTS,
      "/expenses",
      "/expenses/new",
      "/expenses/exp_000001",
    ],
    forbidden: [],
    navExpect: [
      "Dashboard",
      "Settings",
      "Audit log",
      "Stock",
      "Alerts",
      "Adjustments",
      "Transfers",
      "Reports",
      "Expenses",
    ],
    content: [
      {
        route: "/dashboard",
        present: ["Revenue today", "Gross margin this month", "Pipeline value", "Performance"],
      },
      { route: "/expenses/exp_000001", present: ["Delete", "Save changes"] },
    ],
  },
  {
    role: "Manager",
    email: "manager@techgear.ph",
    allowed: [
      "/dashboard",
      "/audit",
      "/account",
      ...STOCK_ROUTES,
      ...CRM_ROUTES,
      "/activities",
      ...ALL_REPORTS,
      "/expenses",
      "/expenses/new",
    ],
    forbidden: ["/settings", "/settings/users"],
    navExpect: [
      "Dashboard",
      "Audit log",
      "Stock",
      "Alerts",
      "Adjustments",
      "Transfers",
      "Reports",
      "Expenses",
    ],
    navAbsent: ["Settings"],
    content: [
      // Managers record and correct expenses; deleting one is an Admin call.
      { route: "/expenses/exp_000001", present: ["Save changes"], absent: ["Delete"] },
    ],
  },
  {
    role: "Sales",
    email: "sales@techgear.ph",
    // Sales reads stock and the ledger, and nothing that moves or replans it.
    allowed: [
      "/dashboard",
      "/account",
      "/inventory",
      "/inventory/ledger",
      ...CRM_ROUTES,
      "/reports",
      "/reports/sales",
      "/reports/customer-ltv",
    ],
    forbidden: [
      ...FINANCE_REPORTS,
      ...INVENTORY_REPORTS,
      "/expenses/new",
      "/audit",
      "/settings",
      "/settings/users",
      "/expenses",
      "/purchasing",
      "/inventory/alerts",
      "/inventory/adjustments",
      "/inventory/adjustments/new",
      "/inventory/transfers",
      "/inventory/transfers/new",
      "/inventory/transfers/trf_000005",
      // Everybody's activities are a manager's view.
      "/activities",
    ],
    navExpect: [
      "Dashboard",
      "Stock",
      "Ledger",
      "Directory",
      "Leads",
      "My tasks",
      "Tickets",
      "Reports",
    ],
    navAbsent: ["Audit log", "Settings", "Adjustments", "Transfers", "All activities", "Expenses"],
    content: [
      // Their own figures, and nothing from the finance tiles.
      {
        route: "/dashboard",
        present: ["Your revenue today", "Your pipeline", "Your tasks"],
        absent: ["Gross margin", "Inventory at cost"],
      },
      { route: "/reports", present: ["Customer lifetime value"], absent: ["Profit and loss"] },
      { route: "/reports/sales?by=salesperson", present: ["Showing your own sales"] },
      { route: "/api/export/reports/pl", present: [EXPORT_DENIED] },
      {
        route: "/inventory",
        // Cost is stripped on the server for roles without products.viewCost.
        absent: ["Value at cost", "Adjust stock", "New transfer"],
        present: ["Available"],
      },
      { route: "/inventory/ledger", absent: ["Unit cost"], present: ["Balance"] },
    ],
  },
  {
    role: "Warehouse",
    email: "warehouse@techgear.ph",
    allowed: [
      "/dashboard",
      "/account",
      ...STOCK_ROUTES,
      "/customers",
      "/activities/mine",
      "/reports",
      ...INVENTORY_REPORTS,
    ],
    forbidden: [
      "/reports/sales",
      "/reports/customer-ltv",
      ...FINANCE_REPORTS,
      "/audit",
      "/settings",
      "/settings/users",
      "/expenses",
      "/leads",
      "/leads/led_000013",
      "/tickets",
      "/tickets/new",
      "/activities",
      "/customers/new",
      // Warehouse reads the directory but not lifetime value or purchase history.
      "/customers/cus_000019",
    ],
    navExpect: [
      "Dashboard",
      "Stock",
      "Alerts",
      "Adjustments",
      "Transfers",
      "Directory",
      "My tasks",
      "Reports",
    ],
    navAbsent: ["Audit log", "Settings", "Leads", "Tickets", "All activities", "Expenses"],
    content: [
      // Warehouse never sees what customers paid (D-10): no revenue anywhere.
      {
        route: "/dashboard",
        present: ["Orders to pack", "Deliveries expected", "Inventory at cost"],
        absent: ["Revenue", "Gross margin", "Pipeline"],
      },
      { route: "/api/export/reports/sales", present: [EXPORT_DENIED] },
      { route: "/customers", absent: ["Lifetime value"], present: ["Segment"] },
      { route: "/inventory", present: ["Value at cost", "Adjust stock", "New transfer"] },
      { route: "/inventory/transfers/trf_000005", present: ["Receive", "Recall"] },
    ],
  },
];

const FORBIDDEN_MARKER = "You do not have access to this page";

mkdirSync(OUT_DIR, { recursive: true });

cli("open", `${BASE_URL}/login`);
cli("resize", "1440", "900");
cli("set-color-scheme", "light");

console.log("\nUnauthenticated access");
console.log("----------------------");
logout();
goto(`${BASE_URL}/dashboard`);
check("Signed-out visit to /dashboard lands on the login page", currentUrl() === "/login");
cli("screenshot", "--filename", `${OUT_DIR}/login-light-1440.png`, "--full-page");

for (const expectation of EXPECTATIONS) {
  console.log(`\n${expectation.role} (${expectation.email})`);
  console.log("-".repeat(expectation.role.length + expectation.email.length + 3));

  logout();
  login(expectation.email);

  const landed = currentUrl();
  check(`Signs in and lands on the dashboard (at ${landed})`, landed === "/dashboard");

  const navText = pageText();
  for (const item of expectation.navExpect ?? []) {
    check(`Sidebar shows "${item}"`, navText.includes(item));
  }
  for (const item of expectation.navAbsent ?? []) {
    check(`Sidebar hides "${item}"`, !navText.includes(item));
  }

  cli(
    "screenshot",
    "--filename",
    `${OUT_DIR}/dashboard-${expectation.role.toLowerCase()}-light-1440.png`,
    "--full-page",
  );

  for (const route of expectation.allowed) {
    goto(`${BASE_URL}${route}`);
    const text = pageText();
    const onRoute = currentUrl() === route;
    check(
      `${route} is allowed`,
      onRoute && !text.includes(FORBIDDEN_MARKER),
      onRoute ? undefined : `landed on ${currentUrl()}`,
    );
  }

  for (const route of expectation.forbidden) {
    goto(`${BASE_URL}${route}`);
    const text = pageText();
    check(`${route} is blocked with the 403 page`, text.includes(FORBIDDEN_MARKER));
  }

  for (const rule of expectation.content ?? []) {
    goto(`${BASE_URL}${rule.route}`);
    // innerText applies text-transform, so small-caps labels arrive uppercased.
    const text = pageText().toLowerCase();
    for (const phrase of rule.present ?? []) {
      check(`${rule.route} shows "${phrase}"`, text.includes(phrase.toLowerCase()));
    }
    for (const phrase of rule.absent ?? []) {
      check(`${rule.route} does not show "${phrase}"`, !text.includes(phrase.toLowerCase()));
    }
  }

  // One 403 screenshot per role that has any, for the record.
  const firstForbidden = expectation.forbidden[0];
  if (firstForbidden) {
    goto(`${BASE_URL}${firstForbidden}`);
    cli(
      "screenshot",
      "--filename",
      `${OUT_DIR}/forbidden-${expectation.role.toLowerCase()}-light-1440.png`,
      "--full-page",
    );
  }
}

// ---------------------------------------------------------------- sign out
console.log("\nSign out");
console.log("--------");
logout();
login("admin@techgear.ph");
check("Signed in again before testing sign-out", currentUrl() === "/dashboard");
cli("click", "button[aria-label^='Account menu']");
cli("--raw", "eval", "() => new Promise((r) => setTimeout(r, 300))");
cli("click", "text=Sign out");
cli("--raw", "eval", "() => new Promise((r) => setTimeout(r, 1500))");
check(`Sign out returns to the login page (at ${currentUrl()})`, currentUrl() === "/login");

goto(`${BASE_URL}/dashboard`);
check("Session is really gone after sign out", currentUrl() === "/login");

cli("close");

console.log("\nSummary");
console.log("-------");
if (failures === 0) {
  console.log(`  All ${checks} checks passed.`);
} else {
  console.log(`  ${failures} of ${checks} checks FAILED.`);
  process.exitCode = 1;
}
