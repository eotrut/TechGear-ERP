/**
 * Pure audit-diff helpers, deliberately free of any database import.
 *
 * Kept separate from src/lib/audit.ts so that unit tests, and any future
 * caller that only needs to shape a diff, do not drag in Prisma and the
 * validated environment just to compare two objects.
 */

export type AuditChange = { from: unknown; to: unknown };
export type AuditChanges = Record<string, AuditChange>;

/**
 * Field-level diff between two versions of a record.
 *
 * Only fields that actually changed are kept, so an update that touched one
 * field does not produce a wall of unchanged values. `sensitive` fields are
 * recorded as having changed without storing either value, which is how
 * password changes appear in the trail without putting hashes in it.
 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  options: { sensitive?: string[]; ignore?: string[] } = {},
): AuditChanges {
  const sensitive = new Set(options.sensitive ?? ["passwordHash", "password"]);
  const ignore = new Set(options.ignore ?? ["updatedAt", "createdAt"]);

  const changes: AuditChanges = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    if (ignore.has(key)) continue;

    const from = before?.[key];
    const to = after?.[key];
    if (isEqual(from, to)) continue;

    changes[key] = sensitive.has(key)
      ? { from: "[redacted]", to: "[redacted]" }
      : { from: serialise(from), to: serialise(to) };
  }

  return changes;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(serialise(a)) === JSON.stringify(serialise(b));
  }
  return false;
}

/** Dates and bigints are not JSON, and the changes column is Json. */
export function serialise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialise(item)]));
  }
  return value;
}
