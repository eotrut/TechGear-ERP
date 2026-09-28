/**
 * Driving the Playwright CLI from node, shared by the sweeps in scripts/.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const BASE_URL = process.env.SHOOT_BASE_URL ?? "http://localhost:3000";

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

let session = null;

/**
 * Each sweep drives its own named browser session, so the screenshot sweep
 * and the accessibility sweep can run side by side without navigating each
 * other's page.
 */
export function setSession(name) {
  session = name;
}

export function cli(...args) {
  const target = session ? [`-s=${session}`] : [];
  return execFileSync(process.execPath, [CLI_ENTRY, ...target, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Admin sees the most, so it is the account used for authenticated captures
 * unless a page names another role with `as`.
 */
const DEMO_PASSWORD = "techgear123";
const emailFor = (role = "admin") => `${role}@techgear.ph`;

export function wait(ms) {
  cli("--raw", "eval", `() => new Promise((r) => setTimeout(r, ${Number(ms)}))`);
}

export function signIn(role) {
  cli("cookie-clear");
  cli("goto", `${BASE_URL}/login`);
  cli("fill", "#email", emailFor(role));
  cli("fill", "#password", DEMO_PASSWORD);
  cli("click", "button[type=submit]");
  wait(1500);
}

export function signOut() {
  cli("cookie-clear");
}

/** A page's `steps` from the manifest: [command, ...args], or ["wait", ms]. */
export function runSteps(steps = []) {
  for (const [command, ...args] of steps) {
    if (command === "wait") wait(args[0]);
    else cli(command, ...args.map(String));
  }
}
