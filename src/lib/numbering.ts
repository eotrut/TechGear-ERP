import { Prisma } from "@prisma/client";

import { manilaYear } from "@/lib/format";

/**
 * Document numbers: ADJ-2026-0041, TRF-2026-0012, TKT-2026-0021, SO-2026-004182.
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
  ADJ: { table: Prisma.raw(`"StockAdjustment"`), column: Prisma.raw(`reference`), width: 4 },
  TRF: { table: Prisma.raw(`"StockTransfer"`), column: Prisma.raw(`reference`), width: 4 },
  TKT: { table: Prisma.raw(`"Ticket"`), column: Prisma.raw(`"ticketNumber"`), width: 4 },
  // Sales orders run to thousands a year, so they carry six digits.
  SO: { table: Prisma.raw(`"Order"`), column: Prisma.raw(`"orderNumber"`), width: 6 },
  RMA: { table: Prisma.raw(`"Return"`), column: Prisma.raw(`"rmaNumber"`), width: 4 },
  WC: { table: Prisma.raw(`"WarrantyClaim"`), column: Prisma.raw(`"claimNumber"`), width: 4 },
} as const;

export type ReferenceKind = keyof typeof SEQUENCES;

export function formatReference(kind: ReferenceKind, year: number, sequence: number): string {
  return `${kind}-${year}-${String(sequence).padStart(SEQUENCES[kind].width, "0")}`;
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
  const { table, column } = SEQUENCES[kind];
  const [floorRow] = await tx.$queryRaw<{ floor: number }[]>`
    SELECT COALESCE(MAX(split_part(${column}, '-', 3)::int), 0)::int AS floor
    FROM ${table}
    WHERE ${column} ~ ${`^${prefix}[0-9]+$`}
  `;
  const floor = floorRow?.floor ?? 0;

  return allocate(tx, key, floor, (n) => formatReference(kind, year, n));
}

/**
 * Record codes that never reset: CUS-00121, LEAD-0031. Same counter row and
 * the same floor on the table, without the year.
 */
const CODES = {
  CUS: { table: Prisma.raw(`"Customer"`), width: 5 },
  LEAD: { table: Prisma.raw(`"Lead"`), width: 4 },
} as const;

export type CodeKind = keyof typeof CODES;

export function formatCode(kind: CodeKind, sequence: number): string {
  return `${kind}-${String(sequence).padStart(CODES[kind].width, "0")}`;
}

export async function nextCode(tx: Prisma.TransactionClient, kind: CodeKind): Promise<string> {
  const [floorRow] = await tx.$queryRaw<{ floor: number }[]>`
    SELECT COALESCE(MAX(split_part(code, '-', 2)::int), 0)::int AS floor
    FROM ${CODES[kind].table}
    WHERE code ~ ${`^${kind}-[0-9]+$`}
  `;
  return allocate(tx, `sequence.${kind}`, floorRow?.floor ?? 0, (n) => formatCode(kind, n));
}

async function allocate(
  tx: Prisma.TransactionClient,
  key: string,
  floor: number,
  format: (n: number) => string,
): Promise<string> {
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

  if (!row) throw new Error(`Could not allocate a number for ${key}.`);
  return format(row.n);
}
