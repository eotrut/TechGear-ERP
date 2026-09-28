/**
 * Report date ranges, in Manila calendar days.
 *
 * Every report and the dashboard resolve their period through this one module,
 * so "last 30 days" means the same thirty days everywhere and a figure on the
 * dashboard can be reproduced exactly on the report it links to.
 *
 * A range is half-open: `from` is midnight Manila on the first day and `to` is
 * midnight Manila after the last day. SQL compares `>= from AND < to`, so a
 * sale at 23:59:59 on the last day is in and one at midnight is not.
 *
 * Every range carries a comparison period (Stripe's "vs. previous period").
 * The comparison is clipped to the same elapsed time as the current period, so
 * the first nine hours of today are compared with the first nine hours of
 * yesterday, never with all of it.
 *
 * Pure: no database, no request context. The pages, the CSV export and the
 * seed verifier all call it.
 */

export const RANGE_PRESETS = [
  "today",
  "wtd",
  "7d",
  "30d",
  "90d",
  "mtd",
  "qtd",
  "ytd",
  "12m",
  "custom",
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const PRESET_LABEL: Record<RangePreset, string> = {
  today: "Today",
  wtd: "Week to date",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "Month to date",
  qtd: "Quarter to date",
  ytd: "Year to date",
  "12m": "Last 12 months",
  custom: "Custom range",
};

export type Granularity = "day" | "week" | "month";

export type Window = {
  /** Inclusive instant: midnight Manila on the first day. */
  from: Date;
  /** Exclusive instant: midnight Manila after the last day, or the clipped end. */
  to: Date;
  /** "2026-09-01", the first Manila day. */
  fromDay: string;
  /** "2026-09-28", the last Manila day, inclusive. */
  toDay: string;
};

export type DateRange = Window & {
  preset: RangePreset;
  label: string;
  granularity: Granularity;
  /** The comparison period, clipped to the same elapsed time. */
  previous: Window;
};

const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
/** Longest custom range, so nobody asks the database for a decade by accident. */
export const MAX_RANGE_DAYS = 732;
/**
 * A month reads well by day. Up to a quarter, days are too thin to see as
 * columns, so they fold into weeks; anything longer buckets by month.
 */
const DAILY_LIMIT_DAYS = 31;
const WEEKLY_LIMIT_DAYS = 92;

// ------------------------------------------------------------ day arithmetic

type Ymd = { y: number; m: number; d: number };

function parseKey(key: string): Ymd {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

function keyOf(y: number, m: number, d: number): string {
  // Date.UTC normalises overflow (month 13, day 0) for us.
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

/** The Manila calendar day an instant falls on. */
export function manilaDay(instant: Date): string {
  return new Date(instant.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight Manila at the start of a calendar day, as an instant. */
export function dayStart(key: string): Date {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d) - MANILA_OFFSET_MS);
}

export function addDays(key: string, days: number): string {
  const { y, m, d } = parseKey(key);
  return keyOf(y, m, d + days);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Same day-of-month `months` away, clamped: 31 March minus one month is 28 or 29 February. */
export function addMonths(key: string, months: number): string {
  const { y, m, d } = parseKey(key);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  return keyOf(ty, tm, Math.min(d, daysInMonth(ty, tm)));
}

/** Whole days from `a` to `b`, both Manila day keys. */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY_MS);
}

function isDayKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { y, m, d } = parseKey(value);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function windowOf(fromDay: string, toDay: string): Window {
  return { fromDay, toDay, from: dayStart(fromDay), to: dayStart(addDays(toDay, 1)) };
}

/**
 * The comparison window, clipped so both periods cover the same elapsed time.
 * `current.to` may lie in the future (today is not over); the elapsed time is
 * measured to `now` in that case.
 */
function clipPrevious(current: Window, previous: Window, now: Date): Window {
  const end = Math.min(current.to.getTime(), now.getTime());
  const elapsed = Math.max(0, end - current.from.getTime());
  const clippedTo = new Date(Math.min(previous.to.getTime(), previous.from.getTime() + elapsed));
  const lastInstant = new Date(Math.max(previous.from.getTime(), clippedTo.getTime() - 1));
  return { ...previous, to: clippedTo, toDay: manilaDay(lastInstant) };
}

// ---------------------------------------------------------------- resolving

export type RangeInput = {
  range?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

function isPreset(value: string | undefined): value is RangePreset {
  return (RANGE_PRESETS as readonly string[]).includes(value ?? "");
}

/**
 * Resolve URL parameters to a range. Anything malformed (an unknown preset, a
 * custom range with the days reversed, a range longer than two years) falls
 * back to `fallback` rather than failing the page: a stale bookmark should
 * still open a report.
 */
export function resolveRange(
  input: RangeInput,
  now: Date,
  fallback: Exclude<RangePreset, "custom"> = "30d",
): DateRange {
  const today = manilaDay(now);
  const preset: RangePreset = isPreset(input.range) ? input.range : fallback;

  if (preset === "custom") {
    const from = input.from;
    const to = input.to;
    if (isDayKey(from) && isDayKey(to) && from <= to) {
      const toDay = to > today ? today : to;
      const fromDay = from > toDay ? toDay : from;
      const span = daysBetween(fromDay, toDay) + 1;
      if (span <= MAX_RANGE_DAYS) {
        const current = windowOf(fromDay, toDay);
        const previous = windowOf(addDays(fromDay, -span), addDays(fromDay, -1));
        return build("custom", current, clipPrevious(current, previous, now));
      }
    }
    return resolveRange({ range: fallback }, now, fallback);
  }

  const { y, m } = parseKey(today);
  let current: Window;
  let previous: Window;

  switch (preset) {
    case "today": {
      current = windowOf(today, today);
      const yesterday = addDays(today, -1);
      previous = windowOf(yesterday, yesterday);
      break;
    }
    case "wtd": {
      const fromDay = weekStart(today);
      current = windowOf(fromDay, today);
      previous = windowOf(addDays(fromDay, -7), addDays(fromDay, -1));
      break;
    }
    case "7d":
    case "30d":
    case "90d": {
      const days = Number.parseInt(preset, 10);
      const fromDay = addDays(today, -(days - 1));
      current = windowOf(fromDay, today);
      previous = windowOf(addDays(fromDay, -days), addDays(fromDay, -1));
      break;
    }
    case "mtd": {
      const fromDay = keyOf(y, m, 1);
      current = windowOf(fromDay, today);
      const prevFrom = addMonths(fromDay, -1);
      previous = windowOf(prevFrom, addDays(fromDay, -1));
      break;
    }
    case "qtd": {
      const quarterMonth = Math.floor((m - 1) / 3) * 3 + 1;
      const fromDay = keyOf(y, quarterMonth, 1);
      current = windowOf(fromDay, today);
      previous = windowOf(addMonths(fromDay, -3), addDays(fromDay, -1));
      break;
    }
    case "ytd": {
      const fromDay = keyOf(y, 1, 1);
      current = windowOf(fromDay, today);
      previous = windowOf(keyOf(y - 1, 1, 1), keyOf(y - 1, 12, 31));
      break;
    }
    case "12m": {
      // Twelve calendar months including this one, so every bucket is a whole
      // month except the one still running.
      const fromDay = addMonths(keyOf(y, m, 1), -11);
      current = windowOf(fromDay, today);
      previous = windowOf(addMonths(fromDay, -12), addDays(fromDay, -1));
      break;
    }
  }

  return build(preset, current, clipPrevious(current, previous, now));
}

function build(preset: RangePreset, current: Window, previous: Window): DateRange {
  const span = daysBetween(current.fromDay, current.toDay) + 1;
  return {
    ...current,
    preset,
    label: preset === "custom" ? describeWindow(current) : PRESET_LABEL[preset],
    granularity: span <= DAILY_LIMIT_DAYS ? "day" : span <= WEEKLY_LIMIT_DAYS ? "week" : "month",
    previous,
  };
}

// ------------------------------------------------------------------ buckets

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The Monday on or before a day. Weeks start on Monday, as the ISO calendar has it. */
export function weekStart(day: string): string {
  const { y, m, d } = parseKey(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/** Bucket key for a Manila day: the day, the Monday of its week, or its "YYYY-MM" month. */
export function bucketOf(day: string, granularity: Granularity): string {
  if (granularity === "day") return day;
  if (granularity === "week") return weekStart(day);
  return day.slice(0, 7);
}

/** Every bucket a window covers, in order, so a quiet day still gets a zero. */
export function bucketKeys(window: Window, granularity: Granularity): string[] {
  const keys: string[] = [];
  if (granularity === "day") {
    for (let day = window.fromDay; day <= window.toDay; day = addDays(day, 1)) keys.push(day);
    return keys;
  }
  if (granularity === "week") {
    for (let day = weekStart(window.fromDay); day <= window.toDay; day = addDays(day, 7)) {
      keys.push(day);
    }
    return keys;
  }
  let month = `${window.fromDay.slice(0, 7)}-01`;
  const last = window.toDay.slice(0, 7);
  while (month.slice(0, 7) <= last) {
    keys.push(month.slice(0, 7));
    month = addMonths(month, 1);
  }
  return keys;
}

/** "Sep 28" for a day, "Wk of Sep 21" for a week, "Sep 2026" for a month. */
export function bucketLabel(key: string, granularity: Granularity): string {
  const { y, m, d } = parseKey(key.length === 7 ? `${key}-01` : key);
  const month = MONTHS[m - 1] ?? "";
  if (granularity === "day") return `${month} ${d}`;
  if (granularity === "week") return `Wk of ${month} ${d}`;
  return `${month} ${y}`;
}

/** Headings: "Revenue by week". */
export function byPeriod(granularity: Granularity): string {
  return `by ${granularity}`;
}

/** Column headings: "Week". */
export const PERIOD_HEADER: Record<Granularity, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

/**
 * Whether a range can honestly be compared with its prior period: the prior
 * period must lie inside recorded history. Comparing a year of trading with
 * the five days before the books began produces deltas in the tens of
 * thousands of percent, which is noise dressed as insight.
 */
export function isComparable(
  range: Pick<DateRange, "previous">,
  historyStart: Date | null,
): boolean {
  return historyStart !== null && range.previous.from.getTime() >= historyStart.getTime();
}

/** "Sep 1 to Sep 28, 2026" for a window, the way a person says it. */
export function describeWindow(window: Pick<Window, "fromDay" | "toDay">): string {
  const a = parseKey(window.fromDay);
  const b = parseKey(window.toDay);
  const left = `${MONTHS[a.m - 1]} ${a.d}`;
  const right = `${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  if (window.fromDay === window.toDay) return right;
  return a.y === b.y ? `${left} to ${right}` : `${left}, ${a.y} to ${right}`;
}

/** URL parameters that reproduce a range, for links from one page to another. */
export function rangeParams(
  range: Pick<DateRange, "preset" | "fromDay" | "toDay">,
): Record<string, string> {
  return range.preset === "custom"
    ? { range: "custom", from: range.fromDay, to: range.toDay }
    : { range: range.preset };
}

/** Signed change from `previous` to `current` in basis points, or null when there is no base. */
export function changeBps(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000);
}
