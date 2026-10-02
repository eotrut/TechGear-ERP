import type { SeedTables } from "./context";

/**
 * Seeding rule 1, enforced: nothing that already happened may be dated in the
 * future. A restock or a payment stamped after "now" reorders the ledger
 * against events computed from the final position, and a future `placedAt`
 * falls outside every report window while still counting towards the
 * customer's lifetime value, so revenue and lifetime value disagree.
 *
 * The rule was documented but unchecked, which is how an order stamped at a
 * Manila trading hour later than the moment of seeding got through.
 */

/**
 * Dates a seeded record is allowed to hold in the future, because they are a
 * target rather than a record of something that happened. Keyed by table and
 * field so a name like `dueAt` staying forward-looking on one table does not
 * excuse it everywhere.
 */
const FORWARD_LOOKING: ReadonlySet<string> = new Set([
  "activities.dueAt",
  "leads.expectedCloseDate",
  "promos.startsAt",
  "promos.endsAt",
  "purchaseOrders.expectedDate",
  "supplierBills.dueDate",
  "tickets.slaDueAt",
  "warrantyClaims.warrantyExpiresAt",
]);

export type FutureDate = { field: string; id: string; at: Date };

/** Every seeded date that records history yet lands after `now`. */
export function findFutureDates(tables: SeedTables, now: Date): FutureDate[] {
  const found: FutureDate[] = [];

  for (const [table, rows] of Object.entries(tables)) {
    for (const row of rows as Record<string, unknown>[]) {
      for (const [column, value] of Object.entries(row)) {
        const field = `${table}.${column}`;
        if (FORWARD_LOOKING.has(field)) continue;
        if (value instanceof Date && value.getTime() > now.getTime()) {
          found.push({ field, id: String(row.id ?? "unknown"), at: value });
        }
      }
    }
  }

  return found;
}

/** Throws before anything is written, naming the fields that broke the rule. */
export function assertNothingInTheFuture(tables: SeedTables, now: Date): void {
  const found = findFutureDates(tables, now);
  if (found.length === 0) return;

  const sample = found
    .slice(0, 10)
    .map((entry) => `  ${entry.field} on ${entry.id}: ${entry.at.toISOString()}`)
    .join("\n");
  const more = found.length > 10 ? `\n  ...and ${found.length - 10} more` : "";

  throw new Error(
    `Seeding rule 1: ${found.length} seeded date(s) record history but are dated after now ` +
      `(${now.toISOString()}). Wrap the derived date in clampToNow, or add the field to ` +
      `FORWARD_LOOKING if it is a target rather than a record of something that happened.\n` +
      `${sample}${more}`,
  );
}
