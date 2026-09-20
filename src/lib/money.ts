/**
 * Money arithmetic. SPEC section 2: money is stored as integer centavos, never
 * floats. Every conversion and every rounding decision in the app goes through
 * this module so there is exactly one place to audit.
 *
 * Percentages are basis points (`Int`, 10000 = 100%) for the same reason.
 */

/**
 * Postgres `Int` tops out here, about PHP 21.4M in a single column. Far above
 * any plausible order or line for this business, but wrapping silently would be
 * the worst possible failure mode for a ledger, so we throw instead. See
 * docs/PLAN.md decision D-18.
 */
export const MAX_CENTAVOS = 2_147_483_647;
export const MIN_CENTAVOS = -2_147_483_648;

export class MoneyOverflowError extends Error {
  constructor(value: number) {
    super(
      `Money value ${value} centavos is outside the range a 32-bit integer column can hold. ` +
        `Aggregates above this must be computed as BigInt.`,
    );
    this.name = "MoneyOverflowError";
  }
}

/** Throw if a computed centavo value cannot be stored, instead of wrapping. */
export function assertCentavos(value: number): number {
  if (!Number.isFinite(value)) {
    throw new MoneyOverflowError(value);
  }
  if (!Number.isInteger(value)) {
    throw new TypeError(`Money must be an integer number of centavos, received ${value}`);
  }
  if (value > MAX_CENTAVOS || value < MIN_CENTAVOS) {
    throw new MoneyOverflowError(value);
  }
  return value;
}

/** Pesos to centavos. Only for parsing input and writing fixtures. */
export function pesosToCentavos(pesos: number): number {
  return assertCentavos(Math.round(pesos * 100));
}

/** Centavos to pesos as a float. Display only, never for further arithmetic. */
export function centavosToPesos(centavos: number): number {
  return centavos / 100;
}

const pesoFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plainFormatter = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "PHP 4,190.00" style, with the peso sign. */
export function formatPeso(centavos: number): string {
  return pesoFormatter.format(centavosToPesos(centavos));
}

/** "4,190.00", for table columns that carry the currency in the header. */
export function formatAmount(centavos: number): string {
  return plainFormatter.format(centavosToPesos(centavos));
}

/** Sum centavos with an overflow guard at the end. */
export function sumCentavos(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return assertCentavos(total);
}

/**
 * Apply a basis-point rate, rounding half away from zero.
 * `applyBps(10_000_00, 1000)` is 10% of PHP 10,000.00.
 */
export function applyBps(centavos: number, bps: number): number {
  return assertCentavos(roundHalfAwayFromZero((centavos * bps) / 10_000));
}

/**
 * `Math.round` rounds -0.5 to -0 (toward positive infinity), which makes
 * refunds and negative adjustments asymmetric with their positive twins.
 * Money rounding should be symmetric about zero.
 */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Split `total` across `weights` so the parts sum to exactly `total`.
 *
 * Largest-remainder method: floor every share, then hand the leftover centavos
 * out one at a time to the lines with the largest truncated remainder. Without
 * this, allocating VAT or an order-level discount per line leaves a stray
 * centavo and the lines stop summing to the header.
 */
export function allocateCentavos(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal === 0) {
    // Nothing to weigh by: put everything on the first line.
    return weights.map((_, index) => (index === 0 ? total : 0));
  }

  const exact = weights.map((weight) => (total * weight) / weightTotal);
  const floored = exact.map((value) => Math.floor(value));
  const allocated = floored.reduce((sum, value) => sum + value, 0);

  let remainder = total - allocated;

  // Hand out remaining centavos to the largest fractional parts first, with the
  // index as a tiebreak so the result is deterministic.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floored];
  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    const target = order[cursor % order.length];
    if (target) {
      result[target.index] = (result[target.index] ?? 0) + 1;
      remainder -= 1;
    }
    cursor += 1;
  }

  return result;
}
