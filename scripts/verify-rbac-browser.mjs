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

function cli(...args) {
  return execFileSync(process.execPath, [CLI_ENTRY, ...args], {
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
  // Server action plus redirect; give the navigation a moment to settle.
  cli("--raw", "eval", "() => new Promise((r) => setTimeout(r, 1200))");
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
const EXPECTATIONS = [
  {
    role: "Admin",
    email: "admin@techgear.ph",
    allowed: ["/dashboard", "/audit", "/settings", "/settings/users", "/account"],
    forbidden: [],
    navExpect: ["Dashboard", "Settings", "Audit log"],
  },
  {
    role: "Manager",
    email: "manager@techgear.ph",
    allowed: ["/dashboard", "/audit", "/account"],
    forbidden: ["/settings", "/settings/users"],
    navExpect: ["Dashboard", "Audit log"],
    navAbsent: ["Settings"],
  },
  {
    role: "Sales",
    email: "sales@techgear.ph",
    allowed: ["/dashboard", "/account"],
    forbidden: ["/audit", "/settings", "/settings/users", "/expenses", "/purchasing"],
    navExpect: ["Dashboard"],
    navAbsent: ["Audit log", "Settings"],
  },
  {
    role: "Warehouse",
    email: "warehouse@techgear.ph",
    allowed: ["/dashboard", "/account"],
    forbidden: ["/audit", "/settings", "/settings/users", "/expenses", "/leads", "/tickets"],
    navExpect: ["Dashboard"],
    navAbsent: ["Audit log", "Settings"],
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
