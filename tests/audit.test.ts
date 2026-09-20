import { describe, expect, it } from "vitest";

import { diffRecords } from "@/lib/audit-diff";

/**
 * The audit diff is what makes the trail useful, and it is also the place a
 * password hash could accidentally end up in a table that Managers can read.
 */

describe("diffRecords", () => {
  it("records only the fields that actually changed", () => {
    const changes = diffRecords(
      { name: "Katrina Ocampo", role: "MANAGER", phone: "+63 2 8123 4567" },
      { name: "Katrina Ocampo", role: "ADMIN", phone: "+63 2 8123 4567" },
    );

    expect(Object.keys(changes)).toEqual(["role"]);
    expect(changes.role).toEqual({ from: "MANAGER", to: "ADMIN" });
  });

  it("returns nothing when a record is saved unchanged", () => {
    const record = { name: "Miguel Villanueva", role: "SALES" };
    expect(diffRecords(record, { ...record })).toEqual({});
  });

  it("redacts sensitive fields rather than storing them", () => {
    const changes = diffRecords(
      { passwordHash: "$2b$12$oldhashvalue", name: "Divina Salazar" },
      { passwordHash: "$2b$12$newhashvalue", name: "Divina Salazar" },
    );

    expect(changes.passwordHash).toEqual({ from: "[redacted]", to: "[redacted]" });
    // The real hashes must not appear anywhere in the serialised entry.
    const serialised = JSON.stringify(changes);
    expect(serialised).not.toContain("oldhashvalue");
    expect(serialised).not.toContain("newhashvalue");
  });

  it("still records that a sensitive field changed", () => {
    const changes = diffRecords({ passwordHash: "a" }, { passwordHash: "b" });
    expect(Object.keys(changes)).toContain("passwordHash");
  });

  it("ignores bookkeeping timestamps", () => {
    const changes = diffRecords(
      { name: "Rafael", updatedAt: new Date("2026-01-01"), createdAt: new Date("2025-01-01") },
      { name: "Rafael", updatedAt: new Date("2026-06-01"), createdAt: new Date("2025-01-01") },
    );
    expect(changes).toEqual({});
  });

  it("compares dates by value, not by reference", () => {
    const changes = diffRecords(
      { deliveredAt: new Date("2026-03-04T00:00:00Z") },
      { deliveredAt: new Date("2026-03-04T00:00:00Z") },
    );
    expect(changes).toEqual({});
  });

  it("serialises dates so the result can be stored as JSON", () => {
    const changes = diffRecords(
      { deliveredAt: new Date("2026-03-04T00:00:00Z") },
      { deliveredAt: new Date("2026-03-05T00:00:00Z") },
    );
    expect(changes.deliveredAt).toEqual({
      from: "2026-03-04T00:00:00.000Z",
      to: "2026-03-05T00:00:00.000Z",
    });
    expect(() => JSON.stringify(changes)).not.toThrow();
  });

  it("treats a created record as every field going from nothing to something", () => {
    const changes = diffRecords(null, { name: "New Person", role: "SALES" });
    expect(changes.name).toEqual({ from: undefined, to: "New Person" });
    expect(changes.role).toEqual({ from: undefined, to: "SALES" });
  });

  it("distinguishes null from a missing field and from false", () => {
    expect(diffRecords({ phone: null }, { phone: "+63 917 000 0000" }).phone).toEqual({
      from: null,
      to: "+63 917 000 0000",
    });
    expect(diffRecords({ isActive: true }, { isActive: false }).isActive).toEqual({
      from: true,
      to: false,
    });
  });

  it("accepts extra sensitive field names", () => {
    const changes = diffRecords({ taxId: "123" }, { taxId: "456" }, { sensitive: ["taxId"] });
    expect(changes.taxId).toEqual({ from: "[redacted]", to: "[redacted]" });
  });
});
