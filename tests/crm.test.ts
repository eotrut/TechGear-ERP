import { describe, expect, it } from "vitest";

import {
  classifySegment,
  SEGMENT_RULES,
  vipThreshold,
} from "@/features/customers/services/segment-rules";
import { displayNameFor } from "@/features/customers/services/customers";
import {
  explainLeadMove,
  LEAD_STAGES,
  LEAD_TRANSITIONS,
  MIN_GAP,
  positionBetween,
  rebalancedPositions,
  weightedValue,
} from "@/features/leads/services/pipeline";
import {
  addBusinessHours,
  canReopenClosed,
  formatDuration,
  SLA_HOURS,
  slaState,
} from "@/features/tickets/services/sla";
import { needsResolvePermission, TICKET_TRANSITIONS } from "@/features/tickets/services/tickets";
import {
  manilaDayKey,
  parseManilaDateTime,
  startOfManilaDay,
  toManilaDateTimeInput,
} from "@/lib/format";
import { canTransition, isTerminal } from "@/lib/transitions";
import { parseTags } from "@/lib/validation";

/** A Manila wall-clock instant, for readable fixtures. */
function manila(value: string): Date {
  const date = parseManilaDateTime(value);
  if (!date) throw new Error(`bad fixture ${value}`);
  return date;
}

const DAY = 86_400_000;

// ------------------------------------------------------------------- leads

describe("lead pipeline transitions", () => {
  it("moves forward one stage at a time", () => {
    expect(canTransition(LEAD_TRANSITIONS, "NEW", "CONTACTED")).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, "CONTACTED", "QUOTED")).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, "QUOTED", "NEGOTIATION")).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, "NEGOTIATION", "WON")).toBe(true);
  });

  it("lets an accepted quote go straight to won", () => {
    expect(canTransition(LEAD_TRANSITIONS, "QUOTED", "WON")).toBe(true);
  });

  it("rejects forward skips and names the missing step", () => {
    expect(canTransition(LEAD_TRANSITIONS, "NEW", "NEGOTIATION")).toBe(false);
    expect(explainLeadMove("NEW", "NEGOTIATION")).toBe(
      "Leads move one stage at a time. Move it to Contacted first.",
    );
    expect(explainLeadMove("CONTACTED", "NEGOTIATION")).toContain("Quoted first");
    expect(explainLeadMove("NEW", "WON")).toContain("Move it to Quoted first");
  });

  it("allows exactly one step back, so a mis-drag is recoverable", () => {
    expect(canTransition(LEAD_TRANSITIONS, "QUOTED", "CONTACTED")).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, "NEGOTIATION", "QUOTED")).toBe(true);
    expect(canTransition(LEAD_TRANSITIONS, "NEGOTIATION", "NEW")).toBe(false);
    expect(explainLeadMove("NEGOTIATION", "NEW")).toContain("to Quoted");
  });

  it("can lose from any open stage, and reopens a loss to New only", () => {
    for (const stage of ["NEW", "CONTACTED", "QUOTED", "NEGOTIATION"] as const) {
      expect(canTransition(LEAD_TRANSITIONS, stage, "LOST")).toBe(true);
    }
    expect(LEAD_TRANSITIONS.LOST).toEqual(["NEW"]);
    expect(explainLeadMove("LOST", "QUOTED")).toBe("A lost lead reopens to New first.");
  });

  it("treats won as terminal", () => {
    expect(isTerminal(LEAD_TRANSITIONS, "WON")).toBe(true);
    expect(explainLeadMove("WON", "NEGOTIATION")).toContain("closed");
  });

  it("explains every refused move and none of the allowed ones", () => {
    for (const from of LEAD_STAGES) {
      for (const to of LEAD_STAGES) {
        const allowed = from === to || canTransition(LEAD_TRANSITIONS, from, to);
        expect(explainLeadMove(from, to) === null, `${from} -> ${to}`).toBe(allowed);
      }
    }
  });
});

describe("kanban positions", () => {
  it("takes the midpoint between neighbours", () => {
    expect(positionBetween(1000, 2000)).toBe(1500);
    expect(positionBetween(1000, 1001)).toBe(1000.5);
  });

  it("steps past the end and before the start", () => {
    expect(positionBetween(3000, null)).toBe(4000);
    expect(positionBetween(null, 1000)).toBe(0);
    expect(positionBetween(null, null)).toBe(1000);
  });

  it("asks for a rebalance once the gap is spent", () => {
    let low = 1000;
    const high = 2000;
    let drops = 0;
    for (;;) {
      const next = positionBetween(low, high);
      if (next === null) break;
      expect(next).toBeGreaterThan(low);
      expect(next).toBeLessThan(high);
      low = next;
      drops += 1;
    }
    // Plenty of room before a column has to be renumbered...
    expect(drops).toBeGreaterThan(25);
    // ...and it stops before the floats collapse into each other.
    expect(high - low).toBeLessThan(MIN_GAP * 2);
  });

  it("rebalances a column to even steps in the given order", () => {
    const positions = rebalancedPositions(["c", "a", "b"]);
    expect([...positions.entries()]).toEqual([
      ["c", 1000],
      ["a", 2000],
      ["b", 3000],
    ]);
  });

  it("weights value by probability without floats leaking into centavos", () => {
    expect(weightedValue(12_345_600, 2500)).toBe(3_086_400);
    expect(weightedValue(99, 3333)).toBe(33);
    expect(Number.isInteger(weightedValue(1_000_001, 7777))).toBe(true);
  });
});

// ---------------------------------------------------------------- segments

describe("customer segments", () => {
  const now = new Date("2026-09-24T04:00:00Z");
  const context = { now, vipThresholdCentavos: 5_000_000 };
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

  it("calls a customer with no realised orders new", () => {
    expect(
      classifySegment({ orderCount: 0, lifetimeValueCentavos: 0, lastOrderAt: null }, context),
    ).toBe("NEW");
  });

  it("calls a single recent order new, and two or more repeat", () => {
    expect(
      classifySegment(
        { orderCount: 1, lifetimeValueCentavos: 350_000, lastOrderAt: daysAgo(3) },
        context,
      ),
    ).toBe("NEW");
    expect(
      classifySegment(
        { orderCount: 2, lifetimeValueCentavos: 700_000, lastOrderAt: daysAgo(3) },
        context,
      ),
    ).toBe("REPEAT");
  });

  it("makes a very frequent buyer or a top-decile lifetime value VIP", () => {
    const frequent = SEGMENT_RULES.vipOrderCount;
    expect(
      classifySegment(
        { orderCount: frequent, lifetimeValueCentavos: 100_000, lastOrderAt: daysAgo(10) },
        context,
      ),
    ).toBe("VIP");
    expect(
      classifySegment(
        { orderCount: frequent - 1, lifetimeValueCentavos: 100_000, lastOrderAt: daysAgo(10) },
        context,
      ),
    ).toBe("REPEAT");
    expect(
      classifySegment(
        { orderCount: 1, lifetimeValueCentavos: 5_000_000, lastOrderAt: daysAgo(10) },
        context,
      ),
    ).toBe("VIP");
  });

  it("puts dormancy ahead of value: a quiet big spender is a win-back, not a VIP", () => {
    const quiet = daysAgo(SEGMENT_RULES.dormantAfterDays + 1);
    expect(
      classifySegment(
        { orderCount: 14, lifetimeValueCentavos: 9_000_000, lastOrderAt: quiet },
        context,
      ),
    ).toBe("DORMANT");
    const edge = daysAgo(SEGMENT_RULES.dormantAfterDays);
    expect(
      classifySegment({ orderCount: 2, lifetimeValueCentavos: 10_000, lastOrderAt: edge }, context),
    ).toBe("REPEAT");
  });

  it("sets the VIP bar at the tenth of buyers by value", () => {
    const values = Array.from({ length: 50 }, (_, index) => (index + 1) * 1000);
    // Fifty buyers: the top five are VIP, so the bar is the fifth highest.
    expect(vipThreshold(values)).toBe(46_000);
    expect(values.filter((value) => value >= vipThreshold(values))).toHaveLength(5);
  });

  it("ignores non-buyers for the VIP bar and has no VIPs when nobody bought", () => {
    expect(vipThreshold([0, 0, 0])).toBe(Number.POSITIVE_INFINITY);
    expect(vipThreshold([0, 0, 7000])).toBe(7000);
  });

  it("derives a display name from the customer type", () => {
    expect(
      displayNameFor({
        type: "INDIVIDUAL",
        firstName: "Maria Clara",
        lastName: "Dela Cruz",
        companyName: "x",
      }),
    ).toBe("Maria Clara Dela Cruz");
    expect(
      displayNameFor({
        type: "BUSINESS",
        firstName: "x",
        lastName: "y",
        companyName: " Aboitiz Hub Inc. ",
      }),
    ).toBe("Aboitiz Hub Inc.");
  });
});

// --------------------------------------------------------------------- SLA

describe("ticket SLA in Manila business hours", () => {
  it("counts straight through inside a working day", () => {
    // Thursday 10:00 plus 4 hours is 14:00 the same day.
    expect(addBusinessHours(manila("2026-09-24T10:00"), 4)).toEqual(manila("2026-09-24T14:00"));
  });

  it("carries the remainder to the next morning", () => {
    // Thursday 16:30 plus 4 hours: 1.5 today, 2.5 from Friday 09:00.
    expect(addBusinessHours(manila("2026-09-24T16:30"), 4)).toEqual(manila("2026-09-25T11:30"));
  });

  it("starts the clock at opening time for a ticket raised overnight", () => {
    expect(addBusinessHours(manila("2026-09-24T22:15"), 8)).toEqual(manila("2026-09-25T17:00"));
    expect(addBusinessHours(manila("2026-09-25T06:00"), 1)).toEqual(manila("2026-09-25T10:00"));
  });

  it("skips Sunday", () => {
    // Saturday 17:00 plus 4 hours: 1 on Saturday, then Monday 09:00 + 3.
    expect(addBusinessHours(manila("2026-09-26T17:00"), 4)).toEqual(manila("2026-09-28T12:00"));
    // Raised on Sunday afternoon, due Monday.
    expect(addBusinessHours(manila("2026-09-27T15:00"), 8)).toEqual(manila("2026-09-28T17:00"));
  });

  it("spreads a 72 hour low-priority target over eight working days", () => {
    // 72 business hours at 9 a day is 8 working days: Monday 28 to Saturday 3,
    // Sunday off, then Monday 5 and Tuesday 6.
    const due = addBusinessHours(manila("2026-09-28T09:00"), SLA_HOURS.LOW);
    expect(due).toEqual(manila("2026-10-06T18:00"));
  });

  it("judges finished tickets by resolution time and open ones by what is left", () => {
    const createdAt = manila("2026-09-24T09:00");
    const slaDueAt = manila("2026-09-24T17:00");
    expect(
      slaState({ createdAt, slaDueAt, resolvedAt: manila("2026-09-24T15:00") }, new Date()).kind,
    ).toBe("met");
    expect(
      slaState({ createdAt, slaDueAt, resolvedAt: manila("2026-09-25T10:00") }, new Date()).kind,
    ).toBe("missed");
    expect(
      slaState({ createdAt, slaDueAt, resolvedAt: null }, manila("2026-09-24T10:00")).kind,
    ).toBe("on-track");
    expect(
      slaState({ createdAt, slaDueAt, resolvedAt: null }, manila("2026-09-24T15:30")).kind,
    ).toBe("at-risk");
    const breached = slaState(
      { createdAt, slaDueAt, resolvedAt: null },
      manila("2026-09-24T19:00"),
    );
    expect(breached).toEqual({ kind: "breached", overdueMs: 2 * 3_600_000 });
  });

  it("formats durations compactly", () => {
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(3 * 3_600_000 + 20 * 60_000)).toBe("3h 20m");
    expect(formatDuration(2 * DAY + 4 * 3_600_000)).toBe("2d 4h");
    expect(formatDuration(DAY)).toBe("1d");
  });
});

describe("ticket status machine", () => {
  it("follows the plan's transitions", () => {
    expect(canTransition(TICKET_TRANSITIONS, "OPEN", "RESOLVED")).toBe(true);
    expect(canTransition(TICKET_TRANSITIONS, "IN_PROGRESS", "CLOSED")).toBe(false);
    expect(canTransition(TICKET_TRANSITIONS, "RESOLVED", "IN_PROGRESS")).toBe(false);
    expect(TICKET_TRANSITIONS.CLOSED).toEqual(["OPEN"]);
  });

  it("needs the resolve permission to finish or reopen, not to work a ticket", () => {
    expect(needsResolvePermission("IN_PROGRESS", "RESOLVED")).toBe(true);
    expect(needsResolvePermission("OPEN", "CLOSED")).toBe(true);
    expect(needsResolvePermission("CLOSED", "OPEN")).toBe(true);
    expect(needsResolvePermission("OPEN", "IN_PROGRESS")).toBe(false);
    expect(needsResolvePermission("IN_PROGRESS", "WAITING_CUSTOMER")).toBe(false);
  });

  it("reopens a closed ticket for seven days only", () => {
    const closedAt = manila("2026-09-01T12:00");
    expect(canReopenClosed(closedAt, new Date(closedAt.getTime() + 6 * DAY))).toBe(true);
    expect(canReopenClosed(closedAt, new Date(closedAt.getTime() + 8 * DAY))).toBe(false);
  });
});

// ------------------------------------------------------------------ inputs

describe("Manila date inputs", () => {
  it("reads a datetime-local value as Manila time", () => {
    expect(parseManilaDateTime("2026-09-24T09:00")?.toISOString()).toBe("2026-09-24T01:00:00.000Z");
    expect(toManilaDateTimeInput(new Date("2026-09-24T01:00:00Z"))).toBe("2026-09-24T09:00");
  });

  it("rejects dates that do not exist", () => {
    expect(parseManilaDateTime("2026-02-31T09:00")).toBeNull();
    expect(parseManilaDateTime("tomorrow")).toBeNull();
  });

  it("buckets by the Manila calendar day, not the UTC one", () => {
    // 23:30 UTC on the 23rd is 07:30 on the 24th in Manila.
    expect(manilaDayKey(new Date("2026-09-23T23:30:00Z"))).toBe("2026-09-24");
    expect(startOfManilaDay(new Date("2026-09-23T23:30:00Z")).toISOString()).toBe(
      "2026-09-23T16:00:00.000Z",
    );
  });

  it("normalises tags", () => {
    expect(parseTags("Bulk Buyer, esports,, ESPORTS , office fitout!")).toEqual([
      "bulk-buyer",
      "esports",
      "office-fitout",
    ]);
  });
});
