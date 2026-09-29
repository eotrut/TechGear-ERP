import type { Page } from "@playwright/test";

import { one } from "./support/db";
import { expect, signIn, test } from "./support/fixtures";

/**
 * Sales drags one of their leads a stage along the kanban and the stage
 * changes in the database. A drag that skips a stage is refused, names the
 * step it skipped, and leaves the lead where it was.
 */
test("a lead changes stage on the kanban", async ({ page }) => {
  const sales = await one<{ id: string }>(
    `SELECT id FROM "User" WHERE email = 'sales@techgear.ph'`,
  );
  const [forward, skip] = await Promise.all([0, 1].map((offset) => newLead(sales!.id, offset)));
  expect(forward && skip, "Sales owns at least two new leads").toBeTruthy();

  await signIn(page, "sales");
  await page.goto("/leads");

  await drag(page, forward!.code, "CONTACTED");
  await expect(
    page.locator(`[data-stage="CONTACTED"] [data-lead-card="${forward!.code}"]`),
  ).toBeVisible();
  await expect.poll(async () => (await leadStage(forward!.id))?.stage).toBe("CONTACTED");

  await drag(page, skip!.code, "QUOTED");
  await expect(page.getByText("Move it to Contacted first").first()).toBeVisible();
  await expect(page.locator(`[data-stage="NEW"] [data-lead-card="${skip!.code}"]`)).toBeVisible();
  expect((await leadStage(skip!.id))?.stage).toBe("NEW");
});

function newLead(ownerId: string, offset: number) {
  return one<{ id: string; code: string }>(
    `SELECT id, code FROM "Lead" WHERE "ownerId" = $1 AND stage = 'NEW'
      ORDER BY position OFFSET $2 LIMIT 1`,
    [ownerId, offset],
  );
}

function leadStage(id: string) {
  return one<{ stage: string }>(`SELECT stage FROM "Lead" WHERE id = $1`, [id]);
}

/**
 * A real pointer drag. dnd-kit starts a drag only after the pointer travels
 * its activation distance, and resolves the drop target from the columns it
 * passes over, so the pointer moves in steps rather than jumping.
 */
async function drag(page: Page, code: string, stage: string): Promise<void> {
  const card = page.locator(`[data-lead-card="${code}"]`);
  const column = page.locator(`[data-stage="${stage}"] ol`);
  await column.scrollIntoViewIfNeeded();
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await column.boundingBox();
  if (!from || !to) throw new Error(`Cannot find lead ${code} or the ${stage} column`);

  await page.mouse.move(from.x + from.width / 2, from.y + 18);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 24, { steps: 12 });
  await page.mouse.up();
}
