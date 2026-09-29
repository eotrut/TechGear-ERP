import { expect, signIn, test, type DemoRole } from "./support/fixtures";

/**
 * Each role signs in and sees only its own part of the app: the sidebar
 * offers what the matrix grants, a page it grants renders, and a page it does
 * not grant renders the 403 naming the missing permission. The route gate
 * table in docs/permissions.md is where these expectations come from.
 */
type RoleCase = {
  role: DemoRole;
  shows: string[];
  hides: string[];
  opens: { path: string; heading: RegExp };
  refused?: { path: string; permission: string };
};

const CASES: RoleCase[] = [
  {
    role: "admin",
    shows: ["Settings", "Audit log", "Expenses", "Point of sale", "Purchase orders"],
    hides: [],
    opens: { path: "/settings/users", heading: /users/i },
  },
  {
    role: "manager",
    shows: ["Audit log", "Expenses", "Purchase orders", "Point of sale"],
    hides: ["Settings"],
    opens: { path: "/audit", heading: /audit log/i },
    refused: { path: "/settings/users", permission: "users.view" },
  },
  {
    role: "sales",
    shows: ["Point of sale", "Leads", "Orders"],
    hides: ["Purchase orders", "Expenses", "Audit log", "Settings"],
    opens: { path: "/leads", heading: /leads/i },
    refused: { path: "/purchasing", permission: "purchasing.view" },
  },
  {
    role: "warehouse",
    shows: ["Stock", "Transfers", "Purchase orders"],
    hides: ["Point of sale", "Leads", "Expenses", "Audit log"],
    opens: { path: "/inventory/adjustments", heading: /adjustments/i },
    refused: { path: "/pos", permission: "pos.use" },
  },
];

test.describe("sign in as each role", () => {
  for (const { role, shows, hides, opens, refused } of CASES) {
    test(`${role} sees only what the matrix grants`, async ({ page }) => {
      await signIn(page, role);
      await expect(page).toHaveURL(/\/dashboard$/);

      const nav = page.getByRole("navigation", { name: "Main" });
      for (const label of shows) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      for (const label of hides) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
      }

      await page.goto(opens.path);
      await expect(page.getByRole("heading", { level: 1, name: opens.heading })).toBeVisible();

      if (refused) {
        await page.goto(refused.path);
        await expect(page.getByText("You do not have access to this page")).toBeVisible();
        await expect(page.getByText(`Missing: ${refused.permission}`)).toBeVisible();
      }
    });
  }

  test("a wrong password is refused without saying which half was wrong", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("sales@techgear.ph");
    await page.locator("#password").fill("not-the-password");
    await page.locator("button[type=submit]").click();
    await expect(
      page.getByRole("alert").filter({ hasText: /incorrect email or password/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "sales");
    await page.getByRole("button", { name: /^Account menu for / }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/login/);
  });
});
