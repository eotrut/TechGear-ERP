/**
 * Resolves manifest routes that need a record in a particular state.
 *
 * The seed is deterministic in shape but dated relative to the day it runs
 * (D-15), so which order is still pending, or which return is still waiting,
 * depends on when it was seeded. A fixed id photographs a 404 the next week. A
 * page with `find` names the state instead, as one SQL query returning an id,
 * and its route takes the id where it says `{id}`.
 */
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

export async function resolveRoutes(pages, names) {
  const pending = names.filter((name) => pages[name].find);
  if (pending.length === 0) return;

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    for (const name of pending) {
      const page = pages[name];
      const { rows } = await db.query(page.find);
      const id = rows[0] && Object.values(rows[0])[0];
      if (!id) {
        throw new Error(`No record for "${name}". Its query found nothing:\n  ${page.find}`);
      }
      page.route = page.route.replace("{id}", encodeURIComponent(id));
    }
  } finally {
    await db.end();
  }
}
