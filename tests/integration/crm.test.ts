import { randomBytes } from "node:crypto";

import type { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { setActivityStatus } from "@/features/activities/services/activities";
import { insertCustomer } from "@/features/customers/services/customers";
import { convertLead, createLead, moveLead } from "@/features/leads/services/leads";
import { MIN_GAP } from "@/features/leads/services/pipeline";
import { addBusinessHours, SLA_HOURS } from "@/features/tickets/services/sla";
import { addComment, changeTicketStatus, createTicket } from "@/features/tickets/services/tickets";
import { DomainError, InvalidTransitionError } from "@/lib/errors";

import { createTestClient } from "./helpers";

/**
 * The CRM services against a real Postgres: the pipeline rules as the server
 * enforces them under a row lock, the "own" scope Sales works under, kanban
 * positions, and the ticket clock. Every test makes its own users, customers
 * and leads, so it never depends on another test's rows.
 */

const databaseUrl = inject("databaseUrl");

type People = { sales: string; otherSales: string; manager: string };

describe.skipIf(databaseUrl === "")("crm", () => {
  let db: PrismaClient;
  let people: People;

  async function user(role: Role, label: string): Promise<string> {
    const tag = randomBytes(4).toString("hex");
    const created = await db.user.create({
      data: {
        email: `${label}-${tag}@test.techgear.ph`,
        name: `${label} ${tag}`,
        passwordHash: "not-a-real-hash",
        role,
      },
      select: { id: true },
    });
    return created.id;
  }

  async function customer(): Promise<string> {
    const tag = randomBytes(4).toString("hex");
    const created = await db.$transaction((tx) =>
      insertCustomer(
        tx,
        {
          type: "BUSINESS",
          firstName: null,
          lastName: null,
          companyName: `Test Account ${tag}`,
          displayName: `Test Account ${tag}`,
          email: `ap-${tag}@test.example.ph`,
          phone: "+63 2 8123 4567",
          taxId: null,
          sourceChannel: "B2B",
          tags: [],
          facebookHandle: null,
          instagramHandle: null,
          notes: null,
          creditLimitCentavos: 0,
        },
        null,
      ),
    );
    return created.id;
  }

  async function lead(ownerId: string, title = "Office fitout") {
    return db.$transaction((tx) =>
      createLead(
        tx,
        {
          title,
          contactName: "Andrea Villanueva",
          company: "Test Holdings",
          email: "",
          phone: "",
          value: "150000",
          probability: "",
          source: "",
          expectedCloseDate: "",
          ownerId: "",
          customerId: "",
        },
        { id: ownerId, canAssign: false },
      ),
    );
  }

  const move = (
    leadId: string,
    toStage: Parameters<typeof moveLead>[1]["toStage"],
    actor: { id: string; scope: "all" | "own" },
    extra: { beforeId?: string | null; afterId?: string | null; lostReason?: string } = {},
  ) =>
    db.$transaction((tx) =>
      moveLead(
        tx,
        {
          leadId,
          toStage,
          beforeId: extra.beforeId ?? null,
          afterId: extra.afterId ?? null,
          lostReason: extra.lostReason,
        },
        actor,
      ),
    );

  beforeAll(async () => {
    db = createTestClient(databaseUrl);
    people = {
      sales: await user("SALES", "sales"),
      otherSales: await user("SALES", "sales2"),
      manager: await user("MANAGER", "manager"),
    };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  // ---------------------------------------------------------------- leads

  describe("lead pipeline", () => {
    it("numbers a new lead and starts it in New", async () => {
      const created = await lead(people.sales);
      expect(created.code).toMatch(/^LEAD-\d{4,}$/);
      const row = await db.lead.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.stage).toBe("NEW");
      expect(row.ownerId).toBe(people.sales);
    });

    it("moves one stage at a time and names the missing step on a skip", async () => {
      const { id } = await lead(people.sales);
      await expect(move(id, "NEGOTIATION", { id: people.sales, scope: "own" })).rejects.toThrow(
        "Move it to Contacted first",
      );
      const moved = await move(id, "CONTACTED", { id: people.sales, scope: "own" });
      expect(moved).toMatchObject({ from: "NEW", to: "CONTACTED" });
      const row = await db.lead.findUniqueOrThrow({ where: { id } });
      expect(row.stage).toBe("CONTACTED");
      expect(row.probabilityBps).toBe(2500);
    });

    it("refuses Sales moving somebody else's lead, and lets a manager", async () => {
      const { id } = await lead(people.otherSales);
      await expect(move(id, "CONTACTED", { id: people.sales, scope: "own" })).rejects.toThrow(
        DomainError,
      );
      expect((await db.lead.findUniqueOrThrow({ where: { id } })).stage).toBe("NEW");
      await move(id, "CONTACTED", { id: people.manager, scope: "all" });
      expect((await db.lead.findUniqueOrThrow({ where: { id } })).stage).toBe("CONTACTED");
    });

    it("will not win a lead that has no customer, or lose one without a reason", async () => {
      const { id } = await lead(people.sales);
      const actor = { id: people.sales, scope: "own" } as const;
      await move(id, "CONTACTED", actor);
      await move(id, "QUOTED", actor);
      await expect(move(id, "WON", actor)).rejects.toThrow("Convert");
      await expect(move(id, "LOST", actor)).rejects.toThrow("why it was lost");

      await move(id, "LOST", actor, { lostReason: "Budget deferred." });
      const lost = await db.lead.findUniqueOrThrow({ where: { id } });
      expect(lost.lostReason).toBe("Budget deferred.");
      expect(lost.lostAt).not.toBeNull();

      await expect(move(id, "QUOTED", actor)).rejects.toThrow(InvalidTransitionError);
      await move(id, "NEW", actor);
      const reopened = await db.lead.findUniqueOrThrow({ where: { id } });
      expect(reopened).toMatchObject({ stage: "NEW", lostAt: null, lostReason: null });
    });

    it("drops a card between its neighbours without touching the rest of the column", async () => {
      const actor = { id: people.manager, scope: "all" } as const;
      const [a, b, c] = [
        await lead(people.sales),
        await lead(people.sales),
        await lead(people.sales),
      ];
      // New cards go on top, so the column now reads c, b, a.
      const before = await db.lead.findMany({
        where: { id: { in: [a.id, b.id] } },
        select: { id: true, position: true, updatedAt: true },
      });

      await move(c.id, "NEW", actor, { beforeId: b.id, afterId: a.id });
      const rows = await db.lead.findMany({
        where: { id: { in: [a.id, b.id, c.id] } },
        select: { id: true, position: true, updatedAt: true },
      });
      const at = (id: string) => rows.find((row) => row.id === id)?.position ?? NaN;
      expect(at(c.id)).toBeGreaterThan(at(b.id));
      expect(at(c.id)).toBeLessThan(at(a.id));
      // The neighbours were read, not rewritten.
      for (const row of before) {
        expect(rows.find((r) => r.id === row.id)?.position).toBe(row.position);
      }
    });

    it("renumbers only the affected column once a gap is spent", async () => {
      const actor = { id: people.manager, scope: "all" } as const;
      const [x, y, z] = [
        await lead(people.sales),
        await lead(people.sales),
        await lead(people.sales),
      ];
      for (const id of [x.id, y.id, z.id]) await move(id, "CONTACTED", actor);
      // Squeeze x and y together, far past the point a midpoint is safe.
      await db.lead.update({ where: { id: x.id }, data: { position: 5_000_000 } });
      await db.lead.update({ where: { id: y.id }, data: { position: 5_000_000 + MIN_GAP / 2 } });
      const untouched = await db.lead.findFirstOrThrow({
        where: { stage: "NEW" },
        select: { id: true, position: true },
      });

      const result = await move(z.id, "CONTACTED", actor, { beforeId: x.id, afterId: y.id });
      expect(result.rebalanced).toBe(true);

      const column = await db.lead.findMany({
        where: { stage: "CONTACTED" },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      });
      const ids = column.map((row) => row.id);
      expect(ids.indexOf(x.id)).toBe(ids.indexOf(z.id) - 1);
      expect(ids.indexOf(y.id)).toBe(ids.indexOf(z.id) + 1);
      // Evenly spaced again...
      const gaps = column
        .slice(1)
        .map((row, index) => row.position - (column[index]?.position ?? 0));
      expect(Math.min(...gaps)).toBeGreaterThan(1);
      // ...and nothing in other columns moved.
      const still = await db.lead.findUniqueOrThrow({ where: { id: untouched.id } });
      expect(still.position).toBe(untouched.position);
    });

    it("converts a lead into a new customer and wins it", async () => {
      const actor = { id: people.sales, scope: "own" } as const;
      const { id } = await lead(people.sales, "Esports cafe refresh");
      await move(id, "CONTACTED", actor);
      await move(id, "QUOTED", actor);

      const converted = await db.$transaction((tx) =>
        convertLead(
          tx,
          {
            mode: "new",
            leadId: id,
            type: "BUSINESS",
            firstName: "",
            lastName: "",
            companyName: `Marikina Esports ${randomBytes(3).toString("hex")}`,
            email: "",
            phone: "0917 555 0142",
          },
          actor,
        ),
      );
      expect(converted.customer.created).toBe(true);
      expect(converted.customer.code).toMatch(/^CUS-\d{5,}$/);

      const won = await db.lead.findUniqueOrThrow({ where: { id } });
      expect(won).toMatchObject({
        stage: "WON",
        customerId: converted.customer.id,
        probabilityBps: 10_000,
      });
      const made = await db.customer.findUniqueOrThrow({ where: { id: converted.customer.id } });
      expect(made.tags).toContain("from-lead");
      expect(made.sourceChannel).toBeNull();
    });

    it("lets exactly one of two simultaneous conversions win", async () => {
      const actor = { id: people.manager, scope: "all" } as const;
      const { id } = await lead(people.sales);
      await move(id, "CONTACTED", actor);
      await move(id, "QUOTED", actor);
      const account = await customer();

      const attempt = () =>
        db.$transaction((tx) =>
          convertLead(tx, { mode: "existing", leadId: id, customerId: account }, actor),
        );
      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.find((r) => r.status === "rejected");
      expect(refused && refused.status === "rejected" && String(refused.reason)).toContain(
        "already won",
      );
    });
  });

  // -------------------------------------------------------------- tickets

  describe("tickets", () => {
    async function ticket(assignee: string | null, canAssign = true) {
      const customerId = await customer();
      return db.$transaction((tx) =>
        createTicket(
          tx,
          {
            customerId,
            subject: "Wireless dongle keeps disconnecting",
            description: "Drops every few minutes from the rear port.",
            priority: "HIGH",
            orderId: "",
            variantId: "",
            assigneeId: assignee ?? "",
          },
          { id: people.manager, canAssign },
        ),
      );
    }

    it("sets the SLA from priority in business hours and numbers it by year", async () => {
      const created = await ticket(people.sales);
      const row = await db.ticket.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.ticketNumber).toMatch(/^TKT-\d{4}-\d{4,}$/);
      expect(row.slaDueAt.getTime()).toBe(
        addBusinessHours(row.createdAt, SLA_HOURS.HIGH).getTime(),
      );
    });

    it("assigns a ticket to whoever opens it when they cannot assign", async () => {
      const created = await ticket(people.otherSales, false);
      const row = await db.ticket.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.assigneeId).toBe(people.manager);
    });

    it("stamps first response on the first public reply, never on a note", async () => {
      const { id } = await ticket(people.sales);
      await db.$transaction((tx) =>
        addComment(
          tx,
          { ticketId: id, body: "Checked stock.", internal: true },
          { id: people.sales },
        ),
      );
      expect((await db.ticket.findUniqueOrThrow({ where: { id } })).firstResponseAt).toBeNull();

      const reply = await db.$transaction((tx) =>
        addComment(
          tx,
          { ticketId: id, body: "Try the front port.", internal: false },
          { id: people.sales },
        ),
      );
      expect(reply.firstResponse).toBe(true);
      const stamped = (await db.ticket.findUniqueOrThrow({ where: { id } })).firstResponseAt;
      expect(stamped).not.toBeNull();

      await db.$transaction((tx) =>
        addComment(tx, { ticketId: id, body: "Any luck?", internal: false }, { id: people.sales }),
      );
      expect((await db.ticket.findUniqueOrThrow({ where: { id } })).firstResponseAt).toEqual(
        stamped,
      );
    });

    it("lets Sales resolve only tickets assigned to them", async () => {
      const mine = await ticket(people.sales);
      const theirs = await ticket(people.otherSales);
      const sales = { id: people.sales, resolveScope: "own" as const };

      await expect(
        db.$transaction((tx) => changeTicketStatus(tx, theirs.id, "RESOLVED", sales)),
      ).rejects.toThrow("not assigned to you");

      await db.$transaction((tx) => changeTicketStatus(tx, mine.id, "IN_PROGRESS", sales));
      await db.$transaction((tx) => changeTicketStatus(tx, mine.id, "RESOLVED", sales));
      const row = await db.ticket.findUniqueOrThrow({ where: { id: mine.id } });
      expect(row.status).toBe("RESOLVED");
      expect(row.resolvedAt).not.toBeNull();
    });

    it("refuses moves the status machine does not allow", async () => {
      const { id } = await ticket(people.sales);
      const manager = { id: people.manager, resolveScope: "all" as const };
      await db.$transaction((tx) => changeTicketStatus(tx, id, "IN_PROGRESS", manager));
      await expect(
        db.$transaction((tx) => changeTicketStatus(tx, id, "CLOSED", manager)),
      ).rejects.toThrow(InvalidTransitionError);
    });

    it("closes the thread when closed, and reopens with a fresh target within the window", async () => {
      const { id } = await ticket(people.sales);
      const manager = { id: people.manager, resolveScope: "all" as const };
      await db.$transaction((tx) => changeTicketStatus(tx, id, "CLOSED", manager));
      const closed = await db.ticket.findUniqueOrThrow({ where: { id } });
      expect(closed.resolvedAt).not.toBeNull();

      await expect(
        db.$transaction((tx) =>
          addComment(tx, { ticketId: id, body: "Hello?", internal: false }, { id: people.sales }),
        ),
      ).rejects.toThrow("closed");

      await db.$transaction((tx) => changeTicketStatus(tx, id, "OPEN", manager));
      const reopened = await db.ticket.findUniqueOrThrow({ where: { id } });
      expect(reopened).toMatchObject({ status: "OPEN", resolvedAt: null, closedAt: null });
      expect(reopened.slaDueAt.getTime()).toBeGreaterThan(closed.slaDueAt.getTime() - 1);

      // Past the seven-day window, reopening is refused.
      await db.$transaction((tx) => changeTicketStatus(tx, id, "CLOSED", manager));
      await db.ticket.update({
        where: { id },
        data: { closedAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      await expect(
        db.$transaction((tx) => changeTicketStatus(tx, id, "OPEN", manager)),
      ).rejects.toThrow("new ticket");
    });
  });

  // ----------------------------------------------------------- activities

  describe("activities", () => {
    it("lets only the owner, or someone who assigns work, tick an activity off", async () => {
      const activity = await db.activity.create({
        data: { type: "CALL", subject: "Call back about the quote", ownerId: people.otherSales },
        select: { id: true },
      });
      await expect(
        db.$transaction((tx) =>
          setActivityStatus(tx, activity.id, "complete", { id: people.sales, canAssign: false }),
        ),
      ).rejects.toThrow("somebody else");

      const done = await db.$transaction((tx) =>
        setActivityStatus(tx, activity.id, "complete", { id: people.otherSales, canAssign: false }),
      );
      expect(done.changed).toBe(true);
      const row = await db.activity.findUniqueOrThrow({ where: { id: activity.id } });
      expect(row.status).toBe("DONE");
      expect(row.completedAt).not.toBeNull();

      // A second tick is a no-op, not a second completion time.
      const again = await db.$transaction((tx) =>
        setActivityStatus(tx, activity.id, "complete", { id: people.manager, canAssign: true }),
      );
      expect(again.changed).toBe(false);
    });
  });
});
