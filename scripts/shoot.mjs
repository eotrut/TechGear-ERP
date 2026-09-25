#!/usr/bin/env node
/**
 * Scripted Playwright CLI screenshot sweep.
 *
 * SPEC section 3.3 requires every page to be captured at 1440, 1024 and 390
 * in both light and dark, with the console checked for errors. Doing that by
 * hand across dozens of pages is where the effort would go instead of into
 * looking at the output, so it lives here. See docs/PLAN.md risk RK-5.
 *
 * Usage:
 *   node scripts/shoot.mjs                 # every page in the manifest
 *   node scripts/shoot.mjs dashboard       # one page by name
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "docs/screenshots";
const CLI_DIR = ".playwright-cli";

/**
 * name -> route. Extend as pages land.
 * `auth: false` marks a page that must be captured signed out.
 */
const PAGES = {
  login: { route: "/login", auth: false },
  dashboard: { route: "/dashboard", auth: true },
  design: { route: "/design", auth: true },
  account: { route: "/account", auth: true },
  audit: { route: "/audit", auth: true },
  users: { route: "/settings/users", auth: true },
  products: { route: "/products", auth: true },
  // Deterministic seed ids, so the detail captures are the same product every run.
  "products-low": { route: "/products?stock=low", auth: true },
  "product-detail": { route: "/products/prd_000001", auth: true },
  "product-edit": { route: "/products/prd_000001/edit", auth: true },
  "product-new": { route: "/products/new", auth: true },
  "product-import": { route: "/products/import", auth: true },
  categories: { route: "/categories", auth: true },
  brands: { route: "/brands", auth: true },
  suppliers: { route: "/suppliers", auth: true },
  warehouses: { route: "/warehouses", auth: true },
  inventory: { route: "/inventory", auth: true },
  "inventory-alerts": { route: "/inventory/alerts", auth: true },
  "inventory-reorder": { route: "/inventory/alerts?view=reorder", auth: true },
  "inventory-ledger": { route: "/inventory/ledger", auth: true },
  "inventory-ledger-variant": { route: "/inventory/ledger?variantId=var_000001", auth: true },
  adjustments: { route: "/inventory/adjustments", auth: true },
  // adj_000007 is the seeded cycle count: counts, confirmations and write-offs.
  "adjustment-detail": { route: "/inventory/adjustments/adj_000007", auth: true },
  "adjustment-new": { route: "/inventory/adjustments/new?variantId=var_000006", auth: true },
  transfers: { route: "/inventory/transfers", auth: true },
  // trf_000005 is in transit (receive and recall actions); trf_000004 arrived short.
  "transfer-detail": { route: "/inventory/transfers/trf_000005", auth: true },
  "transfer-received": { route: "/inventory/transfers/trf_000004", auth: true },
  "transfer-new": { route: "/inventory/transfers/new?variantId=var_000006&qty=4", auth: true },
  customers: { route: "/customers", auth: true },
  "customers-vip": { route: "/customers?segment=VIP", auth: true },
  // cus_000019 is a VIP business account with a year of orders and an open ticket.
  "customer-360": { route: "/customers/cus_000019", auth: true },
  "customer-new": { route: "/customers/new", auth: true },
  "customer-edit": { route: "/customers/cus_000019/edit", auth: true },
  leads: { route: "/leads", auth: true },
  // led_000013 is quoted, so every stage action shows; led_000023 is won.
  "lead-detail": { route: "/leads/led_000013", auth: true },
  "lead-won": { route: "/leads/led_000023", auth: true },
  "my-tasks": { route: "/activities/mine", auth: true },
  activities: { route: "/activities", auth: true },
  tickets: { route: "/tickets", auth: true },
  // tkt_000016 is urgent and in progress, with an order, replies and a note.
  "ticket-detail": { route: "/tickets/tkt_000016", auth: true },
  "ticket-new": { route: "/tickets/new?customerId=cus_000019", auth: true },
  orders: { route: "/orders", auth: true },
  "orders-to-fulfil": { route: "/orders?view=to-fulfil", auth: true },
  // ord_000737 is a completed Shopee order with a promo; ord_000944 was partly
  // refunded; ord_001040 is pending, holding stock; ord_000016 is a POS sale
  // split between cash and another method.
  "order-detail": { route: "/orders/ord_000737", auth: true },
  "order-refunded": { route: "/orders/ord_000944", auth: true },
  "order-pending": { route: "/orders/ord_001040", auth: true },
  "order-new": { route: "/orders/new", auth: true },
  returns: { route: "/returns", auth: true },
  // ret_000072 restocked one line and wrote one off; ret_000083 waits on approval.
  "return-detail": { route: "/returns/ret_000072", auth: true },
  "return-requested": { route: "/returns/ret_000083", auth: true },
  "return-new": { route: "/returns/new?orderId=ord_001020", auth: true },
  warranty: { route: "/warranty?view=all", auth: true },
  // wcl_000003 is approved, so the replace and refund actions show.
  "claim-detail": { route: "/warranty/wcl_000003", auth: true },
  "claim-new": { route: "/warranty/new?orderItemId=oit_ord_001033_0", auth: true },
  promos: { route: "/promos", auth: true },
  invoice: { route: "/print/invoice/ord_000737", auth: true },
  receipt: { route: "/print/receipt/ord_000016", auth: true },
  purchasing: { route: "/purchasing", auth: true },
  "purchasing-open": { route: "/purchasing?view=open", auth: true },
  // po_000009 arrived in two deliveries with dock rejects; po_000010 is partly
  // received with a part-paid bill; po_000004 was closed short.
  "po-detail": { route: "/purchasing/po_000009", auth: true },
  "po-partial": { route: "/purchasing/po_000010", auth: true },
  "po-closed-short": { route: "/purchasing/po_000004", auth: true },
  "po-receive": { route: "/purchasing/po_000012/receive", auth: true },
  "po-new": { route: "/purchasing/new?supplierId=sup_000001&reorder=1", auth: true },
  "po-edit": { route: "/purchasing/po_000015/edit", auth: true },
  bills: { route: "/purchasing/bills", auth: true },
  "bill-detail": { route: "/purchasing/bills/bil_000009", auth: true },
  "bill-new": { route: "/purchasing/bills/new", auth: true },
  "supplier-detail": { route: "/suppliers/sup_000001", auth: true },
  // The register, and the post-sale screen for the seeded split POS sale.
  pos: { route: "/pos", auth: true },
  "pos-receipt": { route: "/pos/receipt/ord_000016", auth: true },
};

/** Admin sees the most, so it is the account used for authenticated captures. */
const DEMO_EMAIL = "admin@techgear.ph";
const DEMO_PASSWORD = "techgear123";

const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "1024", width: 1024, height: 768 },
  { label: "390", width: 390, height: 844 },
];

const THEMES = ["light", "dark"];

/**
 * Run the CLI's JS entry point under the current node rather than the npm
 * shim. Node 24 refuses to spawn a .cmd without a shell, and using a shell
 * would mean unescaped argument concatenation.
 */
const CLI_ENTRY = (() => {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    // npm global prefix on Windows, and the usual unix layout.
    process.env.APPDATA && join(process.env.APPDATA, "npm", "node_modules"),
    join(nodeDir, "node_modules"),
    join(nodeDir, "..", "lib", "node_modules"),
  ].filter(Boolean);

  for (const root of candidates) {
    const entry = join(root, "@playwright", "cli", "playwright-cli.js");
    if (existsSync(entry)) return entry;
  }

  console.error(
    "Could not find @playwright/cli. Install it with: npm install -g @playwright/cli@latest",
  );
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
 * Dev-server noise we do not want to fail on: Fast Refresh chatter and the
 * React DevTools suggestion. Anything else at warn or above is a real finding.
 */
const IGNORED = [/\[Fast Refresh\]/, /Download the React DevTools/, /react-devtools/];

function readConsoleSinceLastRun() {
  let files;
  try {
    files = readdirSync(CLI_DIR).filter((f) => f.startsWith("console-"));
  } catch {
    return [];
  }
  return files
    .flatMap((file) => readFileSync(join(CLI_DIR, file), "utf8").split("\n"))
    .filter((line) => /\[(ERROR|WARNING)\]/.test(line))
    .filter((line) => !IGNORED.some((pattern) => pattern.test(line)));
}

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : Object.keys(PAGES);

for (const name of targets) {
  if (!PAGES[name]) {
    console.error(`Unknown page "${name}". Known: ${Object.keys(PAGES).join(", ")}`);
    process.exit(1);
  }
}

mkdirSync(OUT_DIR, { recursive: true });
// Start from a clean console log so findings belong to this run.
rmSync(CLI_DIR, { recursive: true, force: true });

cli("open", `${BASE_URL}/login`);

function signIn() {
  cli("goto", `${BASE_URL}/login`);
  cli("fill", "#email", DEMO_EMAIL);
  cli("fill", "#password", DEMO_PASSWORD);
  cli("click", "button[type=submit]");
  cli("--raw", "eval", "() => new Promise((r) => setTimeout(r, 1500))");
}

function signOut() {
  cli("cookie-clear");
}

let shots = 0;
let signedIn = false;

for (const name of targets) {
  const page = PAGES[name];

  // Authenticated pages need a session; the login page needs the opposite.
  if (page.auth && !signedIn) {
    signIn();
    signedIn = true;
  } else if (!page.auth && signedIn) {
    signOut();
    signedIn = false;
  }

  for (const theme of THEMES) {
    cli("set-color-scheme", theme);
    for (const viewport of VIEWPORTS) {
      cli("resize", String(viewport.width), String(viewport.height));
      cli("goto", `${BASE_URL}${page.route}`);
      cli(
        "screenshot",
        "--filename",
        `${OUT_DIR}/${name}-${theme}-${viewport.label}.png`,
        "--full-page",
      );
      shots += 1;
      console.log(`captured ${name}-${theme}-${viewport.label}.png`);
    }
  }
}

cli("close");

const problems = readConsoleSinceLastRun();
console.log(`\n${shots} screenshots written to ${OUT_DIR}`);

if (problems.length > 0) {
  console.error(`\nConsole is not clean. ${problems.length} entries:`);
  for (const line of problems.slice(0, 25)) console.error(`  ${line}`);
  process.exit(1);
}

console.log("Console clean: no errors or warnings.");
