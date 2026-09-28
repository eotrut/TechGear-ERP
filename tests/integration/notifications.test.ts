import { randomBytes } from "node:crypto";

import type { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { notify, raiseOverdueTasks } from "@/features/notifications/services/notify";

import { createTestClient } from "./helpers";

/**
 * Notifications are one row per recipient, addressed by permission. The test
 * database is shared with other files, so every assertion is scoped to the
 * users this file creates.
 */

const databaseUrl = inject("databaseUrl");

describe.skipIf(databaseUrl === "")("notifications", () => {
  let db: PrismaClient;
  let people: Record<"admin" | "manager" | "sales" | "warehouse" | "retired", string>;
  const mine = () => Object.values(people);

  async function user(role: Role, label: string, isActive = true): Promise<string> {
    const tag = randomBytes(4).toString("hex");
    const created = await db.user.create({
      data: {
        email: `${label}-${tag}@test.techgear.ph`,
        name: `${label} ${tag}`,
        passwordHash: "not-a-real-hash",
        role,
        isActive,
      },
      select: { id: true },
    });
    return created.id;
  }

  async function recipients(title: string) {
    const rows = await db.notification.findMany({
      where: { title, userId: { in: mine() } },
      select: { userId: true, targetRole: true },
    });
    return new Map(rows.map((row) => [row.userId, row.targetRole]));
  }

  beforeAll(async () => {
    db = createTestClient(databaseUrl);
    people = {
      admin: await user("ADMIN", "admin"),
      manager: await user("MANAGER", "manager"),
      sales: await user("SALES", "sales"),
      warehouse: await user("WAREHOUSE", "warehouse"),
      retired: await user("WAREHOUSE", "retired", false),
    };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("reaches everyone holding the audience permission, and nobody else", async () => {
    const title = `Low stock: TST-${randomBytes(3).toString("hex")}`;
    await notify(db, { type: "LOW_STOCK", title, body: "Down to 2.", link: "/inventory/alerts" });

    const got = await recipients(title);
    // inventory.viewAlerts: Admin, Manager and Warehouse. Not Sales, not the deactivated.
    expect([...got.keys()].sort()).toEqual([people.admin, people.manager, people.warehouse].sort());
    expect(got.get(people.warehouse)).toBe("WAREHOUSE");
  });

  it("adds named people personally and leaves the actor out", async () => {
    const title = `New ticket: TKT-${randomBytes(3).toString("hex")}`;
    await notify(db, {
      type: "NEW_TICKET",
      title,
      body: "Keyboard not detected.",
      link: "/tickets",
      userIds: [people.sales, null],
      excludeUserId: people.manager,
    });

    const got = await recipients(title);
    // tickets.assign is Admin and Manager; the manager opened it, Sales was assigned it.
    expect([...got.keys()].sort()).toEqual([people.admin, people.sales].sort());
    expect(got.get(people.sales)).toBeNull();
    expect(got.get(people.admin)).toBe("ADMIN");
  });

  it("raises an overdue task once, however often the bell is opened", async () => {
    const now = new Date();
    const due = new Date(now.getTime() - 3 * 3_600_000);
    // One late, one done (never overdue), one not yet due.
    const [late] = await Promise.all(
      [
        { subject: "Call Baguio Pixel Works back", status: "OPEN" as const, dueAt: due },
        { subject: "Send the B2B price list", status: "DONE" as const, dueAt: due },
        {
          subject: "Follow up on the 12.12 quote",
          status: "OPEN" as const,
          dueAt: new Date(now.getTime() + 86_400_000),
        },
      ].map((activity) =>
        db.activity.create({
          data: { ...activity, type: "TASK", ownerId: people.sales },
          select: { id: true },
        }),
      ),
    );

    expect(await raiseOverdueTasks(db, people.sales, now)).toBe(1);
    expect(await raiseOverdueTasks(db, people.sales, now)).toBe(0);

    const rows = await db.notification.findMany({
      where: { userId: people.sales, type: "OVERDUE_TASK" },
      select: { dedupeKey: true, createdAt: true },
    });
    expect(rows.map((row) => row.dedupeKey)).toEqual([`activity:${late!.id}:overdue`]);
    expect(rows[0]?.createdAt.getTime()).toBe(due.getTime());
  });
});
