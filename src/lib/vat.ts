import { allocateCentavos, roundHalfAwayFromZero } from "@/lib/money";

/**
 * Philippine VAT. SPEC fixes the rate at 12%.
 *
 * Prices in this app are **VAT-inclusive**, which is the Philippine retail norm
 * and what a shelf price means to a customer. See docs/PLAN.md decision D-6.
 * So VAT is extracted out of a gross amount rather than added on top:
 *
 *     vat = gross * 12 / 112
 *     net = gross - vat
 */
export const VAT_RATE_BPS = 1200;
const VAT_NUMERATOR = 12;
const VAT_INCLUSIVE_DENOMINATOR = 112;

/** VAT contained within a VAT-inclusive gross amount. */
export function vatFromGross(grossCentavos: number): number {
  return roundHalfAwayFromZero((grossCentavos * VAT_NUMERATOR) / VAT_INCLUSIVE_DENOMINATOR);
}

/** The VAT-exclusive portion of a VAT-inclusive gross amount. */
export function netFromGross(grossCentavos: number): number {
  return grossCentavos - vatFromGross(grossCentavos);
}

/** VAT to add on top of a VAT-exclusive net amount. Used for supplier bills. */
export function vatOnNet(netCentavos: number): number {
  return roundHalfAwayFromZero((netCentavos * VAT_RATE_BPS) / 10_000);
}

export type VatSplit = {
  grossCentavos: number;
  netCentavos: number;
  vatCentavos: number;
};

export function splitGross(grossCentavos: number): VatSplit {
  const vatCentavos = vatFromGross(grossCentavos);
  return {
    grossCentavos,
    netCentavos: grossCentavos - vatCentavos,
    vatCentavos,
  };
}

/**
 * Allocate an order's VAT across its lines.
 *
 * Computing VAT independently per line and summing does not reliably equal the
 * VAT of the order total: each line rounds on its own and the errors do not
 * cancel. So the header VAT is authoritative and gets distributed across lines
 * by the largest-remainder method, which guarantees the lines sum to it exactly.
 *
 * `lineGrossCentavos` are VAT-inclusive line totals after any discount.
 */
export function allocateVatToLines(lineGrossCentavos: readonly number[]): number[] {
  const orderGross = lineGrossCentavos.reduce((sum, value) => sum + value, 0);
  const orderVat = vatFromGross(orderGross);
  return allocateCentavos(orderVat, lineGrossCentavos);
}
