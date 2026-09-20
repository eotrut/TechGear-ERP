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

/** name -> route. Extend as pages land. */
const PAGES = {
  dashboard: "/dashboard",
  design: "/design",
};

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

cli("open", `${BASE_URL}${PAGES[targets[0]]}`);

let shots = 0;
for (const name of targets) {
  for (const theme of THEMES) {
    cli("set-color-scheme", theme);
    for (const viewport of VIEWPORTS) {
      cli("resize", String(viewport.width), String(viewport.height));
      cli("goto", `${BASE_URL}${PAGES[name]}`);
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
