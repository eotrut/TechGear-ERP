import type { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  can,
  canAll,
  canAllOf,
  canAnyOf,
  isOwnScoped,
  permissionsFor,
  scopeFor,
} from "@/lib/rbac/can";
import { MATRIX, PERMISSIONS, type Permission } from "@/lib/rbac/matrix";
import { isPublicRoute, permissionForRoute, ROUTE_RULES } from "@/lib/rbac/routes";

const ROLES: Role[] = ["ADMIN", "MANAGER", "SALES", "WAREHOUSE"];

describe("permission matrix integrity", () => {
  it("has an entry for every declared permission", () => {
    for (const permission of PERMISSIONS) {
      expect(MATRIX[permission], `missing matrix entry for ${permission}`).toBeDefined();
    }
  });

  it("declares no permissions outside the permission list", () => {
    const declared = new Set<string>(PERMISSIONS);
    for (const key of Object.keys(MATRIX)) {
      expect(declared.has(key), `${key} is in the matrix but not in PERMISSIONS`).toBe(true);
    }
  });

  it("only ever grants a known role a known access level", () => {
    for (const permission of PERMISSIONS) {
      for (const [role, access] of Object.entries(MATRIX[permission])) {
        expect(ROLES).toContain(role as Role);
        expect(["all", "own"]).toContain(access);
      }
    }
  });

  it("grants every permission to at least one role", () => {
    for (const permission of PERMISSIONS) {
      const granted = ROLES.some((role) => can(role, permission));
      expect(granted, `${permission} is granted to nobody`).toBe(true);
    }
  });
});

describe("deny by default", () => {
  it("denies everything when there is no role", () => {
    for (const permission of PERMISSIONS) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
      expect(scopeFor(null, permission)).toBeNull();
    }
  });

  it("returns null scope rather than a default when access is absent", () => {
    // WAREHOUSE has no business creating orders.
    expect(scopeFor("WAREHOUSE", "orders.create")).toBeNull();
    expect(can("WAREHOUSE", "orders.create")).toBe(false);
  });
});

describe("admin", () => {
  it("holds every permission", () => {
    for (const permission of PERMISSIONS) {
      expect(can("ADMIN", permission), `ADMIN is missing ${permission}`).toBe(true);
    }
  });

  it("is the only role that can manage users", () => {
    for (const permission of ["users.view", "users.manage", "users.resetPassword"] as const) {
      expect(can("ADMIN", permission)).toBe(true);
      expect(can("MANAGER", permission)).toBe(false);
      expect(can("SALES", permission)).toBe(false);
      expect(can("WAREHOUSE", permission)).toBe(false);
    }
  });

  it("is the only role that can destroy records or change settings", () => {
    const destructive: Permission[] = [
      "products.archive",
      "taxonomy.delete",
      "customers.delete",
      "suppliers.delete",
      "expenses.delete",
      "bills.void",
      "settings.manage",
    ];
    for (const permission of destructive) {
      expect(can("ADMIN", permission)).toBe(true);
      expect(can("MANAGER", permission), `MANAGER should not hold ${permission}`).toBe(false);
      expect(can("SALES", permission)).toBe(false);
      expect(can("WAREHOUSE", permission)).toBe(false);
    }
  });
});

describe("manager", () => {
  it("can run the business but cannot delete or administer", () => {
    expect(canAllOf("MANAGER", ["orders.refund", "purchasing.manage", "products.update"])).toBe(
      true,
    );
    expect(canAnyOf("MANAGER", ["users.manage", "settings.manage", "customers.delete"])).toBe(
      false,
    );
  });

  it("can read the audit log", () => {
    // Read access so they can investigate; there is no mutation to hold back.
    expect(can("MANAGER", "audit.view")).toBe(true);
  });
});

describe("sales", () => {
  it("can sell but cannot refund or fulfil", () => {
    expect(can("SALES", "orders.create")).toBe(true);
    expect(can("SALES", "orders.recordPayment")).toBe(true);
    expect(can("SALES", "pos.use")).toBe(true);
    expect(can("SALES", "orders.refund")).toBe(false);
    expect(can("SALES", "orders.fulfil")).toBe(false);
  });

  it("is scoped to its own records where the matrix says own", () => {
    expect(scopeFor("SALES", "orders.cancel")).toBe("own");
    expect(isOwnScoped("SALES", "orders.cancel")).toBe(true);
    expect(canAll("SALES", "orders.cancel")).toBe(false);

    expect(scopeFor("SALES", "leads.moveStage")).toBe("own");
    expect(scopeFor("SALES", "leads.convert")).toBe("own");
    expect(scopeFor("SALES", "tickets.resolve")).toBe("own");
    expect(scopeFor("SALES", "pos.discount")).toBe("own");
    expect(scopeFor("SALES", "reports.salesBySalesperson")).toBe("own");
  });

  it("cannot see finance", () => {
    expect(can("SALES", "dashboard.viewFinanceTiles")).toBe(false);
    expect(can("SALES", "reports.finance")).toBe(false);
    expect(can("SALES", "reports.aging")).toBe(false);
    expect(can("SALES", "expenses.view")).toBe(false);
    expect(can("SALES", "bills.view")).toBe(false);
    expect(can("SALES", "products.viewCost")).toBe(false);
  });

  it("cannot reach purchasing or suppliers", () => {
    expect(can("SALES", "purchasing.view")).toBe(false);
    expect(can("SALES", "suppliers.view")).toBe(false);
  });
});

describe("warehouse", () => {
  it("can move stock and fulfil but cannot sell", () => {
    expect(
      canAllOf("WAREHOUSE", [
        "inventory.adjust",
        "inventory.transfer",
        "purchasing.receive",
        "orders.fulfil",
      ]),
    ).toBe(true);
    expect(can("WAREHOUSE", "orders.create")).toBe(false);
    expect(can("WAREHOUSE", "pos.use")).toBe(false);
  });

  it("never sees order money", () => {
    // Decision D-10: warehouse picks and packs, and must not see what the
    // customer paid. Stripping this server-side is what the permission drives.
    expect(can("WAREHOUSE", "orders.view")).toBe(true);
    expect(can("WAREHOUSE", "orders.viewMoney")).toBe(false);
    expect(can("WAREHOUSE", "customers.view360")).toBe(false);
  });

  it("does see product cost, because receiving requires entering it", () => {
    expect(can("WAREHOUSE", "products.viewCost")).toBe(true);
  });

  it("cannot reach CRM", () => {
    expect(can("WAREHOUSE", "leads.view")).toBe(false);
    expect(can("WAREHOUSE", "tickets.view")).toBe(false);
    expect(can("WAREHOUSE", "customers.view360")).toBe(false);
  });

  it("cannot read the audit log", () => {
    expect(can("WAREHOUSE", "audit.view")).toBe(false);
  });
});

describe("every role", () => {
  it("can manage its own account and notifications", () => {
    for (const role of ROLES) {
      expect(scopeFor(role, "account.manageOwn")).toBe("own");
      expect(scopeFor(role, "notifications.viewOwn")).toBe("own");
      expect(scopeFor(role, "activities.manageOwn")).toBe("own");
    }
  });

  it("holds a plausible number of permissions for its seniority", () => {
    const counts = Object.fromEntries(
      ROLES.map((role) => [role, permissionsFor(role).length]),
    ) as Record<Role, number>;

    expect(counts.ADMIN).toBe(PERMISSIONS.length);
    expect(counts.MANAGER).toBeLessThan(counts.ADMIN);
    expect(counts.SALES).toBeLessThan(counts.MANAGER);
    expect(counts.WAREHOUSE).toBeLessThan(counts.MANAGER);
  });
});

describe("route rules", () => {
  it("resolves the most specific prefix first", () => {
    // /purchasing/bills must not fall through to the /purchasing rule.
    expect(permissionForRoute("/purchasing/bills")).toBe("bills.view");
    expect(permissionForRoute("/purchasing")).toBe("purchasing.view");
    expect(permissionForRoute("/settings/users")).toBe("users.view");
    expect(permissionForRoute("/settings")).toBe("settings.manage");
    expect(permissionForRoute("/inventory/transfers")).toBe("inventory.transfer");
    expect(permissionForRoute("/inventory")).toBe("inventory.viewLevels");
  });

  it("matches nested paths under a rule", () => {
    expect(permissionForRoute("/orders/ord_000001")).toBe("orders.view");
    expect(permissionForRoute("/settings/users/usr_000001")).toBe("users.view");
  });

  it("returns null for routes it does not cover", () => {
    expect(permissionForRoute("/nowhere")).toBeNull();
  });

  it("only references permissions that exist", () => {
    const declared = new Set<string>(PERMISSIONS);
    for (const rule of ROUTE_RULES) {
      expect(declared.has(rule.permission), `${rule.prefix} uses unknown ${rule.permission}`).toBe(
        true,
      );
    }
  });

  it("treats only the intended routes as public", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/api/auth/session")).toBe(true);
    expect(isPublicRoute("/forbidden")).toBe(true);

    expect(isPublicRoute("/dashboard")).toBe(false);
    expect(isPublicRoute("/settings/users")).toBe(false);
    // A path that merely starts with the same characters is not public.
    expect(isPublicRoute("/loginsomething")).toBe(false);
  });
});

describe("route rules match the matrix", () => {
  it("gives each role only the routes its permissions allow", () => {
    const reachable = (role: Role) =>
      ROUTE_RULES.filter((rule) => can(role, rule.permission)).map((rule) => rule.prefix);

    const sales = reachable("SALES");
    expect(sales).toContain("/orders");
    expect(sales).toContain("/leads");
    expect(sales).not.toContain("/purchasing");
    expect(sales).not.toContain("/expenses");
    expect(sales).not.toContain("/audit");
    expect(sales).not.toContain("/settings");

    const warehouse = reachable("WAREHOUSE");
    expect(warehouse).toContain("/inventory");
    expect(warehouse).toContain("/purchasing");
    expect(warehouse).not.toContain("/leads");
    expect(warehouse).not.toContain("/tickets");
    expect(warehouse).not.toContain("/audit");

    const admin = reachable("ADMIN");
    expect(admin).toContain("/settings/users");
    expect(admin).toContain("/audit");
  });
});
