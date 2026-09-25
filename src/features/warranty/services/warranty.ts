import type { PaymentMethod, Prisma, WarrantyClaimStatus } from "@prisma/client";

import { applyMovement, lockVariants } from "@/features/inventory/services/stock";
import {
  createOrder,
  lockOrder,
  recordRefund,
  type Actor,
  type RefundResult,
} from "@/features/orders/services/orders";
import { refundableBalance, refundForUnits } from "@/features/orders/services/order-rules";
import { DomainError, NotFoundError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { nextReference } from "@/lib/numbering";
import { assertTransition } from "@/lib/transitions";

import { OPEN_CLAIM_STATUSES, WARRANTY_TRANSITIONS, warrantyExpiry } from "./warranty-rules";

/**
 * Warranty claims, docs/PLAN.md section 5.5.
 *
 * The status machine lives in warranty-rules.ts, where the claim page can read it.
 *
 * A replacement is a real, zero-value order (decision D-20): the unit leaves
 * stock through a SALE movement at the current average cost, so the cost of
 * honouring the warranty lands in the books instead of vanishing. A refund
 * pays back one unit's share of the line and writes the faulty unit off.
 */

type Tx = Prisma.TransactionClient;

export { OPEN_CLAIM_STATUSES, WARRANTY_TRANSITIONS, warrantyExpiry };

type LockedClaim = {
  id: string;
  claimNumber: string;
  status: WarrantyClaimStatus;
  orderItemId: string;
  customerId: string;
  variantId: string;
  resolution: string | null;
  assigneeId: string | null;
};

async function lockClaim(tx: Tx, claimId: string): Promise<LockedClaim> {
  const [row] = await tx.$queryRaw<LockedClaim[]>`
    SELECT id, "claimNumber", status, "orderItemId", "customerId", "variantId", resolution,
           "assigneeId"
    FROM "WarrantyClaim" WHERE id = ${claimId} FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That warranty claim does not exist.");
  return row;
}

function appendResolution(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition;
}

// ------------------------------------------------------------------- create

export async function createClaim(
  tx: Tx,
  input: { orderItemId: string; issueDescription: string; serialNumber: string },
  now: Date = new Date(),
): Promise<{ id: string; claimNumber: string; warrantyExpiresAt: Date }> {
  const claimNumber = await nextReference(tx, "WC", now);

  const item = await tx.orderItem.findUnique({
    where: { id: input.orderItemId },
    select: {
      id: true,
      orderId: true,
      qty: true,
      qtyReturned: true,
      skuSnapshot: true,
      variantId: true,
      variant: { select: { warrantyMonths: true } },
    },
  });
  if (!item) throw new NotFoundError("That order line does not exist.");

  // Lock the order so two claims cannot both take the last unit on a line.
  const order = await lockOrder(tx, item.orderId);
  const detail = await tx.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { deliveredAt: true },
  });

  if (!detail.deliveredAt || !(order.status === "DELIVERED" || order.status === "COMPLETED")) {
    throw new DomainError(
      `${order.orderNumber} has not been delivered, so its warranty has not started.`,
    );
  }
  if (!order.customerId) {
    throw new DomainError(
      `${order.orderNumber} has no customer on file. Attach one before raising a claim.`,
    );
  }
  if (item.variant.warrantyMonths <= 0) {
    throw new DomainError(`${item.skuSnapshot} is sold without a warranty.`);
  }

  const warrantyExpiresAt = warrantyExpiry(detail.deliveredAt, item.variant.warrantyMonths);
  if (now > warrantyExpiresAt) {
    throw new DomainError(
      `The ${item.variant.warrantyMonths} month warranty on ${item.skuSnapshot} ended on ${formatDate(
        warrantyExpiresAt,
      )}.`,
    );
  }

  const open = await tx.warrantyClaim.count({
    where: { orderItemId: item.id, status: { in: [...OPEN_CLAIM_STATUSES] } },
  });
  if (open >= item.qty - item.qtyReturned) {
    throw new DomainError(
      `Every unit of ${item.skuSnapshot} on this order already has a claim in progress.`,
    );
  }

  const claim = await tx.warrantyClaim.create({
    data: {
      claimNumber,
      orderItemId: item.id,
      customerId: order.customerId,
      variantId: item.variantId,
      status: "SUBMITTED",
      issueDescription: input.issueDescription,
      serialNumber: input.serialNumber.trim() || null,
      warrantyExpiresAt,
      submittedAt: now,
    },
    select: { id: true },
  });

  await tx.notification.create({
    data: {
      targetRole: "MANAGER",
      type: "WARRANTY_CLAIM",
      title: `Warranty claim ${claimNumber}`,
      body: `${item.skuSnapshot} on ${order.orderNumber} needs review.`,
      link: `/warranty/${claim.id}`,
    },
    select: { id: true },
  });

  return { id: claim.id, claimNumber, warrantyExpiresAt };
}

// ------------------------------------------------------------------- review

export async function reviewClaim(
  tx: Tx,
  input: { claimId: string; to: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CLOSED"; note: string },
  actor: Actor,
): Promise<{ claimNumber: string; from: WarrantyClaimStatus }> {
  const claim = await lockClaim(tx, input.claimId);
  assertTransition(WARRANTY_TRANSITIONS, "Warranty claim", claim.status, input.to);

  const note = input.note.trim();
  if (input.to === "REJECTED" && note === "") {
    throw new DomainError("Say why the claim is rejected; the customer will ask.");
  }

  const now = new Date();
  await tx.warrantyClaim.update({
    where: { id: claim.id },
    data: {
      status: input.to,
      assigneeId: claim.assigneeId ?? actor.id,
      ...(note ? { resolution: appendResolution(claim.resolution, note) } : {}),
      // A rejection resolves the claim; an appeal reopens it.
      ...(input.to === "REJECTED" ? { resolvedAt: now } : {}),
      ...(input.to === "UNDER_REVIEW" && claim.status === "REJECTED" ? { resolvedAt: null } : {}),
    },
    select: { id: true },
  });
  return { claimNumber: claim.claimNumber, from: claim.status };
}

// -------------------------------------------------------------- replacement

export async function replaceClaim(
  tx: Tx,
  input: { claimId: string; warehouseId: string; note: string },
  actor: Actor,
): Promise<{ claimNumber: string; orderId: string; orderNumber: string }> {
  // Claim first: it is the document this flow acts on.
  const claim = await lockClaim(tx, input.claimId);
  assertTransition(WARRANTY_TRANSITIONS, "Warranty claim", claim.status, "REPLACED");

  const order = await createOrder(
    tx,
    {
      channel: "DIRECT",
      customerId: claim.customerId,
      warehouseId: input.warehouseId,
      shippingAddressId: null,
      channelReference: claim.claimNumber,
      shippingCentavos: 0,
      promoCode: null,
      manualDiscount: null,
      notes: `Warranty replacement for ${claim.claimNumber}.`,
      lines: [{ variantId: claim.variantId, qty: 1, discountCentavos: 0 }],
    },
    actor,
    {
      intent: "paid",
      tenders: [],
      pricing: "free",
      saleReason: "WARRANTY_REPLACEMENT",
      discountCapBps: null,
    },
  );

  const note = input.note.trim();
  await tx.warrantyClaim.update({
    where: { id: claim.id },
    data: {
      status: "REPLACED",
      replacementOrderId: order.id,
      resolvedAt: new Date(),
      assigneeId: claim.assigneeId ?? actor.id,
      resolution: appendResolution(
        claim.resolution,
        `Replaced from stock on ${order.orderNumber}.${note ? ` ${note}` : ""}`,
      ),
    },
    select: { id: true },
  });

  return { claimNumber: claim.claimNumber, orderId: order.id, orderNumber: order.orderNumber };
}

// ------------------------------------------------------------------- refund

export async function refundClaim(
  tx: Tx,
  input: { claimId: string; method: PaymentMethod; reference: string; note: string },
  actor: Actor,
): Promise<{ claimNumber: string; refund: RefundResult }> {
  const claim = await lockClaim(tx, input.claimId);
  assertTransition(WARRANTY_TRANSITIONS, "Warranty claim", claim.status, "REFUNDED");

  const item = await tx.orderItem.findUniqueOrThrow({
    where: { id: claim.orderItemId },
    select: {
      id: true,
      orderId: true,
      variantId: true,
      qty: true,
      qtyReturned: true,
      lineTotalCentavos: true,
      unitCostCentavos: true,
      skuSnapshot: true,
    },
  });
  if (item.qtyReturned >= item.qty) {
    throw new DomainError(`Every unit of ${item.skuSnapshot} on this order has already come back.`);
  }

  const order = await lockOrder(tx, item.orderId);
  const warehouseId = order.warehouseId;
  await lockVariants(tx, [item.variantId]);

  const unitValue = refundForUnits(item, item.qtyReturned, 1);
  const amount = Math.min(unitValue, refundableBalance(order));
  if (amount <= 0) {
    throw new DomainError("Everything paid on this order has already been refunded.");
  }

  // The faulty unit comes back and is scrapped: its cost goes to loss.
  await applyMovement(tx, {
    variantId: item.variantId,
    warehouseId,
    type: "WRITE_OFF",
    reason: "DAMAGE",
    qtyDelta: 0,
    unitCostCentavos: item.unitCostCentavos,
    note: `Faulty unit refunded on ${claim.claimNumber}, written off`,
    actorId: actor.id,
    refs: { orderItemId: item.id },
  });
  await tx.orderItem.update({
    where: { id: item.id },
    data: { qtyReturned: { increment: 1 } },
    select: { id: true },
  });

  const refund = await recordRefund(
    tx,
    {
      orderId: order.id,
      amountCentavos: amount,
      method: input.method,
      reason: `Warranty claim ${claim.claimNumber}`,
      reference: input.reference,
    },
    actor,
  );

  const note = input.note.trim();
  await tx.warrantyClaim.update({
    where: { id: claim.id },
    data: {
      status: "REFUNDED",
      resolvedAt: new Date(),
      assigneeId: claim.assigneeId ?? actor.id,
      resolution: appendResolution(
        claim.resolution,
        `Refunded one unit and wrote it off.${note ? ` ${note}` : ""}`,
      ),
    },
    select: { id: true },
  });

  return { claimNumber: claim.claimNumber, refund };
}
