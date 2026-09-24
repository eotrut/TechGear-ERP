import type { LeadStage, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { toManilaDateTimeInput } from "@/lib/format";
import { toPesoInput } from "@/lib/money";
import { can } from "@/lib/rbac/can";

import type { LeadBoardFilters, LeadFormValues } from "../schemas";
import { LEAD_STAGES, OPEN_STAGES, weightedValue } from "../services/pipeline";

/**
 * Lead reads. The board is one query ordered by stage and position, grouped in
 * memory: a pipeline is tens of cards, not thousands, and one round trip beats
 * six. Closed columns show the most recent cards only, because a year of won
 * deals is a report, not a column.
 */

const CLOSED_COLUMN_LIMIT = 20;

const cardSelect = {
  id: true,
  code: true,
  title: true,
  company: true,
  contactName: true,
  email: true,
  phone: true,
  stage: true,
  position: true,
  valueCentavos: true,
  probabilityBps: true,
  expectedCloseDate: true,
  ownerId: true,
  customerId: true,
  wonAt: true,
  lostAt: true,
  lostReason: true,
  updatedAt: true,
  owner: { select: { name: true } },
  customer: { select: { displayName: true } },
  _count: { select: { activities: { where: { status: "OPEN" } } } },
} satisfies Prisma.LeadSelect;

export type LeadCard = {
  id: string;
  code: string;
  title: string;
  company: string | null;
  contactName: string;
  email: string | null;
  phone: string | null;
  stage: LeadStage;
  valueCentavos: number;
  probabilityBps: number;
  expectedCloseDate: string | null;
  ownerId: string;
  ownerName: string;
  customerId: string | null;
  customerName: string | null;
  openActivities: number;
  closedAt: string | null;
  lostReason: string | null;
};

function whereFor(filters: LeadBoardFilters, userId: string): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};
  if (filters.owner === "mine") where.ownerId = userId;
  else if (filters.owner) where.ownerId = filters.owner;
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { company: { contains: term, mode: "insensitive" } },
      { contactName: { contains: term, mode: "insensitive" } },
      { code: { equals: term.toUpperCase() } },
    ];
  }
  return where;
}

export async function getLeadBoard(filters: LeadBoardFilters, userId: string) {
  const where = whereFor(filters, userId);
  const since = new Date(Date.now() - 90 * 86_400_000);
  const winRateSince = new Date(Date.now() - 180 * 86_400_000);

  const [open, won, lost, closedCounts, wonRecent, closedForRate] = await Promise.all([
    db.lead.findMany({
      where: { ...where, stage: { in: [...OPEN_STAGES] } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: cardSelect,
    }),
    db.lead.findMany({
      where: { ...where, stage: "WON" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: CLOSED_COLUMN_LIMIT,
      select: cardSelect,
    }),
    db.lead.findMany({
      where: { ...where, stage: "LOST" },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      take: CLOSED_COLUMN_LIMIT,
      select: cardSelect,
    }),
    db.lead.groupBy({
      by: ["stage"],
      where: { ...where, stage: { in: ["WON", "LOST"] } },
      _count: { _all: true },
      _sum: { valueCentavos: true },
    }),
    db.lead.aggregate({
      where: { ...where, stage: "WON", wonAt: { gte: since } },
      _count: { _all: true },
      _sum: { valueCentavos: true },
    }),
    db.lead.groupBy({
      by: ["stage"],
      where: {
        ...where,
        OR: [
          { stage: "WON", wonAt: { gte: winRateSince } },
          { stage: "LOST", lostAt: { gte: winRateSince } },
        ],
      },
      _count: { _all: true },
    }),
  ]);

  const toCard = (lead: Prisma.LeadGetPayload<{ select: typeof cardSelect }>): LeadCard => ({
    id: lead.id,
    code: lead.code,
    title: lead.title,
    company: lead.company,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    stage: lead.stage,
    valueCentavos: lead.valueCentavos,
    probabilityBps: lead.probabilityBps,
    expectedCloseDate: lead.expectedCloseDate?.toISOString() ?? null,
    ownerId: lead.ownerId,
    ownerName: lead.owner.name,
    customerId: lead.customerId,
    customerName: lead.customer?.displayName ?? null,
    openActivities: lead._count.activities,
    closedAt: (lead.wonAt ?? lead.lostAt)?.toISOString() ?? null,
    lostReason: lead.lostReason,
  });

  const columns = Object.fromEntries(
    LEAD_STAGES.map((stage) => [stage, [] as LeadCard[]]),
  ) as Record<LeadStage, LeadCard[]>;
  for (const lead of [...open, ...won, ...lost]) columns[lead.stage].push(toCard(lead));

  const totals = Object.fromEntries(
    LEAD_STAGES.map((stage) => {
      const closed = closedCounts.find((row) => row.stage === stage);
      const cards = columns[stage];
      return [
        stage,
        closed
          ? { count: closed._count._all, valueCentavos: closed._sum.valueCentavos ?? 0 }
          : {
              count: cards.length,
              valueCentavos: cards.reduce((sum, card) => sum + card.valueCentavos, 0),
            },
      ];
    }),
  ) as Record<LeadStage, { count: number; valueCentavos: number }>;

  const openCards = OPEN_STAGES.flatMap((stage) => columns[stage]);
  const wonCount = closedForRate.find((row) => row.stage === "WON")?._count._all ?? 0;
  const lostCount = closedForRate.find((row) => row.stage === "LOST")?._count._all ?? 0;

  return {
    columns,
    totals,
    stats: {
      openCount: openCards.length,
      openValueCentavos: openCards.reduce((sum, card) => sum + card.valueCentavos, 0),
      weightedCentavos: openCards.reduce(
        (sum, card) => sum + weightedValue(card.valueCentavos, card.probabilityBps),
        0,
      ),
      wonRecentCount: wonRecent._count._all,
      wonRecentCentavos: wonRecent._sum.valueCentavos ?? 0,
      winRateBps:
        wonCount + lostCount === 0
          ? null
          : Math.round((wonCount * 10_000) / (wonCount + lostCount)),
      overdueCount: openCards.filter(
        (card) => card.expectedCloseDate && new Date(card.expectedCloseDate).getTime() < Date.now(),
      ).length,
    },
  };
}

export type LeadBoard = Awaited<ReturnType<typeof getLeadBoard>>;

/** People who can own a lead: active, and holding the pipeline permission. */
export async function leadOwners() {
  const users = await db.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
  return users
    .filter((user) => can(user.role, "leads.view"))
    .map((user) => ({ id: user.id, name: user.name }));
}

// ------------------------------------------------------------------- detail

export async function getLead(leadId: string) {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      code: true,
      title: true,
      contactName: true,
      company: true,
      email: true,
      phone: true,
      stage: true,
      valueCentavos: true,
      probabilityBps: true,
      source: true,
      ownerId: true,
      customerId: true,
      expectedCloseDate: true,
      wonAt: true,
      lostAt: true,
      lostReason: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { id: true, name: true } },
      customer: {
        select: {
          id: true,
          code: true,
          displayName: true,
          segment: true,
          email: true,
          phone: true,
          lifetimeValueCentavos: true,
        },
      },
      activities: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          type: true,
          status: true,
          subject: true,
          note: true,
          dueAt: true,
          completedAt: true,
          createdAt: true,
          ownerId: true,
          owner: { select: { name: true } },
        },
      },
    },
  });
  return lead;
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLead>>>;

export function leadFormValues(lead: LeadDetail): LeadFormValues {
  return {
    title: lead.title,
    contactName: lead.contactName,
    company: lead.company ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    value: toPesoInput(lead.valueCentavos),
    probability: String(Math.round(lead.probabilityBps / 100)),
    source: lead.source ?? "",
    expectedCloseDate: lead.expectedCloseDate
      ? toManilaDateTimeInput(lead.expectedCloseDate).slice(0, 10)
      : "",
    ownerId: lead.ownerId,
    customerId: lead.customerId ?? "",
  };
}
