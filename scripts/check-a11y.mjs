#!/usr/bin/env node
/**
 * Accessibility sweep: axe-core against every page in the manifest, WCAG 2.1
 * A and AA, in light and dark (contrast differs between them), at desktop
 * width. Overlays in the manifest (the palette, the notification tray) run
 * their steps first, so they are audited open.
 *
 * `check:contrast` proves the token pairs; this proves the pages actually use
 * them, and catches what tokens cannot: a missing label, a button with no
 * name, a heading level skipped, a focusable element hidden from the tree.
 *
 * Usage:
 *   node scripts/check-a11y.mjs              # every page
 *   node scripts/check-a11y.mjs orders pos   # some pages
 *
 * Exits 1 when any violation is found.
 */
import { resolve } from "node:path";

import { BASE_URL, cli, runSteps, signIn, signOut, setSession } from "./lib/browser.mjs";
import { resolveRoutes } from "./lib/records.mjs";
import { PAGES } from "./pages.mjs";

setSession("a11y");

const AXE_PATH = resolve("node_modules/axe-core/axe.min.js").replaceAll("\\", "/");
const THEMES = ["light", "dark"];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Runs inside the CLI's page context. Radix portals and Recharts SVG are
 * included; nothing is excluded, so a finding cannot hide behind a selector.
 */
const AUDIT = `async (page) => {
  await page.addScriptTag({ path: ${JSON.stringify(AXE_PATH)} });
  return await page.evaluate(async (tags) => {
    const result = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target.join(" ")),
    }));
  }, ${JSON.stringify(TAGS)});
}`;

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : Object.keys(PAGES);
for (const name of targets) {
  if (!PAGES[name]) {
    console.error(`Unknown page "${name}".`);
    process.exit(1);
  }
}

await resolveRoutes(PAGES, targets);

cli("open", `${BASE_URL}/login`);
cli("resize", "1440", "900");

/** rule id -> { help, impact, pages: Set, samples: Set } */
const findings = new Map();
let signedInAs = null;

for (const name of targets) {
  const page = PAGES[name];
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
    cli("goto", `${BASE_URL}${page.route}`);
    runSteps(page.steps);

    const raw = cli("--raw", "run-code", AUDIT).trim();
    let violations;
    try {
      violations = JSON.parse(raw);
    } catch {
      console.error(`Could not read the audit for ${name} (${theme}):\n${raw.slice(0, 400)}`);
      process.exit(1);
    }

    for (const violation of violations) {
      const entry = findings.get(violation.id) ?? {
        help: violation.help,
        impact: violation.impact,
        pages: new Set(),
        samples: new Set(),
      };
      entry.pages.add(`${name}/${theme}`);
      for (const node of violation.nodes.slice(0, 3)) entry.samples.add(node);
      findings.set(violation.id, entry);
    }
    console.log(
      `${violations.length === 0 ? "clean" : `${violations.length} rule(s)`}  ${name} ${theme}`,
    );
  }
}

cli("close");

if (findings.size === 0) {
  console.log(`\nNo WCAG 2.1 A or AA violations across ${targets.length} pages, light and dark.`);
  process.exit(0);
}

console.error(`\n${findings.size} rule(s) violated:\n`);
for (const [id, entry] of findings) {
  console.error(`  ${id} (${entry.impact}): ${entry.help}`);
  console.error(
    `    pages: ${[...entry.pages].slice(0, 8).join(", ")}${entry.pages.size > 8 ? ` and ${entry.pages.size - 8} more` : ""}`,
  );
  for (const sample of [...entry.samples].slice(0, 4)) console.error(`    at: ${sample}`);
}
process.exit(1);
