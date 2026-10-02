import { describe, expect, it } from "vitest";

import { emptyTables } from "../prisma/seed/lib/context";
import { atBusinessHour, clampToNow } from "../prisma/seed/lib/helpers";
import { assertNothingInTheFuture, findFutureDates } from "../prisma/seed/lib/invariants";

/**
 * Seeding rule 1: nothing that already happened may be dated in the future.
 *
 * The rule was documented but unchecked. An order placed on the final day took
 * its time of day from atBusinessHour, which spreads orders across Manila
 * trading hours and so reaches past the moment the seed is running. The future
 * placedAt then fell outside every report window while still counting towards
 * the customer's lifetime value, so the two disagreed by the value of those
 * orders.
 */

const NOW = new Date("2026-10-02T07:15:00.000Z");

describe("findFutureDates", () => {
  it("passes a history dated at or before now", () => {
    const tables = emptyTables();
    tables.orders.push({
      id: "ord_000001",
      placedAt: new Date("2026-10-02T06:00:00.000Z"),
    } as (typeof tables.orders)[number]);
    tables.orders.push({
      id: "ord_000002",
      placedAt: NOW,
    } as (typeof tables.orders)[number]);

    expect(findFutureDates(tables, NOW)).toEqual([]);
  });

  it("catches an order placed after now", () => {
    const tables = emptyTables();
    tables.orders.push({
      id: "ord_000003",
      placedAt: new Date("2026-10-02T11:13:00.000Z"),
    } as (typeof tables.orders)[number]);

    const found = findFutureDates(tables, NOW);
    expect(found).toHaveLength(1);
    expect(found[0]?.field).toBe("orders.placedAt");
    expect(found[0]?.id).toBe("ord_000003");
  });

  it("catches audit entries and login attempts stamped ahead of now", () => {
    const tables = emptyTables();
    tables.auditLogs.push({
      id: "aud_000001",
      createdAt: new Date("2026-10-02T13:00:00.000Z"),
    } as (typeof tables.auditLogs)[number]);
    tables.loginAttempts.push({
      id: "lat_000001",
      createdAt: new Date("2026-10-02T13:00:00.000Z"),
    } as (typeof tables.loginAttempts)[number]);

    expect(findFutureDates(tables, NOW).map((entry) => entry.field)).toEqual([
      "auditLogs.createdAt",
      "loginAttempts.createdAt",
    ]);
  });

  it("allows a target date to be in the future", () => {
    const tables = emptyTables();
    const ahead = new Date("2026-11-20T01:00:00.000Z");
    tables.activities.push({
      id: "act_000001",
      dueAt: ahead,
    } as (typeof tables.activities)[number]);
    tables.tickets.push({ id: "tkt_000001", slaDueAt: ahead } as (typeof tables.tickets)[number]);
    tables.leads.push({
      id: "lead_000001",
      expectedCloseDate: ahead,
    } as (typeof tables.leads)[number]);
    tables.promos.push({ id: "pro_000001", endsAt: ahead } as (typeof tables.promos)[number]);
    tables.purchaseOrders.push({
      id: "po_000001",
      expectedDate: ahead,
    } as (typeof tables.purchaseOrders)[number]);
    tables.supplierBills.push({
      id: "bill_000001",
      dueDate: ahead,
    } as (typeof tables.supplierBills)[number]);
    tables.warrantyClaims.push({
      id: "wc_000001",
      warrantyExpiresAt: ahead,
    } as (typeof tables.warrantyClaims)[number]);

    expect(findFutureDates(tables, NOW)).toEqual([]);
  });

  it("throws naming the offending field", () => {
    const tables = emptyTables();
    tables.orders.push({
      id: "ord_000004",
      placedAt: new Date("2026-10-02T11:13:00.000Z"),
    } as (typeof tables.orders)[number]);

    expect(() => assertNothingInTheFuture(tables, NOW)).toThrow(/orders\.placedAt on ord_000004/);
  });

  it("accepts an empty seed", () => {
    expect(() => assertNothingInTheFuture(emptyTables(), NOW)).not.toThrow();
  });
});

describe("clampToNow over a trading hour", () => {
  it("holds a final-day order back to now, which is what the seed was missing", () => {
    // atBusinessHour picks 09:00 to 21:00 Manila (01:00 to 13:00 UTC), so on
    // the day the seed runs it can land after the current moment.
    const placed = atBusinessHour(new Date("2026-10-02T00:00:00.000Z"));
    expect(clampToNow(placed, NOW).getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it("leaves an earlier day alone", () => {
    const placed = atBusinessHour(new Date("2026-09-20T00:00:00.000Z"));
    expect(clampToNow(placed, NOW)).toEqual(placed);
  });
});
