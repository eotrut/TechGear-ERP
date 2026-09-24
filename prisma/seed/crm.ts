import type { ActivityType, LeadStage, Prisma, TicketPriority, TicketStatus } from "@prisma/client";

import { STAGE_PROBABILITY_BPS } from "../../src/features/leads/services/pipeline";
import { addBusinessHours, SLA_HOURS } from "../../src/features/tickets/services/sla";
import { manilaYear } from "../../src/lib/format";
import { formatReference } from "../../src/lib/numbering";
import { pesosToCentavos } from "../../src/lib/money";
import type { SeedContext } from "./lib/context";
import { addDays, chance, clampToNow, intBetween, phMobile, phPerson, pick } from "./lib/helpers";

/**
 * Leads, activities and support tickets.
 *
 * The CRM is judged on what a salesperson sees when they open it today, so the
 * seed is built backwards from "now": open leads were opened in the last few
 * weeks and close in the coming ones, open tasks are mostly ahead with a few
 * genuinely late, and open tickets sit at every point of their SLA clock.
 * Every timestamp falls inside Manila working hours, and nothing is in the
 * future except the things that are meant to be (due dates, close dates, SLA
 * targets).
 */

const HOUR_MS = 3_600_000;
const MANILA_OFFSET_MS = 8 * HOUR_MS;

/** A given Manila wall-clock time on the Manila day `day` falls on. */
function manilaAt(day: Date, hour: number, minute = 0): Date {
  const shifted = new Date(day.getTime() + MANILA_OFFSET_MS);
  shifted.setUTCHours(hour, minute, 0, 0);
  // Sundays are quiet; anything that lands on one moves to Monday.
  if (shifted.getUTCDay() === 0) shifted.setUTCDate(shifted.getUTCDate() + 1);
  return new Date(shifted.getTime() - MANILA_OFFSET_MS);
}

/** A business-hours instant `days` from now, at a plausible meeting time. */
function workday(ctx: SeedContext, days: number): Date {
  return manilaAt(
    addDays(ctx.now, days),
    pick([9, 10, 10, 11, 13, 14, 15, 16]),
    pick([0, 0, 15, 30, 45]),
  );
}

// ---------------------------------------------------------------- vocabulary

const LEAD_COMPANIES = [
  "Marikina Esports Hub",
  "Kalayaan BPO Partners",
  "Eastwood Coders Guild",
  "San Lazaro Medical Records",
  "Panay Aqua Farms Office",
  "Lakbay Travel Desk",
  "Ortigas Legal Associates",
  "Cebu Northgate Academy",
  "Davao Gulf Shipping",
  "Tagaytay Ridge Resorts",
  "Bulacan Printing Cooperative",
  "Iloilo Heritage Bank Branch Ops",
  "Laguna Tech Park Tenants Association",
  "Quezon City Film Collective",
  "Makati Clinic Partners",
];

const LEAD_TITLES = [
  "Office fitout, 24 workstations",
  "Esports cafe refresh, 40 seats",
  "BPO headset rollout, 120 agents",
  "School computer lab keyboards, 60 sets",
  "Streaming studio build, 3 rooms",
  "Reseller account application",
  "Corporate Christmas gift bundles",
  "Coworking space peripherals",
  "Esports team sponsorship kit",
  "Call centre mouse replacement",
  "Design studio ergonomic upgrade",
  "Retail kiosk barcode scanners",
  "Hybrid meeting room webcams",
  "Newsroom mechanical keyboards",
];

const LOST_REASONS = [
  "Went with a cheaper local supplier.",
  "Budget deferred to next fiscal year.",
  "Required 60 day terms we could not extend.",
  "No response after three follow ups.",
  "Chose a competitor with an existing contract.",
];

/** Open work is written as something to do; finished work as something done. */
const OPEN_SUBJECTS: Record<ActivityType, string[]> = {
  CALL: [
    "Call to follow up on the quotation",
    "Discovery call with their IT lead",
    "Chase the signed purchase order",
    "Check in after the trial units",
  ],
  EMAIL: [
    "Send the revised quotation",
    "Email the proforma invoice",
    "Send bulk pricing tiers",
    "Send the warranty terms and spec sheets",
  ],
  MEETING: [
    "Site visit to measure the workstations",
    "Demo the switch tester at their office",
    "Contract review with procurement",
    "Quarterly account review",
  ],
  TASK: [
    "Prepare the bulk quotation",
    "Reserve stock for the fitout",
    "Confirm lead time with the supplier",
    "Draft the delivery schedule",
  ],
};

const DONE_SUBJECTS: Record<ActivityType, string[]> = {
  CALL: [
    "Discovery call on fitout requirements",
    "Called to follow up on the quotation",
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
    "Prepared the bulk quotation",
    "Reserved demo units for the site visit",
    "Checked lead time with the supplier",
    "Drafted the delivery schedule",
  ],
};

const NOTES = [
  "Asked for 60 day terms. Told them 30 is our ceiling for a first order.",
  "Their IT lead prefers linear switches; quoted Gateron Yellow across the board.",
  "Procurement wants the BIR 2307 form with every invoice.",
  "Budget approved for Q4. Decision after their board meeting.",
  "Wants delivery before the office opens on a Monday.",
  "Comparing us with two Lazada sellers on price. Our edge is the warranty.",
  "Sent photos of the demo setup to the facilities manager.",
];

const WAREHOUSE_TASKS: { type: ActivityType; subject: string; days: number }[] = [
  { type: "TASK", subject: "Count the keycap shelf in Cebu before the transfer", days: 1 },
  { type: "TASK", subject: "Stage the pallet for the Batangas Data Works delivery", days: 0 },
  { type: "TASK", subject: "Inspect the returned headset for water damage", days: -2 },
  { type: "CALL", subject: "Call the courier about the missed Iloilo pickup", days: 3 },
];

const ADMIN_TASKS: { type: ActivityType; subject: string; days: number }[] = [
  { type: "TASK", subject: "Review the quarterly discount approvals", days: 4 },
  { type: "MEETING", subject: "Supplier review with the Shenzhen switch vendor", days: 8 },
];

type TicketTemplate = {
  subject: string;
  description: string;
  wantsOrder: boolean;
  wantsProduct: boolean;
  replies: string[];
  notes: string[];
};

const TICKETS: TicketTemplate[] = [
  {
    subject: "Keyboard not detected on Windows 11",
    description:
      "Customer says the board lights up but Windows does not register key presses. Tried two USB ports and a different cable. Bought it last week.",
    wantsOrder: true,
    wantsProduct: true,
    replies: [
      "Sorry about that. Could you try holding Fn and Esc for five seconds? That resets the board to its default mode.",
      "Thanks for trying that. We will send a replacement unit, and a courier will collect the faulty one.",
    ],
    notes: ["Same batch as two earlier complaints. Flagging for the supplier defect log."],
  },
  {
    subject: "Missing keycap puller in the box",
    description:
      "The keycap puller listed in the box contents was not included. Customer is fine otherwise.",
    wantsOrder: true,
    wantsProduct: true,
    replies: ["Apologies for the miss. A puller is on its way by LBC, no charge."],
    notes: [],
  },
  {
    subject: "Wireless dongle keeps disconnecting",
    description:
      "Mouse drops connection every few minutes when the dongle is on the back of the PC. Works fine wired.",
    wantsOrder: true,
    wantsProduct: true,
    replies: [
      "Could you move the dongle to a front port or use the extension adapter in the box? Metal PC cases often block the signal.",
    ],
    notes: ["Known issue with rear ports. If the extension does not fix it, treat as warranty."],
  },
  {
    subject: "Request for a sales invoice copy",
    description:
      "Accounts payable needs a copy of the sales invoice with our TIN for their BIR filing.",
    wantsOrder: true,
    wantsProduct: false,
    replies: ["Attached the invoice copy. Let us know if you also need the 2307 form."],
    notes: [],
  },
  {
    subject: "Order delivered to the wrong barangay",
    description:
      "Courier marked the parcel delivered but it went to a neighbouring barangay. Customer has the tracking screenshot.",
    wantsOrder: true,
    wantsProduct: false,
    replies: [
      "We have raised this with the courier and asked for the proof of delivery photo.",
      "The courier has recovered the parcel and will redeliver tomorrow morning.",
    ],
    notes: ["Courier ticket reference CX-448120. Follow up if no update by 3pm."],
  },
  {
    subject: "Switches feel inconsistent across the board",
    description:
      "A few keys feel heavier than the rest. Customer suspects mixed switch weights from the factory.",
    wantsOrder: true,
    wantsProduct: true,
    replies: [
      "Could you send a short video pressing the affected keys? We will compare against a unit here.",
    ],
    notes: ["Checked a sealed unit from the same lot. Two stiff switches out of 87."],
  },
  {
    subject: "Cannot redeem the 11.11 promo code",
    description: "Checkout rejects the code even though the cart is above the minimum spend.",
    wantsOrder: false,
    wantsProduct: false,
    replies: [
      "The code excluded bundles. We have applied the discount manually as a goodwill gesture.",
    ],
    notes: [],
  },
  {
    subject: "Asking for bulk pricing on 30 units",
    description: "Office manager wants a quote for 30 mouse and keyboard sets for a new floor.",
    wantsOrder: false,
    wantsProduct: true,
    replies: ["Thank you. Passing this to our B2B team, who will send tiered pricing today."],
    notes: ["Should be a lead rather than a ticket. Logged it on the pipeline."],
  },
  {
    subject: "Firmware update bricked the board",
    description:
      "Board stopped responding after the firmware update tool crashed halfway. No lights, not detected.",
    wantsOrder: true,
    wantsProduct: true,
    replies: [
      "That can usually be recovered. Hold the reset button on the underside while plugging in, then run the updater again.",
    ],
    notes: ["If recovery fails this is a straight swap. Stock is available in Manila."],
  },
  {
    subject: "Refund has not reflected on GCash",
    description:
      "Refund was approved five days ago but has not arrived in the customer's GCash wallet.",
    wantsOrder: true,
    wantsProduct: false,
    replies: [
      "We have checked with finance. The refund was sent yesterday and should reflect within 24 hours.",
    ],
    notes: ["GCash reference 4011 2298 7713."],
  },
  {
    subject: "Wrong colourway shipped",
    description: "Ordered the white colourway, received black. Box is unopened.",
    wantsOrder: true,
    wantsProduct: true,
    replies: [
      "Sorry for the mix-up. We will swap it for the white one; the courier will bring it and take the black back.",
    ],
    notes: [],
  },
  {
    subject: "Need a replacement USB-C cable",
    description: "The braided cable frayed at the connector after three months of normal use.",
    wantsOrder: true,
    wantsProduct: true,
    replies: ["Cables are covered for a year. A new one ships today."],
    notes: [],
  },
];

type TicketPlan = {
  status: TicketStatus;
  priority: TicketPriority;
  /** Open tickets: business hours since they were raised, which sets where they sit on the SLA clock. */
  hoursAgo?: number;
  /** Finished tickets: days ago, and whether they were resolved inside the SLA. */
  daysAgo?: number;
  metSla?: boolean;
};

const TICKET_PLAN: TicketPlan[] = [
  { status: "OPEN", priority: "URGENT", hoursAgo: 1 },
  { status: "OPEN", priority: "HIGH", hoursAgo: 6 },
  { status: "OPEN", priority: "MEDIUM", hoursAgo: 3 },
  { status: "OPEN", priority: "LOW", hoursAgo: 20 },
  { status: "IN_PROGRESS", priority: "URGENT", hoursAgo: 7 },
  { status: "IN_PROGRESS", priority: "HIGH", hoursAgo: 4 },
  { status: "IN_PROGRESS", priority: "MEDIUM", hoursAgo: 30 },
  { status: "IN_PROGRESS", priority: "LOW", hoursAgo: 40 },
  { status: "WAITING_CUSTOMER", priority: "MEDIUM", hoursAgo: 14 },
  { status: "WAITING_CUSTOMER", priority: "LOW", hoursAgo: 50 },
  { status: "RESOLVED", priority: "HIGH", daysAgo: 2, metSla: true },
  { status: "RESOLVED", priority: "MEDIUM", daysAgo: 4, metSla: true },
  { status: "RESOLVED", priority: "URGENT", daysAgo: 5, metSla: false },
  { status: "CLOSED", priority: "MEDIUM", daysAgo: 12, metSla: true },
  { status: "CLOSED", priority: "LOW", daysAgo: 25, metSla: true },
  { status: "CLOSED", priority: "HIGH", daysAgo: 38, metSla: false },
  { status: "CLOSED", priority: "MEDIUM", daysAgo: 60, metSla: true },
  { status: "CLOSED", priority: "URGENT", daysAgo: 95, metSla: true },
  { status: "CLOSED", priority: "LOW", daysAgo: 130, metSla: true },
  { status: "CLOSED", priority: "MEDIUM", daysAgo: 170, metSla: false },
];

/** Walk back `hours` of Manila business time from now. */
function businessHoursAgo(now: Date, hours: number): Date {
  // Step back in quarter hours; cheap, exact enough, and cannot overshoot.
  let cursor = now.getTime();
  let remaining = hours * 4;
  while (remaining > 0) {
    cursor -= HOUR_MS / 4;
    const manila = new Date(cursor + MANILA_OFFSET_MS);
    const hour = manila.getUTCHours();
    if (manila.getUTCDay() !== 0 && hour >= 9 && hour < 18) remaining -= 1;
  }
  return new Date(cursor);
}

// ------------------------------------------------------------------ builder

export function buildCrm(ctx: SeedContext): void {
  const { tables } = ctx;
  const owners = [ctx.users.sales.id, ctx.users.manager.id, ctx.users.sales.id];
  let activityCounter = 0;

  const pushActivity = (activity: Omit<Prisma.ActivityCreateManyInput, "id">): void => {
    activityCounter += 1;
    tables.activities.push({ id: `act_${String(activityCounter).padStart(6, "0")}`, ...activity });
  };

  const doneActivity = (
    ownerId: string,
    at: Date,
    links: { customerId?: string | null; leadId?: string | null; ticketId?: string | null },
  ): void => {
    const type = pick(["CALL", "EMAIL", "EMAIL", "MEETING", "TASK"] as const);
    const when = clampToNow(at, ctx.now);
    pushActivity({
      type,
      status: "DONE",
      subject: pick(DONE_SUBJECTS[type]),
      note: chance(0.4) ? pick(NOTES) : null,
      dueAt: when,
      completedAt: when,
      ownerId,
      customerId: links.customerId ?? null,
      leadId: links.leadId ?? null,
      ticketId: links.ticketId ?? null,
      createdAt: addDays(when, -intBetween(0, 3)),
      updatedAt: when,
    });
  };

  const openActivity = (
    ownerId: string,
    dueAt: Date,
    links: { customerId?: string | null; leadId?: string | null; ticketId?: string | null },
    subject?: { type: ActivityType; subject: string },
  ): void => {
    const type = subject?.type ?? pick(["CALL", "EMAIL", "MEETING", "TASK"] as const);
    const createdAt = clampToNow(addDays(dueAt, -intBetween(2, 9)), ctx.now);
    pushActivity({
      type,
      status: "OPEN",
      subject: subject?.subject ?? pick(OPEN_SUBJECTS[type]),
      note: null,
      dueAt,
      completedAt: null,
      ownerId,
      customerId: links.customerId ?? null,
      leadId: links.leadId ?? null,
      ticketId: links.ticketId ?? null,
      createdAt,
      updatedAt: createdAt,
    });
  };

  // ---------------------------------------------------------------- leads
  const stagePlan: LeadStage[] = [
    ...Array<LeadStage>(6).fill("NEW"),
    ...Array<LeadStage>(6).fill("CONTACTED"),
    ...Array<LeadStage>(5).fill("QUOTED"),
    ...Array<LeadStage>(4).fill("NEGOTIATION"),
    ...Array<LeadStage>(5).fill("WON"),
    ...Array<LeadStage>(4).fill("LOST"),
  ];
  // How long a lead has typically been in the pipeline by the stage it has reached.
  const AGE_DAYS: Record<LeadStage, [number, number]> = {
    NEW: [4, 12],
    CONTACTED: [6, 28],
    QUOTED: [12, 40],
    NEGOTIATION: [20, 60],
    WON: [45, 300],
    LOST: [30, 260],
  };
  const PROBABILITY_JITTER: Record<LeadStage, [number, number]> = {
    NEW: [-500, 500],
    CONTACTED: [-1000, 1000],
    QUOTED: [-1500, 1000],
    NEGOTIATION: [-1500, 1000],
    WON: [0, 0],
    LOST: [0, 0],
  };

  const businessCustomers = ctx.customers.filter((customer) => customer.isBusiness);
  const positionInStage = new Map<LeadStage, number>();
  let companyCursor = 0;

  stagePlan.forEach((stage, index) => {
    const leadId = `led_${String(index + 1).padStart(6, "0")}`;
    const contact = phPerson();
    const [minAge, maxAge] = AGE_DAYS[stage];
    const createdAt = workday(ctx, -intBetween(minAge, maxAge));
    const ownerId = owners[index % owners.length] ?? ctx.users.sales.id;
    const isWon = stage === "WON";
    const isLost = stage === "LOST";
    const isOpen = !isWon && !isLost;

    // Every won deal became a customer; some open ones are existing accounts.
    const linkedCustomer = isWon || chance(0.3) ? pick(businessCustomers) : null;
    const company =
      linkedCustomer?.displayName ?? LEAD_COMPANIES[companyCursor++ % LEAD_COMPANIES.length];

    const wonAt = isWon ? clampToNow(workday(ctx, -intBetween(4, minAge - 5)), ctx.now) : null;
    const lostAt = isLost ? clampToNow(addDays(createdAt, intBetween(10, 25)), ctx.now) : null;
    // Most open deals close in the coming weeks; a few have slipped.
    const expectedCloseDate = isOpen
      ? manilaAt(addDays(ctx.now, chance(0.2) ? -intBetween(2, 12) : intBetween(6, 55)), 12)
      : manilaAt(wonAt ?? lostAt ?? createdAt, 12);

    const position = (positionInStage.get(stage) ?? 0) + 1000;
    positionInStage.set(stage, position);
    const [low, high] = PROBABILITY_JITTER[stage];

    tables.leads.push({
      id: leadId,
      code: `LEAD-${String(index + 1).padStart(4, "0")}`,
      title: LEAD_TITLES[(index * 5) % LEAD_TITLES.length] ?? "Office fitout",
      contactName: contact.fullName,
      email: `${contact.firstName.toLowerCase()}.${contact.lastName.toLowerCase().replace(/\s/g, "")}@${pick(["corp.example.ph", "office.example.ph", "group.example.ph"])}`,
      phone: phMobile(),
      company,
      stage,
      // Evenly spaced within each column, so drops land between neighbours (D-11).
      position,
      valueCentavos: pesosToCentavos(intBetween(18, 420) * 1000),
      probabilityBps: STAGE_PROBABILITY_BPS[stage] + intBetween(low, high),
      source: pick(["DIRECT", "FACEBOOK", "B2B", "DIRECT", "SHOPEE"] as const),
      ownerId,
      customerId: linkedCustomer?.id ?? null,
      expectedCloseDate,
      wonAt,
      lostAt,
      lostReason: isLost ? pick(LOST_REASONS) : null,
      createdAt,
      updatedAt: wonAt ?? lostAt ?? clampToNow(addDays(createdAt, intBetween(1, minAge)), ctx.now),
    });

    // The paper trail: finished work across the lead's life so far...
    const end = wonAt ?? lostAt ?? ctx.now;
    const history = stage === "NEW" ? intBetween(0, 1) : intBetween(1, 3);
    const span = Math.max(1, Math.round((end.getTime() - createdAt.getTime()) / 86_400_000));
    for (let step = 1; step <= history; step += 1) {
      const at = manilaAt(
        new Date(createdAt.getTime() + Math.round((span * step) / (history + 1)) * 86_400_000),
        pick([9, 10, 11, 14, 15, 16]),
        pick([0, 15, 30, 45]),
      );
      doneActivity(ownerId, at, { leadId, customerId: linkedCustomer?.id });
    }
    // ...and, for open deals, the next step. A few have slipped past due.
    if (isOpen) {
      const late = index % 6 === 3;
      openActivity(ownerId, workday(ctx, late ? -intBetween(1, 3) : intBetween(0, 10)), {
        leadId,
        customerId: linkedCustomer?.id,
      });
    }
  });

  // ----------------------------------------------- account management work
  for (let i = 0; i < 36; i += 1) {
    const customer = pick(ctx.customers);
    const ownerId = pick(owners);
    if (i % 3 === 0) {
      openActivity(ownerId, workday(ctx, i % 12 === 0 ? -intBetween(1, 3) : intBetween(0, 18)), {
        customerId: customer.id,
      });
    } else {
      doneActivity(ownerId, workday(ctx, -intBetween(1, 30)), { customerId: customer.id });
    }
  }

  for (const task of WAREHOUSE_TASKS) {
    openActivity(ctx.users.warehouse.id, workday(ctx, task.days), {}, task);
  }
  doneActivity(ctx.users.warehouse.id, workday(ctx, -2), {});
  for (const task of ADMIN_TASKS)
    openActivity(ctx.users.admin.id, workday(ctx, task.days), {}, task);

  // -------------------------------------------------------------- tickets
  const ordersWithCustomers = tables.orders.filter(
    (order) =>
      order.customerId && ["DELIVERED", "COMPLETED", "SHIPPED"].includes(String(order.status)),
  );
  const itemsByOrder = new Map<string, string[]>();
  for (const item of tables.orderItems) {
    const list = itemsByOrder.get(String(item.orderId)) ?? [];
    list.push(String(item.variantId));
    itemsByOrder.set(String(item.orderId), list);
  }
  const staff = [ctx.users.sales.id, ctx.users.manager.id];

  type Draft = {
    plan: TicketPlan;
    template: TicketTemplate;
    createdAt: Date;
    customerId: string;
    orderId: string | null;
    variantId: string | null;
    assigneeId: string | null;
  };

  const drafts: Draft[] = TICKET_PLAN.map((plan, index) => {
    const template = TICKETS[index % TICKETS.length] as TicketTemplate;
    const createdAt =
      plan.hoursAgo !== undefined
        ? businessHoursAgo(ctx.now, plan.hoursAgo)
        : workday(ctx, -(plan.daysAgo ?? 30));

    // Orders placed before the ticket, so the complaint follows the purchase.
    const candidates = ordersWithCustomers.filter(
      (order) => (order.placedAt as Date) < addDays(createdAt, -2),
    );
    const order =
      template.wantsOrder && candidates.length > 0 ? pick(candidates.slice(-120)) : null;
    const variants = order ? (itemsByOrder.get(String(order.id)) ?? []) : [];
    const variantId = template.wantsProduct
      ? variants.length > 0
        ? pick(variants)
        : pick(ctx.variants).id
      : null;

    return {
      plan,
      template,
      createdAt,
      customerId: order ? String(order.customerId) : pick(ctx.customers).id,
      orderId: order ? String(order.id) : null,
      variantId,
      assigneeId: plan.status === "OPEN" && index % 2 === 0 ? null : (staff[index % 2] ?? null),
    };
  });

  // Numbered in the order they were raised, as the live counter would.
  drafts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const perYear = new Map<number, number>();
  let commentCounter = 0;

  drafts.forEach((draft, index) => {
    const { plan, template, createdAt } = draft;
    const ticketId = `tkt_${String(index + 1).padStart(6, "0")}`;
    const year = manilaYear(createdAt);
    const sequence = (perYear.get(year) ?? 0) + 1;
    perYear.set(year, sequence);

    const slaDueAt = addBusinessHours(createdAt, SLA_HOURS[plan.priority]);
    const finished = plan.status === "RESOLVED" || plan.status === "CLOSED";
    const resolvedAt = finished
      ? clampToNow(
          plan.metSla
            ? addBusinessHours(createdAt, SLA_HOURS[plan.priority] * (0.3 + (index % 5) * 0.12))
            : addBusinessHours(slaDueAt, intBetween(2, 20)),
          ctx.now,
        )
      : null;
    const closedAt =
      plan.status === "CLOSED" && resolvedAt
        ? clampToNow(addBusinessHours(resolvedAt, intBetween(4, 30)), ctx.now)
        : null;

    // The thread, strictly between opening and resolution (or now).
    const threadEnd = (resolvedAt ?? ctx.now).getTime();
    const thread: { body: string; internal: boolean }[] =
      plan.status === "OPEN"
        ? template.notes.slice(0, index % 2).map((body) => ({ body, internal: true }))
        : [
            ...template.replies.map((body) => ({ body, internal: false })),
            ...template.notes.map((body) => ({ body, internal: true })),
          ];
    let firstResponseAt: Date | null = null;
    let lastActivityAt = createdAt;
    for (const [position, entry] of thread.entries()) {
      commentCounter += 1;
      const at = new Date(
        createdAt.getTime() +
          Math.round(((threadEnd - createdAt.getTime()) * (position + 1)) / (thread.length + 1)),
      );
      // The first reply the customer can see is the first response.
      if (!entry.internal && firstResponseAt === null) firstResponseAt = at;
      lastActivityAt = at;
      tables.ticketComments.push({
        id: `tcm_${String(commentCounter).padStart(6, "0")}`,
        ticketId,
        authorId: draft.assigneeId ?? ctx.users.manager.id,
        body: entry.body,
        isInternal: entry.internal,
        createdAt: at,
      });
    }

    tables.tickets.push({
      id: ticketId,
      ticketNumber: formatReference("TKT", year, sequence),
      subject: template.subject,
      description: template.description,
      status: plan.status,
      priority: plan.priority,
      customerId: draft.customerId,
      assigneeId: draft.assigneeId,
      orderId: draft.orderId,
      variantId: draft.variantId,
      slaDueAt,
      firstResponseAt,
      resolvedAt,
      closedAt,
      createdAt,
      updatedAt: closedAt ?? resolvedAt ?? lastActivityAt,
    });

    // Tickets being worked have a next step on somebody's list.
    if (plan.status === "IN_PROGRESS" && draft.assigneeId) {
      openActivity(
        draft.assigneeId,
        workday(ctx, intBetween(0, 3)),
        { ticketId, customerId: draft.customerId },
        { type: "TASK", subject: "Follow up on the replacement unit" },
      );
    }
  });
}
