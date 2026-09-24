import type { TicketPriority } from "@prisma/client";

/**
 * Support SLA, docs/PLAN.md section 5.4.
 *
 * Every ticket gets a resolution target on creation, counted in business hours
 * rather than wall-clock hours: an urgent ticket opened at 5:30pm on a Saturday
 * is due mid-morning on Monday, not at 9:30pm the same night when nobody is at
 * the desk. The support desk works Monday to Saturday, 9am to 6pm, Manila time.
 *
 * Manila has no daylight saving, so a fixed +8 hour offset is exact, and the
 * arithmetic is done on "Manila wall-clock milliseconds" that are then shifted
 * back to UTC. Public holidays are not modelled; the desk treats them as normal
 * days and the SLA shows it honestly rather than pretending otherwise.
 */

export const SLA_HOURS: Record<TicketPriority, number> = {
  URGENT: 4,
  HIGH: 8,
  MEDIUM: 24,
  LOW: 72,
};

export const BUSINESS_HOURS = {
  openHour: 9,
  closeHour: 18,
  /** getUTCDay() numbering on the shifted clock: 0 is Sunday. */
  workingDays: [1, 2, 3, 4, 5, 6],
} as const;

const MANILA_OFFSET_MS = 8 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function isWorkingDay(manilaMs: number): boolean {
  return (BUSINESS_HOURS.workingDays as readonly number[]).includes(new Date(manilaMs).getUTCDay());
}

function startOfManilaDay(manilaMs: number): number {
  return Math.floor(manilaMs / DAY_MS) * DAY_MS;
}

/**
 * Move a Manila wall-clock instant forward to the next moment the desk is
 * open. An instant inside business hours is returned unchanged.
 */
function nextOpenMoment(manilaMs: number): number {
  let cursor = manilaMs;
  for (let guard = 0; guard < 14; guard += 1) {
    const dayStart = startOfManilaDay(cursor);
    const open = dayStart + BUSINESS_HOURS.openHour * HOUR_MS;
    const close = dayStart + BUSINESS_HOURS.closeHour * HOUR_MS;
    if (isWorkingDay(cursor)) {
      if (cursor < open) return open;
      if (cursor < close) return cursor;
    }
    cursor = dayStart + DAY_MS;
  }
  throw new Error("No business hours found in the next two weeks.");
}

/** `start` plus `hours` of Manila business time. */
export function addBusinessHours(start: Date, hours: number): Date {
  if (!Number.isFinite(hours) || hours < 0) throw new Error("Hours must be zero or more.");

  let remaining = Math.round(hours * HOUR_MS);
  let cursor = nextOpenMoment(start.getTime() + MANILA_OFFSET_MS);

  while (remaining > 0) {
    const close = startOfManilaDay(cursor) + BUSINESS_HOURS.closeHour * HOUR_MS;
    const available = close - cursor;
    if (remaining <= available) {
      cursor += remaining;
      remaining = 0;
    } else {
      remaining -= available;
      cursor = nextOpenMoment(close);
    }
  }

  return new Date(cursor - MANILA_OFFSET_MS);
}

export function slaDueAt(createdAt: Date, priority: TicketPriority): Date {
  return addBusinessHours(createdAt, SLA_HOURS[priority]);
}

export type SlaState =
  | { kind: "met"; marginMs: number }
  | { kind: "missed"; lateByMs: number }
  | { kind: "on-track"; remainingMs: number }
  | { kind: "at-risk"; remainingMs: number }
  | { kind: "breached"; overdueMs: number };

/**
 * Where a ticket stands against its target. A resolved or closed ticket is
 * judged by when it was resolved; an open one by how long is left, with the
 * last quarter of its allowance (or the last two hours, whichever is longer)
 * flagged as at risk so it surfaces before it breaches.
 */
export function slaState(
  ticket: { createdAt: Date; slaDueAt: Date; resolvedAt: Date | null },
  now: Date,
): SlaState {
  const due = ticket.slaDueAt.getTime();

  if (ticket.resolvedAt) {
    const at = ticket.resolvedAt.getTime();
    return at <= due ? { kind: "met", marginMs: due - at } : { kind: "missed", lateByMs: at - due };
  }

  const remaining = due - now.getTime();
  if (remaining < 0) return { kind: "breached", overdueMs: -remaining };

  const allowance = due - ticket.createdAt.getTime();
  const riskWindow = Math.max(allowance / 4, 2 * HOUR_MS);
  return remaining <= riskWindow
    ? { kind: "at-risk", remainingMs: remaining }
    : { kind: "on-track", remainingMs: remaining };
}

/** "3h 20m", "2d 4h", "45m": compact durations for the SLA column. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** A closed ticket can be reopened for a week; after that it gets a new one. */
export const REOPEN_WINDOW_DAYS = 7;

export function canReopenClosed(closedAt: Date | null, now: Date): boolean {
  if (!closedAt) return true;
  return now.getTime() - closedAt.getTime() <= REOPEN_WINDOW_DAYS * DAY_MS;
}
