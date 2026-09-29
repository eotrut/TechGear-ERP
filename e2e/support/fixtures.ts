import { test as base, expect, type Page } from "@playwright/test";

export type DemoRole = "admin" | "manager" | "sales" | "warehouse";

export const DEMO_PASSWORD = "techgear123";

export async function signIn(page: Page, role: DemoRole): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator("#email").fill(`${role}@techgear.ph`);
  await page.locator("#password").fill(DEMO_PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * Every spec fails on an uncaught page error or a console error, the same bar
 * `npm run shoot` holds the screenshots to. "Failed to load resource" is left
 * out because a 403 page is served with a 403 status on purpose; the specs
 * that visit one assert on what rendered instead.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (message.text().startsWith("Failed to load resource")) return;
        errors.push(`console: ${message.text()}`);
      });
      await provide(errors);
      expect(errors, "the page logged errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
