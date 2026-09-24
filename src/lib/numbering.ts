import { Prisma } from "@prisma/client";

import { manilaYear } from "@/lib/format";

/**
 * Document numbers: ADJ-2026-0041, TRF-2026-0012.
 *
 * Numbers are gapless and reset each Manila calendar year. The counter is a row
 * in AppSetting incremented with a single INSERT ... ON CONFLICT DO UPDATE,
 * which takes a row lock that is held until the surrounding transaction
 * commits. Two people saving an adjustment at the same instant therefore get
 * consecutive numbers, and a rolled-back save gives its number back.
 *
 * Lock ordering matters here. The counter must be the first lock a stock
 * transaction takes, before any variant row, so that every stock transaction
 * acquires locks in the same order and none can deadlock another. The stock
 * services call this before touching stock for exactly that reason.
 *
 * The first allocation in a year floors itself on the highest number already
 * in the table, so seeded documents and a missing counter row can never
 * produce a duplicate.
 */

const SEQUENCES = {
  ADJ: Prisma.raw(`"StockAdjustment"`),
  TRF: Prisma.raw(`"StockTransfer"`),
} as const;

export type ReferenceKind = keyof typeof SEQUENCES;

export function formatReference(kind: ReferenceKind, year: number, sequence: number): string {
  return `${kind}-${year}-${String(sequence).padStart(4, "0")}`;
}

export async function nextReference(
  tx: Prisma.TransactionClient,
  kind: ReferenceKind,
  at: Date = new Date(),
): Promise<string> {
  const year = manilaYear(at);
  const prefix = `${kind}-${year}-`;
  const key = `sequence.${kind}.${year}`;

  // split_part rather than substring: with a bound parameter Postgres resolves
  // substring(text FROM $1) to the regex overload and quietly returns null.
  const [floorRow] = await tx.$queryRaw<{ floor: number }[]>`
    SELECT COALESCE(MAX(split_part(reference, '-', 3)::int), 0)::int AS floor
    FROM ${SEQUENCES[kind]}
    WHERE reference ~ ${`^${prefix}[0-9]+$`}
  `;
  const floor = floorRow?.floor ?? 0;

  const [row] = await tx.$queryRaw<{ n: number }[]>`
    INSERT INTO "AppSetting" (key, value, "updatedAt")
    VALUES (${key}, to_jsonb(${floor + 1}::int), clock_timestamp() AT TIME ZONE 'UTC')
    ON CONFLICT (key) DO UPDATE
      SET value = to_jsonb(GREATEST(
            ("AppSetting".value #>> '{}')::int + 1,
            (EXCLUDED.value #>> '{}')::int
          )),
          "updatedAt" = EXCLUDED."updatedAt"
    RETURNING (value #>> '{}')::int AS n
  `;

  if (!row) throw new Error(`Could not allocate a ${kind} reference.`);
  return formatReference(kind, year, row.n);
}
