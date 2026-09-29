import { describe, expect, it } from "vitest";

import {
  aggregateCentavos,
  allocateCentavos,
  applyBps,
  assertCentavos,
  formatAmount,
  formatPeso,
  MAX_CENTAVOS,
  MIN_CENTAVOS,
  MoneyOverflowError,
  parsePesoInput,
  pesosToCentavos,
  roundHalfAwayFromZero,
  sumCentavos,
  toPesoInput,
} from "@/lib/money";
import { allocateVatToLines, netFromGross, splitGross, vatFromGross, vatOnNet } from "@/lib/vat";

/**
 * The money core. Every total, discount, VAT figure and cost in the app is
 * computed by these functions, so they are tested on their own here and not
 * only through the pricing rules that call them.
 */

/** A deterministic stream of integers, so the property checks never flake. */
function* lcg(seed: number, count: number, max: number) {
  let state = seed;
  for (let i = 0; i < count; i += 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    yield state % max;
  }
}

describe("integer centavos", () => {
  it("accepts every value a 32-bit Int column can hold", () => {
    expect(assertCentavos(0)).toBe(0);
    expect(assertCentavos(MAX_CENTAVOS)).toBe(MAX_CENTAVOS);
    expect(assertCentavos(MIN_CENTAVOS)).toBe(MIN_CENTAVOS);
  });

  it("throws on a fraction of a centavo instead of storing a float", () => {
    expect(() => assertCentavos(100.5)).toThrow(TypeError);
  });

  it("throws on overflow instead of wrapping", () => {
    expect(() => assertCentavos(MAX_CENTAVOS + 1)).toThrow(MoneyOverflowError);
    expect(() => assertCentavos(MIN_CENTAVOS - 1)).toThrow(MoneyOverflowError);
    expect(() => assertCentavos(Number.NaN)).toThrow(MoneyOverflowError);
    expect(() => assertCentavos(Number.POSITIVE_INFINITY)).toThrow(MoneyOverflowError);
  });

  it("converts pesos to centavos past binary float error", () => {
    // 1.1 * 100 is 110.00000000000001 and 0.29 * 100 is 28.999999999999996.
    expect(pesosToCentavos(1.1)).toBe(110);
    expect(pesosToCentavos(0.29)).toBe(29);
    expect(pesosToCentavos(4190.5)).toBe(419_050);
  });

  it("sums with an overflow guard", () => {
    expect(sumCentavos([419_050, 1, -51])).toBe(419_000);
    expect(sumCentavos([])).toBe(0);
    expect(() => sumCentavos([MAX_CENTAVOS, 1])).toThrow(MoneyOverflowError);
  });

  it("reads SQL bigint aggregates exactly, and refuses what a number cannot hold", () => {
    expect(aggregateCentavos(null)).toBe(0);
    expect(aggregateCentavos(undefined)).toBe(0);
    expect(aggregateCentavos(5_000_000_000n)).toBe(5_000_000_000);
    expect(() => aggregateCentavos(2n ** 60n)).toThrow(MoneyOverflowError);
  });

  it("round-trips every amount through the form input exactly", () => {
    for (const value of lcg(7, 500, 100_000_000)) {
      const signed = value % 3 === 0 && value !== 0 ? -value : value;
      expect(parsePesoInput(toPesoInput(signed))).toBe(signed);
    }
  });
});

describe("rounding and basis points", () => {
  it("rounds half away from zero, symmetric for refunds", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(1.49)).toBe(1);
    expect(roundHalfAwayFromZero(-1.49)).toBe(-1);
  });

  it("applies a basis-point rate", () => {
    expect(applyBps(1_000_000, 1000)).toBe(100_000); // 10% of PHP 10,000
    expect(applyBps(419_050, 10_000)).toBe(419_050); // 100%
    expect(applyBps(419_050, 0)).toBe(0);
    expect(applyBps(1005, 5000)).toBe(503); // 502.5 rounds up
    expect(applyBps(-1005, 5000)).toBe(-503); // and its refund rounds down
  });

  it("gives a discount and its reversal the same magnitude", () => {
    for (const value of lcg(11, 300, 5_000_000)) {
      const rate = value % 10_000;
      expect(Math.abs(applyBps(-value, rate))).toBe(applyBps(value, rate));
      expect(applyBps(-value, rate)).toBeLessThanOrEqual(0);
    }
  });

  it("refuses a rate that would overflow the column", () => {
    expect(() => applyBps(MAX_CENTAVOS, 20_000)).toThrow(MoneyOverflowError);
  });
});

describe("allocating a total across lines", () => {
  it("hands leftover centavos to the largest remainders, then the earliest line", () => {
    expect(allocateCentavos(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateCentavos(1, [1, 3])).toEqual([0, 1]);
    expect(allocateCentavos(10, [2, 3, 5])).toEqual([2, 3, 5]);
  });

  it("puts everything on the first line when there is nothing to weigh by", () => {
    expect(allocateCentavos(10, [0, 0])).toEqual([10, 0]);
    expect(allocateCentavos(10, [])).toEqual([]);
  });

  it("always sums to the total, with no share more than a centavo from exact", () => {
    const stream = [...lcg(3, 2400, 900_000)];
    for (let i = 0; i < 400; i += 1) {
      const weights = stream.slice(i * 5, i * 5 + 1 + (i % 5)).map((weight) => weight + 1);
      const total = stream[2000 + i]! % 250_000;
      const parts = allocateCentavos(total, weights);
      const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
      parts.forEach((part, index) => {
        expect(Number.isInteger(part)).toBe(true);
        expect(Math.abs(part - (total * weights[index]!) / weightTotal)).toBeLessThan(1);
      });
    }
  });
});

describe("VAT at 12 percent", () => {
  it("extracts VAT from a VAT-inclusive price", () => {
    expect(vatFromGross(11_200)).toBe(1_200);
    expect(netFromGross(11_200)).toBe(10_000);
    // 419,050 * 12 / 112 = 44,898.21
    expect(splitGross(419_050)).toEqual({
      grossCentavos: 419_050,
      netCentavos: 374_152,
      vatCentavos: 44_898,
    });
  });

  it("adds VAT on top of a supplier's VAT-exclusive price", () => {
    expect(vatOnNet(10_000)).toBe(1_200);
    expect(vatOnNet(5)).toBe(1); // 0.6 rounds up
    expect(vatOnNet(4)).toBe(0); // 0.48 rounds down
  });

  it("splits every gross amount into net plus VAT exactly", () => {
    for (const gross of lcg(5, 500, 50_000_000)) {
      const { netCentavos, vatCentavos } = splitGross(gross);
      expect(netCentavos + vatCentavos).toBe(gross);
      // Adding VAT back onto the net lands within a centavo of what was extracted.
      expect(Math.abs(vatOnNet(netCentavos) - vatCentavos)).toBeLessThanOrEqual(1);
    }
  });

  it("allocates an order's VAT so the lines sum to the header, not to their own rounding", () => {
    // Rounded one line at a time, three PHP 0.05 lines carry 3 centavos of VAT;
    // the order's 15 centavos carry 2. The header wins.
    expect([5, 5, 5].map(vatFromGross)).toEqual([1, 1, 1]);
    expect(allocateVatToLines([5, 5, 5])).toEqual([1, 1, 0]);

    const stream = [...lcg(9, 1200, 1_500_000)];
    for (let i = 0; i < 200; i += 1) {
      const order = stream.slice(i * 6, i * 6 + 1 + (i % 6));
      const vat = allocateVatToLines(order);
      const gross = order.reduce((sum, line) => sum + line, 0);
      expect(vat.reduce((sum, line) => sum + line, 0)).toBe(vatFromGross(gross));
    }
  });
});

describe("display", () => {
  it("formats pesos the en-PH way", () => {
    expect(formatPeso(419_050)).toBe("₱4,190.50");
    expect(formatAmount(419_050)).toBe("4,190.50");
    expect(formatAmount(7)).toBe("0.07");
  });
});
