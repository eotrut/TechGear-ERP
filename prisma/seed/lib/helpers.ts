import { faker } from "@faker-js/faker";

import {
  PH_GIVEN_NAMES_FEMALE,
  PH_GIVEN_NAMES_MALE,
  PH_LOCATIONS,
  PH_MOBILE_PREFIXES,
  PH_SURNAMES,
  type PhLocation,
} from "../data/philippines";

/**
 * SPEC section 7 requires a deterministic seed. faker is seeded once here, so
 * names, prices and distributions are identical on every run. Dates are still
 * generated relative to the run date so the dashboard is never empty; the shape
 * is deterministic, the window moves. See docs/PLAN.md decision D-15.
 */
export const SEED = 20260920;

export function resetFaker(): void {
  faker.seed(SEED);
  faker.setDefaultRefDate(new Date("2026-01-01T00:00:00Z"));
}

/** Sequential readable ids. Easier to follow in psql than a wall of cuids. */
export function idFactory(prefix: string): (n: number) => string {
  return (n: number) => `${prefix}_${String(n).padStart(6, "0")}`;
}

export function pick<T>(items: readonly T[]): T {
  const item = items[faker.number.int({ min: 0, max: items.length - 1 })];
  if (item === undefined) throw new Error("pick() called on an empty array");
  return item;
}

/** Pick with explicit weights. Used for channel and status mixes. */
export function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = faker.number.float({ min: 0, max: total });
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  const last = entries[entries.length - 1];
  if (!last) throw new Error("weightedPick() called with no weights");
  return last[0];
}

export function chance(probability: number): boolean {
  return faker.number.float({ min: 0, max: 1 }) < probability;
}

export function intBetween(min: number, max: number): number {
  return faker.number.int({ min, max });
}

export function phMobile(): string {
  return `+63 ${pick(PH_MOBILE_PREFIXES)} ${faker.string.numeric(3)} ${faker.string.numeric(4)}`;
}

export function phLandline(): string {
  return `+63 2 8${faker.string.numeric(3)} ${faker.string.numeric(4)}`;
}

export type PhPerson = { firstName: string; lastName: string; fullName: string };

export function phPerson(): PhPerson {
  const firstName = chance(0.5) ? pick(PH_GIVEN_NAMES_MALE) : pick(PH_GIVEN_NAMES_FEMALE);
  const lastName = pick(PH_SURNAMES);
  return { firstName, lastName, fullName: `${firstName} ${lastName}` };
}

export function phLocation(): PhLocation {
  return pick(PH_LOCATIONS);
}

export function phStreet(): string {
  const style = faker.number.int({ min: 0, max: 3 });
  const number = faker.number.int({ min: 1, max: 480 });
  switch (style) {
    case 0:
      return `${number} ${pick(PH_SURNAMES)} Street`;
    case 1:
      return `Blk ${faker.number.int({ min: 1, max: 42 })} Lot ${faker.number.int({ min: 1, max: 30 })}, ${pick(["Villa Alegre", "Greenfields", "Camella Homes", "Northview Subdivision", "San Miguel Village"])}`;
    case 2:
      return `Unit ${faker.number.int({ min: 2, max: 28 })}${pick(["A", "B", "C", "D"])}, ${pick(["Orchid Tower", "Cityland Residences", "One Emerald", "Avida Towers", "Pacific Suites"])}`;
    default:
      return `${number} ${pick(["Mabini", "Rizal", "Bonifacio", "Katipunan", "Aguinaldo", "Del Pilar"])} Avenue`;
  }
}

/** Email that matches the person's actual name, not a random word. */
export function emailFor(person: PhPerson, index: number): string {
  const domain = pick(["gmail.com", "yahoo.com", "outlook.com", "proton.me"]);
  const handle = pick([
    `${person.firstName}.${person.lastName}`.toLowerCase().replace(/[^a-z.]/g, ""),
    `${person.firstName[0] ?? "x"}${person.lastName}`.toLowerCase().replace(/[^a-z]/g, ""),
    `${person.firstName}${faker.number.int({ min: 10, max: 99 })}`.toLowerCase(),
  ]);
  // The suffix guarantees uniqueness without making the address look generated.
  return `${handle}${index % 7 === 0 ? faker.number.int({ min: 2, max: 89 }) : ""}@${domain}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Date helpers. All seeded timestamps are built from the run date. */
export function daysAgo(days: number, from: Date = new Date()): Date {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addHours(date: Date, hours: number): Date {
  const next = new Date(date);
  next.setUTCHours(next.getUTCHours() + hours);
  return next;
}

/** Business-hours timestamp on a given day, in the Asia/Manila working day. */
export function atBusinessHour(day: Date): Date {
  const date = new Date(day);
  date.setUTCHours(
    faker.number.int({ min: 1, max: 13 }),
    faker.number.int({ min: 0, max: 59 }),
    0,
    0,
  );
  return date;
}

/**
 * Nothing in a seeded history may be dated in the future. A restock or a
 * payment stamped after "now" reorders the ledger against events that were
 * computed from the final position, and the chronological replay rejects it.
 */
export function clampToNow(date: Date, now: Date): Date {
  return date > now ? now : date;
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}
