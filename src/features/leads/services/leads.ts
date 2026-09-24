import type { LeadStage, Prisma, SalesChannel } from "@prisma/client";

import { insertCustomer } from "@/features/customers/services/customers";
import { DomainError, InvalidTransitionError, NotFoundError } from "@/lib/errors";
import { parseManilaDateTime } from "@/lib/format";
import { parsePesoInput } from "@/lib/money";
import { nextCode } from "@/lib/numbering";
import { can } from "@/lib/rbac/can";
import type { Access } from "@/lib/rbac/matrix";
import { emptyToNull } from "@/lib/validation";

import type { ConvertLeadInput, LeadFormValues, MoveLeadInput } from "../schemas";
import {
  explainLeadMove,
  POSITION_STEP,
  positionBetween,
  rebalancedPositions,
  STAGE_PROBABILITY_BPS,
} from "./pipeline";

/**
 * Lead writes. Every change that touches a stage or a position starts by
 * locking the lead row, the document lock, so two people dragging the same
 * card cannot both win, and the second is judged against the stage the first
 * one left it in.
 *
 * `actor.scope` is the caller's access to the permission being exercised.
 * Sales holds `leads.moveStage` and `leads.convert` as "own", so the owner is
 * checked here, under the lock, against the row as it is now.
 */

type Tx = Prisma.TransactionClient;
type Actor = { id: string; scope: Access };

type LockedLead = {
  id: string;
  code: string;
  title: string;
  stage: LeadStage;
  ownerId: string;
  customerId: string | null;
  position: number;
  contactName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: SalesChannel | null;
};

async function lockLead(tx: Tx, leadId: string): Promise<LockedLead> {
  const [row] = await tx.$queryRaw<LockedLead[]>`
    SELECT id, code, title, stage, "ownerId", "customerId", position,
           "contactName", company, email, phone, source
    FROM "Lead"
    WHERE id = ${leadId}
    FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That lead no longer exists.");
  return row;
}

function assertOwner(lead: LockedLead, actor: Actor, doing: string) {
  if (actor.scope === "own" && lead.ownerId !== actor.id) {
    throw new DomainError(
      `${lead.code} belongs to another salesperson, so you cannot ${doing} it. Ask a manager to reassign it.`,
    );
  }
}

async function assertAssignable(tx: Tx, userId: string) {
  const owner = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, isActive: true },
  });
  if (!owner || !owner.isActive) throw new DomainError("That person is not an active user.");
  if (!can(owner.role, "leads.view")) {
    throw new DomainError(`${owner.name} does not work the pipeline, so cannot own a lead.`);
  }
}

function closeDateFrom(value: string): Date | null {
  // Noon in Manila, so the date reads the same in every timezone it is shown in.
  return value === "" ? null : parseManilaDateTime(`${value}T12:00`);
}

function leadColumns(values: LeadFormValues) {
  return {
    title: values.title,
    contactName: values.contactName,
    company: emptyToNull(values.company),
    email: emptyToNull(values.email)?.toLowerCase() ?? null,
    phone: emptyToNull(values.phone),
    valueCentavos: parsePesoInput(values.value) ?? 0,
    source: values.source === "" ? null : values.source,
    expectedCloseDate: closeDateFrom(values.expectedCloseDate),
  };
}

async function assertCustomer(tx: Tx, customerId: string) {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, displayName: true, code: true },
  });
  if (!customer) throw new NotFoundError("That customer no longer exists.");
  return customer;
}

/** Top of a column: new and freshly moved cards are where the eye lands. */
async function topOfColumn(tx: Tx, stage: LeadStage, excludeId?: string): Promise<number> {
  const first = await tx.lead.findFirst({
    where: { stage, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { position: "asc" },
    select: { position: true },
  });
  return first ? first.position - POSITION_STEP : POSITION_STEP;
}

// ------------------------------------------------------------------- create

export async function createLead(
  tx: Tx,
  values: LeadFormValues,
  actor: { id: string; canAssign: boolean },
) {
  const ownerId = actor.canAssign && values.ownerId !== "" ? values.ownerId : actor.id;
  if (ownerId !== actor.id) await assertAssignable(tx, ownerId);
  if (values.customerId !== "") await assertCustomer(tx, values.customerId);

  const code = await nextCode(tx, "LEAD");
  return tx.lead.create({
    data: {
      ...leadColumns(values),
      code,
      stage: "NEW",
      position: await topOfColumn(tx, "NEW"),
      probabilityBps:
        values.probability === "" ? STAGE_PROBABILITY_BPS.NEW : Number(values.probability) * 100,
      ownerId,
      customerId: values.customerId === "" ? null : values.customerId,
    },
    select: { id: true, code: true, title: true },
  });
}

// ------------------------------------------------------------------- update

export async function updateLead(
  tx: Tx,
  leadId: string,
  values: LeadFormValues,
  actor: { id: string; scope: Access; canReassign: boolean },
) {
  const lead = await lockLead(tx, leadId);
  assertOwner(lead, actor, "edit");

  const before = await tx.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      title: true,
      contactName: true,
      company: true,
      email: true,
      phone: true,
      valueCentavos: true,
      probabilityBps: true,
      source: true,
      expectedCloseDate: true,
      ownerId: true,
      customerId: true,
    },
  });

  const ownerId = values.ownerId === "" ? before.ownerId : values.ownerId;
  if (ownerId !== before.ownerId) {
    if (!actor.canReassign)
      throw new DomainError("Only a manager can hand a lead to someone else.");
    await assertAssignable(tx, ownerId);
  }

  const customerId = values.customerId === "" ? null : values.customerId;
  if (customerId && customerId !== before.customerId) await assertCustomer(tx, customerId);
  if (!customerId && lead.stage === "WON") {
    throw new DomainError("A won lead stays linked to the customer it became.");
  }

  const after = {
    ...leadColumns(values),
    probabilityBps:
      values.probability === "" ? before.probabilityBps : Number(values.probability) * 100,
    ownerId,
    customerId,
  };

  await tx.lead.update({ where: { id: leadId }, data: after, select: { id: true } });
  return { code: lead.code, before, after };
}

// --------------------------------------------------------------------- move

export type MoveResult = {
  code: string;
  title: string;
  from: LeadStage;
  to: LeadStage;
  position: number;
  rebalanced: boolean;
};

/**
 * Where a dropped card goes in its column: halfway between the neighbours the
 * person dropped it between. Neighbours that have since moved to another
 * column are ignored, which degrades to "top" or "bottom" rather than failing.
 * When the gap is exhausted, that column alone is renumbered.
 */
async function placeInColumn(
  tx: Tx,
  leadId: string,
  stage: LeadStage,
  beforeId: string | null,
  afterId: string | null,
): Promise<{ position: number; rebalanced: boolean }> {
  const neighbourIds = [beforeId, afterId].filter(
    (id): id is string => id !== null && id !== leadId,
  );
  const neighbours = neighbourIds.length
    ? await tx.lead.findMany({
        where: { id: { in: neighbourIds }, stage },
        select: { id: true, position: true },
      })
    : [];
  const before = neighbours.find((n) => n.id === beforeId) ?? null;
  const after = neighbours.find((n) => n.id === afterId) ?? null;

  // An empty column, or neighbours that have both left it since: go on top.
  if (!before && !after) {
    return { position: await topOfColumn(tx, stage, leadId), rebalanced: false };
  }

  // Positions are compared against the real next card, not just the one the
  // client named, in case something else landed in between since.
  let upper = after?.position ?? null;
  if (before && !after) {
    const next = await tx.lead.findFirst({
      where: { stage, id: { not: leadId }, position: { gt: before.position } },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    upper = next?.position ?? null;
  }
  let lower = before?.position ?? null;
  if (after && !before) {
    const previous = await tx.lead.findFirst({
      where: { stage, id: { not: leadId }, position: { lt: after.position } },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    lower = previous?.position ?? null;
  }

  const position = positionBetween(lower, upper);
  if (position !== null) return { position, rebalanced: false };

  // The gap is spent. Renumber this column, with the card in its new slot.
  const column = await tx.lead.findMany({
    where: { stage, id: { not: leadId } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const ids = column.map((card) => card.id);
  const insertAt = before ? ids.indexOf(before.id) + 1 : 0;
  ids.splice(insertAt, 0, leadId);

  const positions = rebalancedPositions(ids);
  for (const [id, value] of positions) {
    if (id === leadId) continue;
    await tx.lead.update({ where: { id }, data: { position: value }, select: { id: true } });
  }
  return { position: positions.get(leadId) ?? POSITION_STEP, rebalanced: true };
}

export async function moveLead(tx: Tx, input: MoveLeadInput, actor: Actor): Promise<MoveResult> {
  const lead = await lockLead(tx, input.leadId);
  assertOwner(lead, actor, "move");

  const from = lead.stage;
  const to = input.toStage;

  if (from !== to) {
    const refusal = explainLeadMove(from, to);
    if (refusal) throw new InvalidTransitionError("Lead", from, to, refusal);

    if (to === "WON" && !lead.customerId) {
      throw new DomainError(
        `Convert ${lead.code} to a customer to mark it won, so the sale has somebody to belong to.`,
      );
    }
    if (to === "LOST" && !input.lostReason) {
      throw new DomainError("Say why it was lost. It is what the next quote learns from.");
    }
  }

  const placed = await placeInColumn(tx, lead.id, to, input.beforeId, input.afterId);

  const stageChange: Prisma.LeadUpdateInput =
    from === to
      ? {}
      : {
          stage: to,
          probabilityBps: STAGE_PROBABILITY_BPS[to],
          ...(to === "WON" ? { wonAt: new Date() } : {}),
          ...(to === "LOST" ? { lostAt: new Date(), lostReason: input.lostReason ?? null } : {}),
          // Reopening forgets the loss, which stays in the audit trail.
          ...(from === "LOST" ? { lostAt: null, lostReason: null } : {}),
        };

  await tx.lead.update({
    where: { id: lead.id },
    data: { position: placed.position, ...stageChange },
    select: { id: true },
  });

  return {
    code: lead.code,
    title: lead.title,
    from,
    to,
    position: placed.position,
    rebalanced: placed.rebalanced,
  };
}

// ------------------------------------------------------------------ convert

/**
 * Win a lead by attaching it to a customer: one that already exists, or one
 * made from the lead's own contact details. Conversion is the only way into
 * WON, so every won deal has an account to hang orders and invoices on.
 */
export async function convertLead(tx: Tx, input: ConvertLeadInput, actor: Actor) {
  const lead = await lockLead(tx, input.leadId);
  assertOwner(lead, actor, "convert");

  const refusal = explainLeadMove(lead.stage, "WON");
  if (lead.stage === "WON") throw new DomainError(`${lead.code} is already won.`);
  if (refusal) throw new InvalidTransitionError("Lead", lead.stage, "WON", refusal);

  let customer: { id: string; code: string; displayName: string; created: boolean };
  if (input.mode === "existing") {
    const existing = await assertCustomer(tx, input.customerId);
    customer = { ...existing, created: false };
  } else {
    const isBusiness = input.type === "BUSINESS";
    const firstName = isBusiness ? null : input.firstName;
    const lastName = isBusiness ? null : input.lastName;
    const companyName = isBusiness ? input.companyName : null;
    const created = await insertCustomer(
      tx,
      {
        type: input.type,
        firstName,
        lastName,
        companyName,
        displayName: isBusiness ? input.companyName : `${input.firstName} ${input.lastName}`,
        email: emptyToNull(input.email)?.toLowerCase() ?? null,
        phone: emptyToNull(input.phone),
        taxId: null,
        sourceChannel: lead.source,
        tags: ["from-lead"],
        facebookHandle: null,
        instagramHandle: null,
        notes: `Converted from ${lead.code}: ${lead.title}. Primary contact ${lead.contactName}.`,
        creditLimitCentavos: 0,
      },
      null,
    );
    customer = { ...created, created: true };
  }

  const position = await topOfColumn(tx, "WON", lead.id);
  await tx.lead.update({
    where: { id: lead.id },
    data: {
      stage: "WON",
      wonAt: new Date(),
      probabilityBps: STAGE_PROBABILITY_BPS.WON,
      customerId: customer.id,
      position,
    },
    select: { id: true },
  });

  return { code: lead.code, title: lead.title, from: lead.stage, customer };
}

// ----------------------------------------------------------------- reassign

export async function reassignLead(tx: Tx, leadId: string, ownerId: string) {
  const lead = await lockLead(tx, leadId);
  if (lead.ownerId === ownerId)
    return { code: lead.code, from: ownerId, to: ownerId, changed: false };
  await assertAssignable(tx, ownerId);
  await tx.lead.update({ where: { id: leadId }, data: { ownerId }, select: { id: true } });
  return { code: lead.code, from: lead.ownerId, to: ownerId, changed: true };
}

// ------------------------------------------------------------------- delete

export async function deleteLead(tx: Tx, leadId: string) {
  const lead = await lockLead(tx, leadId);
  if (lead.stage === "WON") {
    throw new DomainError(
      `${lead.code} was won and is now part of the customer's history. It cannot be deleted.`,
    );
  }
  await tx.lead.delete({ where: { id: leadId }, select: { id: true } });
  return lead;
}
