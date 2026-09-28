import { z } from "zod";

import { resolveRange, type DateRange, type RangePreset } from "../services/date-range";

/**
 * Report URL parameters. Reports are GETs, so the URL is the whole state: a
 * filtered report is a link somebody can be sent, and the CSV export takes
 * the very same parameters. Anything malformed falls back to a default
 * rather than failing the page.
 */

type Params = Record<string, string | string[] | undefined>;

export function single(value: string | string[] | null | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.trim() !== "" ? raw.trim() : undefined;
}

/** From Next's searchParams object or a URLSearchParams, the same way. */
export function paramReader(params: Params | URLSearchParams) {
  return (key: string) =>
    params instanceof URLSearchParams ? single(params.get(key)) : single(params[key]);
}

/** The page's range, resolved the same way its CSV export resolves it. */
export function readRange(
  params: Params | URLSearchParams,
  now: Date,
  fallback: Exclude<RangePreset, "custom"> = "30d",
): DateRange {
  const read = paramReader(params);
  return resolveRange({ range: read("range"), from: read("from"), to: read("to") }, now, fallback);
}

/** The current query string with some keys replaced or removed, for tabs and exports. */
export function withParams(
  params: Params | URLSearchParams,
  overrides: Record<string, string | undefined>,
): string {
  const next = new URLSearchParams();
  const entries =
    params instanceof URLSearchParams
      ? [...params.entries()]
      : Object.entries(params).flatMap(([key, value]) => {
          const first = single(value);
          return first === undefined ? [] : [[key, first] as [string, string]];
        });
  for (const [key, value] of entries) next.set(key, value);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query === "" ? "" : `?${query}`;
}

export const SALES_BREAKDOWNS = ["product", "category", "channel", "salesperson"] as const;
export type SalesBreakdown = (typeof SALES_BREAKDOWNS)[number];

export const salesReportSchema = z.object({
  by: z.enum(SALES_BREAKDOWNS).catch("product"),
});

/** How long stock may sit unsold before the slow-moving report lists it. */
export const IDLE_THRESHOLDS = [30, 60, 90, 180] as const;
export type IdleThreshold = (typeof IDLE_THRESHOLDS)[number];

export const idleDaysSchema = z.coerce
  .number()
  .int()
  .refine((value) => (IDLE_THRESHOLDS as readonly number[]).includes(value))
  .catch(90);

export const warehouseParam = z.string().trim().max(64).optional().catch(undefined);

export const asOfSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);
