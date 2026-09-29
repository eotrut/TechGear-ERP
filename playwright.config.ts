import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end flows from SPEC section 9, against a running app and a seeded
 * database.
 *
 * The specs change demo data (they sell stock, receive a PO, move a lead), so
 * they run one at a time in a fixed order and read the database to prove each
 * step landed. Run `npm run db:seed` afterwards for the pristine set.
 *
 * Locally, an already running `npm run dev` is reused. In CI, the workflow
 * builds first and this starts the production server.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // The first visit to a route compiles it under `next dev`.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    locale: "en-PH",
    timezoneId: "Asia/Manila",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? "npm run start" : "npm run dev",
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
