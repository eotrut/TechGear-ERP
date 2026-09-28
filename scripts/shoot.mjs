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
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { BASE_URL, cli, runSteps, signIn, signOut, setSession } from "./lib/browser.mjs";
import { resolveRoutes } from "./lib/records.mjs";
import { PAGES } from "./pages.mjs";

setSession("shoot");

const OUT_DIR = "docs/screenshots";
const CLI_DIR = ".playwright-cli";

const VIEWPORTS = [
  { label: "1440", width: 1440, height: 900 },
  { label: "1024", width: 1024, height: 768 },
  { label: "390", width: 390, height: 844 },
];

const THEMES = ["light", "dark"];

/**
 * Dev-server noise we do not want to fail on: Fast Refresh chatter and the
 * React DevTools suggestion. Anything else at warn or above is a real finding.
 */
const IGNORED = [/\[Fast Refresh\]/, /Download the React DevTools/, /react-devtools/];

/** A page that is meant to answer 403 or 404 logs exactly that for its own URL. */
function expectedStatusLine(line) {
  return targets.some((name) => {
    const { expectStatus, route } = PAGES[name];
    return (
      expectStatus !== undefined &&
      line.includes(`status of ${expectStatus} `) &&
      line.includes(`@ ${BASE_URL}${route}:`)
    );
  });
}

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
    .filter((line) => !IGNORED.some((pattern) => pattern.test(line)))
    .filter((line) => !expectedStatusLine(line));
}

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : Object.keys(PAGES);

for (const name of targets) {
  if (!PAGES[name]) {
    console.error(`Unknown page "${name}". Known: ${Object.keys(PAGES).join(", ")}`);
    process.exit(1);
  }
}

await resolveRoutes(PAGES, targets);

mkdirSync(OUT_DIR, { recursive: true });
// Start from a clean console log so findings belong to this run.
rmSync(CLI_DIR, { recursive: true, force: true });

cli("open", `${BASE_URL}/login`);

let shots = 0;
/** The role currently signed in, or null when signed out. */
let signedInAs = null;

for (const name of targets) {
  const page = PAGES[name];

  // Authenticated pages need a session; the login page needs the opposite.
  const role = page.as ?? "admin";
  if (page.auth && signedInAs !== role) {
    signIn(role);
    signedInAs = role;
  } else if (!page.auth && signedInAs) {
    signOut();
    signedInAs = null;
  }

  for (const theme of THEMES) {
    cli("set-color-scheme", theme);
    for (const viewport of VIEWPORTS) {
      cli("resize", String(viewport.width), String(viewport.height));
      cli("goto", `${BASE_URL}${page.route}`);
      runSteps(page.steps);
      cli(
        "screenshot",
        "--filename",
        `${OUT_DIR}/${name}-${theme}-${viewport.label}.png`,
        ...(page.fullPage === false ? [] : ["--full-page"]),
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
