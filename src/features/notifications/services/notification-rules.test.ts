import type { NotificationType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { can, rolesWith } from "@/lib/rbac/can";
import { permissionForRoute } from "@/lib/rbac/routes";

import { AUDIENCE, overdueTaskKey, unreadBadge } from "./notification-rules";

function audience(type: NotificationType) {
  const permission = AUDIENCE[type];
  if (!permission) throw new Error(`${type} is personal, with no audience`);
  return permission;
}

describe("notification audiences", () => {
  it("send each alert to the roles that can act on it", () => {
    expect(rolesWith(audience("LOW_STOCK")).sort()).toEqual(["ADMIN", "MANAGER", "WAREHOUSE"]);
    expect(rolesWith(audience("PO_RECEIVED")).sort()).toEqual(["ADMIN", "MANAGER"]);
  });

  it("never tell a role about something it cannot open", () => {
    const links: Partial<Record<NotificationType, string>> = {
      LOW_STOCK: "/inventory/alerts",
      OUT_OF_STOCK: "/inventory/alerts",
      NEW_TICKET: "/tickets/tkt_000001",
      PO_RECEIVED: "/purchasing/po_000001",
      WARRANTY_CLAIM: "/warranty/wcl_000001",
    };
    for (const [type, link] of Object.entries(links) as [NotificationType, string][]) {
      const gate = permissionForRoute(link);
      for (const role of rolesWith(audience(type))) {
        expect(gate ? can(role, gate) : true, `${role} and ${type}`).toBe(true);
      }
    }
  });

  it("keys an overdue task by its id, and caps the badge", () => {
    expect(overdueTaskKey("act_000042")).toBe("activity:act_000042:overdue");
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(7)).toBe("7");
    expect(unreadBadge(140)).toBe("99+");
  });
});
