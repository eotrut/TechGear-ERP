import { faker } from "@faker-js/faker";
import type { LeadStage, TicketPriority, TicketStatus } from "@prisma/client";

import { pesosToCentavos } from "../../src/lib/money";
import type { SeedContext } from "./lib/context";
import {
  addDays,
  addHours,
  atBusinessHour,
  chance,
  intBetween,
  phMobile,
  phPerson,
  pick,
} from "./lib/helpers";

/** Leads, activities and support tickets. */

const LEAD_TITLES = [
  "Office fitout, 24 workstations",
  "Gaming cafe refresh, 40 seats",
  "BPO headset rollout",
  "School computer lab keyboards",
  "Streaming studio build",
  "Reseller account application",
  "Corporate gift bundles",
  "Coworking space peripherals",
  "Esports team sponsorship kit",
  "Call centre mouse replacement",
  "Design studio ergonomic upgrade",
  "Retail kiosk hardware",
];

const LOST_REASONS = [
  "Went with a cheaper local supplier.",
  "Budget deferred to next fiscal year.",
  "Required 60 day terms we could not extend.",
  "No response after three follow ups.",
  "Chose a competitor with an existing contract.",
];

const TICKET_SUBJECTS = [
  "Keyboard not detected on Windows 11",
  "Missing keycap puller in the box",
  "Wireless dongle keeps disconnecting",
  "Request for a sales invoice copy",
  "Order delivered to the wrong barangay",
  "Switches feel inconsistent across the board",
  "Cannot redeem the 11.11 promo code",
  "Asking for bulk pricing on 30 units",
  "Firmware update bricked the board",
  "Refund has not reflected on GCash",
  "Wrong colourway shipped",
  "Need a replacement USB-C cable",
];

const ACTIVITY_SUBJECTS: Record<string, string[]> = {
  CALL: [
    "Discovery call on fitout requirements",
    "Follow up on the pending quotation",
    "Courtesy call after delivery",
    "Chased the outstanding balance",
  ],
  EMAIL: [
    "Sent the revised quotation",
    "Shared the spec sheet and warranty terms",
    "Emailed the proforma invoice",
    "Sent bulk pricing tiers",
  ],
  MEETING: [
    "Site visit to measure the workstations",
    "Product demo at the client office",
    "Contract review with procurement",
    "Quarterly account review",
  ],
  TASK: [
    "Prepare the bulk quotation",
    "Reserve stock for the fitout",
    "Draft the delivery schedule",
    "Confirm lead time with the supplier",
  ],
};

export function buildCrm(ctx: SeedContext): void {
  const { tables } = ctx;
  const year = ctx.now.getUTCFullYear();

  // ---------------------------------------------------------------- leads
  const stagePlan: LeadStage[] = [
    ...Array<LeadStage>(6).fill("NEW"),
    ...Array<LeadStage>(6).fill("CONTACTED"),
    ...Array<LeadStage>(5).fill("QUOTED"),
    ...Array<LeadStage>(4).fill("NEGOTIATION"),
    ...Array<LeadStage>(5).fill("WON"),
    ...Array<LeadStage>(4).fill("LOST"),
  ];

  const owners = [ctx.users.sales.id, ctx.users.manager.id, ctx.users.sales.id];
  let activityCounter = 0;

  stagePlan.forEach((stage, index) => {
    const leadId = `led_${String(index + 1).padStart(6, "0")}`;
    const contact = phPerson();
    const createdAt = addDays(ctx.now, -intBetween(3, 260));
    const ownerId = owners[index % owners.length] ?? ctx.users.sales.id;

    // Business customers make believable lead sources.
    const linkedCustomer = chance(0.45) ? pick(ctx.customers.filter((c) => c.isBusiness)) : null;

    const isWon = stage === "WON";
    const isLost = stage === "LOST";

    tables.leads.push({
      id: leadId,
      code: `LEAD-${String(index + 1).padStart(4, "0")}`,
      title: pick(LEAD_TITLES),
      contactName: contact.fullName,
      email: `${contact.firstName.toLowerCase()}.${contact.lastName.toLowerCase().replace(/\s/g, "")}@${pick(["corp.example.ph", "office.example.ph", "group.example.ph"])}`,
      phone: phMobile(),
      company: linkedCustomer?.displayName ?? `${contact.lastName} Enterprises`,
      stage,
      // Fractional positions leave room to drop a card between two others
      // without rewriting the column (decision D-11).
      position: (index % 6) * 1000 + 1000,
      valueCentavos: pesosToCentavos(intBetween(18, 420) * 1000),
      probabilityBps: isWon ? 10000 : isLost ? 0 : intBetween(1000, 8500),
      source: pick(["DIRECT", "FACEBOOK", "B2B", "DIRECT", "SHOPEE"] as const),
      ownerId,
      customerId: linkedCustomer?.id ?? null,
      expectedCloseDate: addDays(createdAt, intBetween(14, 90)),
      wonAt: isWon ? addDays(createdAt, intBetween(10, 70)) : null,
      lostAt: isLost ? addDays(createdAt, intBetween(8, 60)) : null,
      lostReason: isLost ? pick(LOST_REASONS) : null,
      createdAt,
      updatedAt: addDays(createdAt, intBetween(1, 30)),
    });

    // One or two activities per lead, so the pipeline has a paper trail.
    const activityCount = stage === "NEW" ? 1 : intBetween(1, 3);
    for (let a = 0; a < activityCount; a += 1) {
      activityCounter += 1;
      const type = pick(["CALL", "EMAIL", "MEETING", "TASK"] as const);
      const dueAt = addDays(createdAt, intBetween(1, 45));
      const isDone = dueAt < ctx.now && chance(0.75);

      tables.activities.push({
        id: `act_${String(activityCounter).padStart(6, "0")}`,
        type,
        status: isDone ? "DONE" : "OPEN",
        subject: pick(ACTIVITY_SUBJECTS[type] ?? ["Follow up"]),
        note: null,
        dueAt,
        completedAt: isDone ? addHours(dueAt, intBetween(-20, 20)) : null,
        ownerId,
        customerId: linkedCustomer?.id ?? null,
        leadId,
        ticketId: null,
        orderId: null,
        createdAt,
        updatedAt: createdAt,
      });
    }
  });

  // Standalone customer activities, including a few overdue ones so the
  // "my tasks" view and the overdue notification have something real to show.
  for (let i = 0; i < 40; i += 1) {
    activityCounter += 1;
    const customer = pick(ctx.customers);
    const type = pick(["CALL", "EMAIL", "TASK", "MEETING"] as const);
    const overdue = i % 7 === 0;
    const dueAt = overdue
      ? addDays(ctx.now, -intBetween(1, 12))
      : addDays(ctx.now, intBetween(-4, 21));
    const isDone = !overdue && dueAt < ctx.now;

    tables.activities.push({
      id: `act_${String(activityCounter).padStart(6, "0")}`,
      type,
      status: isDone ? "DONE" : "OPEN",
      subject: pick(ACTIVITY_SUBJECTS[type] ?? ["Follow up"]),
      note: null,
      dueAt,
      completedAt: isDone ? dueAt : null,
      ownerId: pick(owners),
      customerId: customer.id,
      leadId: null,
      ticketId: null,
      orderId: null,
      createdAt: addDays(dueAt, -intBetween(1, 10)),
      updatedAt: addDays(dueAt, -intBetween(0, 5)),
    });
  }

  // -------------------------------------------------------------- tickets
  const SLA_HOURS: Record<TicketPriority, number> = { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

  const ticketPlan: { status: TicketStatus; priority: TicketPriority }[] = [
    { status: "OPEN", priority: "URGENT" },
    { status: "OPEN", priority: "HIGH" },
    { status: "OPEN", priority: "MEDIUM" },
    { status: "IN_PROGRESS", priority: "HIGH" },
    { status: "IN_PROGRESS", priority: "MEDIUM" },
    { status: "IN_PROGRESS", priority: "URGENT" },
    { status: "WAITING_CUSTOMER", priority: "MEDIUM" },
    { status: "WAITING_CUSTOMER", priority: "LOW" },
    { status: "RESOLVED", priority: "HIGH" },
    { status: "RESOLVED", priority: "MEDIUM" },
    { status: "RESOLVED", priority: "LOW" },
    { status: "CLOSED", priority: "MEDIUM" },
    { status: "CLOSED", priority: "LOW" },
    { status: "CLOSED", priority: "HIGH" },
    { status: "CLOSED", priority: "MEDIUM" },
    { status: "OPEN", priority: "LOW" },
    { status: "IN_PROGRESS", priority: "LOW" },
    { status: "CLOSED", priority: "URGENT" },
    { status: "RESOLVED", priority: "URGENT" },
    { status: "CLOSED", priority: "MEDIUM" },
  ];

  const ordersWithCustomers = tables.orders.filter((order) => order.customerId);
  let commentCounter = 0;

  ticketPlan.forEach((plan, index) => {
    const ticketId = `tkt_${String(index + 1).padStart(6, "0")}`;
    const linkedOrder = chance(0.6) ? pick(ordersWithCustomers) : null;
    const customerId = linkedOrder?.customerId ?? pick(ctx.customers).id;

    const isOpenish =
      plan.status === "OPEN" || plan.status === "IN_PROGRESS" || plan.status === "WAITING_CUSTOMER";
    const createdAt = isOpenish
      ? addDays(ctx.now, -intBetween(0, 9))
      : addDays(ctx.now, -intBetween(10, 180));

    const resolvedAt =
      plan.status === "RESOLVED" || plan.status === "CLOSED"
        ? addHours(createdAt, intBetween(4, 96))
        : null;

    tables.tickets.push({
      id: ticketId,
      ticketNumber: `TKT-${year}-${String(index + 1).padStart(4, "0")}`,
      subject: TICKET_SUBJECTS[index % TICKET_SUBJECTS.length] ?? "Support request",
      description:
        "Customer reached out through the support inbox. Details captured from the first message and the order history.",
      status: plan.status,
      priority: plan.priority,
      customerId: String(customerId),
      assigneeId:
        plan.status === "OPEN" && chance(0.4)
          ? null
          : pick([ctx.users.sales.id, ctx.users.manager.id]),
      orderId: linkedOrder ? String(linkedOrder.id) : null,
      variantId: chance(0.5) ? pick(ctx.variants).id : null,
      slaDueAt: addHours(createdAt, SLA_HOURS[plan.priority]),
      firstResponseAt: plan.status === "OPEN" ? null : addHours(createdAt, intBetween(1, 6)),
      resolvedAt,
      closedAt:
        plan.status === "CLOSED" ? addHours(resolvedAt ?? createdAt, intBetween(1, 48)) : null,
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
    });

    // A short thread on each ticket, with the occasional internal note.
    const commentCount = plan.status === "OPEN" ? intBetween(0, 1) : intBetween(1, 4);
    for (let c = 0; c < commentCount; c += 1) {
      commentCounter += 1;
      const isInternal = chance(0.3);
      tables.ticketComments.push({
        id: `tcm_${String(commentCounter).padStart(6, "0")}`,
        ticketId,
        authorId: pick([ctx.users.sales.id, ctx.users.manager.id]),
        body: isInternal
          ? pick([
              "Checked the ledger, the unit shipped from Cebu on the second attempt.",
              "Stock is available for a straight swap, no need to escalate.",
              "Customer has two open orders, worth handling together.",
              "Flagging for the warranty queue, past the 7 day return window.",
            ])
          : pick([
              "Thanks for reaching out. We have pulled up your order and are checking with the warehouse.",
              "A replacement is on the way and should arrive within three working days.",
              "Could you confirm the serial number printed underneath the unit?",
              "We have issued the refund. GCash usually reflects within 24 hours.",
            ]),
        isInternal,
        createdAt: addHours(createdAt, (c + 1) * intBetween(2, 10)),
      });
    }
  });

  // Link a few activities to tickets so the timeline crosses modules.
  const openTickets = tables.tickets.filter((ticket) => ticket.status === "IN_PROGRESS");
  for (const ticket of openTickets.slice(0, 5)) {
    activityCounter += 1;
    tables.activities.push({
      id: `act_${String(activityCounter).padStart(6, "0")}`,
      type: "TASK",
      status: "OPEN",
      subject: "Follow up on the replacement unit",
      note: null,
      dueAt: addDays(ctx.now, intBetween(1, 4)),
      completedAt: null,
      ownerId: String(ticket.assigneeId ?? ctx.users.sales.id),
      customerId: String(ticket.customerId),
      leadId: null,
      ticketId: String(ticket.id),
      orderId: null,
      createdAt: atBusinessHour(addDays(ctx.now, -1)),
      updatedAt: atBusinessHour(addDays(ctx.now, -1)),
    });
  }

  void faker;
}
