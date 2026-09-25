/**
 * Locale formatting. SPEC section 2 fixes en-PH and Asia/Manila, so the
 * timezone is pinned explicitly rather than inherited from the server, which
 * would otherwise render UTC in production and local time in development.
 */

const TIME_ZONE = "Asia/Manila";
const LOCALE = "en-PH";

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(value: Date | string): string {
  return dateTimeFormatter.format(new Date(value));
}

export function formatDate(value: Date | string): string {
  return dateFormatter.format(new Date(value));
}

export function formatTime(value: Date | string): string {
  return timeFormatter.format(new Date(value));
}

/** "3 days ago", for recency columns where the exact timestamp is noise. */
export function formatRelative(value: Date | string | null): string {
  if (!value) return "never";

  const date = new Date(value);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.floor(seconds / 86_400);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return formatDate(date);
}

const yearFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, year: "numeric" });

/**
 * The calendar year in Manila. Document numbers reset each year, and a stock
 * count at 7am on 1 January Manila time is still 31 December in UTC.
 */
export function manilaYear(value: Date | string): number {
  return Number(yearFormatter.format(new Date(value)));
}

/** "+3" and "-2", for signed quantities where the sign is the information. */
export function formatSigned(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `-${formatNumber(Math.abs(value))}`;
  return "0";
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

// ------------------------------------------------------------ Manila inputs
//
// A datetime-local input has no timezone; it means Manila wall-clock time
// here. Manila has no daylight saving, so the +8 hour offset is exact.

const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;

/** "2026-09-25T14:30" in Manila time to the instant it names. Null if malformed. */
export function parseManilaDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi) - MANILA_OFFSET_MS;
  const date = new Date(utc);
  // Reject 2026-02-31 and friends, which Date.UTC would silently roll over.
  const check = new Date(utc + MANILA_OFFSET_MS);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return date;
}

/** The value a datetime-local input needs to show this instant in Manila. */
export function toManilaDateTimeInput(value: Date | string): string {
  return new Date(new Date(value).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 16);
}

/** "2026-09-25", the Manila calendar day an instant falls on. */
export function manilaDayKey(value: Date | string): string {
  return new Date(new Date(value).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight in Manila at the start of the day `value` falls on, as an instant. */
export function startOfManilaDay(value: Date | string): Date {
  const shifted = new Date(value).getTime() + MANILA_OFFSET_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS - MANILA_OFFSET_MS);
}

const weekdayFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "short",
});

/** "Thu, Sep 25", for due dates in the current fortnight. */
export function formatWeekday(value: Date | string): string {
  return weekdayFormatter.format(new Date(value));
}

/** "2026-09-25", a date input's value, to midnight Manila on that day. Null if malformed. */
export function parseManilaDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  return parseManilaDateTime(`${value.trim()}T00:00`);
}
