import { describe, expect, it } from "vitest";

import { can } from "@/lib/rbac/can";
import { permissionForRoute } from "@/lib/rbac/routes";

import { navigation, paletteEntriesFor, quickActions, secondaryPages } from "./navigation";

const ROLES = ["ADMIN", "MANAGER", "SALES", "WAREHOUSE"] as const;

describe("command palette entries", () => {
  it("never offer a page the route gate would refuse", () => {
    for (const role of ROLES) {
      const { pages, actions } = paletteEntriesFor(role);
      for (const item of [...pages, ...actions]) {
        const gate = permissionForRoute(item.href);
        expect(gate ? can(role, gate) : true, `${role} ${item.href}`).toBe(true);
      }
    }
  });

  it("name the same permission the page checks, so none vanishes silently", () => {
    // If a role holds the item's permission, the route in front of it must let
    // that role through too; otherwise the palette would quietly drop it.
    for (const item of [...quickActions, ...secondaryPages]) {
      const gate = permissionForRoute(item.href);
      for (const role of ROLES) {
        if (!can(role, item.permission) || !gate) continue;
        expect(can(role, gate), `${role} ${item.href}`).toBe(true);
      }
    }
  });

  it("puts every built sidebar page in the palette", () => {
    const built = navigation.flatMap((group) => group.items).filter((item) => item.built);
    expect(built.find((item) => item.href === "/pos")).toBeDefined();
    const admin = paletteEntriesFor("ADMIN").pages.map((page) => page.href);
    for (const item of built) expect(admin).toContain(item.href);
  });
});
