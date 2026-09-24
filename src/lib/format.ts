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
