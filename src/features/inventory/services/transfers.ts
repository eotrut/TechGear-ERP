import type { Prisma, TransferStatus } from "@prisma/client";

import { DomainError, NotFoundError } from "@/lib/errors";
import { nextReference } from "@/lib/numbering";
import { assertTransition, type TransitionMap } from "@/lib/transitions";

import type { CancelTransferInput, ReceiveTransferInput, TransferInput } from "../schemas";
import { applyMovement, lockVariants, type MovementResult } from "./stock";

/**
 * Inter-warehouse transfers.
 *
 *   DRAFT      -> IN_TRANSIT, CANCELLED
 *   IN_TRANSIT -> RECEIVED, CANCELLED
 *   RECEIVED   -> terminal
 *   CANCELLED  -> terminal
 *
 * Dispatch writes TRANSFER_OUT at the source; receiving writes TRANSFER_IN at
 * the destination. Between the two the units are on a truck: counted in
 * neither warehouse's on-hand, which is the truth. Cancelling in transit
 * brings them back to the source with a TRANSFER_IN there.
 *
 * Every status change starts by locking the transfer row and checking the
 * transition against the map. Two people pressing Receive at the same moment
 * therefore queue on that lock, and the second finds the transfer already
 * RECEIVED and is refused, instead of adding the stock twice.
 */

type Tx = Prisma.TransactionClient;

export const TRANSFER_TRANSITIONS: TransitionMap<TransferStatus> = {
  DRAFT: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

type LockedTransfer = {
  id: string;
  reference: string;
  status: TransferStatus;
  fromWarehouseId: string;
  toWarehouseId: string;
  note: string | null;
};

async function lockTransfer(tx: Tx, transferId: string): Promise<LockedTransfer> {
  const [row] = await tx.$queryRaw<LockedTransfer[]>`
    SELECT id, reference, status, "fromWarehouseId", "toWarehouseId", note
    FROM "StockTransfer"
    WHERE id = ${transferId}
    FOR UPDATE
  `;
  if (!row) throw new NotFoundError("That transfer does not exist.");
  return row;
}

async function activeWarehouse(tx: Tx, warehouseId: string, role: "source" | "destination") {
  const warehouse = await tx.warehouse.findFirst({
    where: { id: warehouseId, deletedAt: null },
    select: { id: true, code: true, isActive: true },
  });
  if (!warehouse) throw new NotFoundError(`The ${role} warehouse does not exist.`);
  if (!warehouse.isActive) {
    throw new DomainError(
      `${warehouse.code} is inactive. Reactivate it before moving stock ${
        role === "source" ? "out of" : "into"
      } it.`,
    );
  }
  return warehouse;
}

function appendNote(existing: string | null, addition: string): string {
  return existing ? `${existing}\n${addition}` : addition;
}

async function transferItems(tx: Tx, transferId: string) {
  return tx.stockTransferItem.findMany({
    where: { transferId },
    select: { id: true, variantId: true, qty: true, qtyReceived: true },
  });
}

// ------------------------------------------------------------------- create

export type TransferResult = {
  id: string;
  reference: string;
  status: TransferStatus;
  movements: MovementResult[];
};

export async function createTransfer(
  tx: Tx,
  input: TransferInput,
  actor: { id: string },
): Promise<TransferResult> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw new DomainError("A transfer needs two different warehouses.");
  }
  const variantIds = input.lines.map((line) => line.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    throw new DomainError("Each variant can appear on only one line of a transfer.");
  }

  const reference = await nextReference(tx, "TRF");
  await activeWarehouse(tx, input.fromWarehouseId, "source");
  await activeWarehouse(tx, input.toWarehouseId, "destination");

  // Confirms every variant exists; the locks are held for the dispatch below.
  await lockVariants(tx, variantIds);

  const transfer = await tx.stockTransfer.create({
    data: {
      reference,
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      status: "DRAFT",
      note: input.note === "" ? null : input.note,
      actorId: actor.id,
      items: {
        create: input.lines.map((line) => ({ variantId: line.variantId, qty: line.qty })),
      },
    },
    select: { id: true },
  });

  if (!input.dispatch) {
    return { id: transfer.id, reference, status: "DRAFT", movements: [] };
  }

  const dispatched = await dispatchTransfer(tx, transfer.id, actor);
  return { ...dispatched, reference };
}

// ----------------------------------------------------------------- dispatch

export async function dispatchTransfer(
  tx: Tx,
  transferId: string,
  actor: { id: string },
): Promise<TransferResult> {
  const transfer = await lockTransfer(tx, transferId);
  assertTransition(TRANSFER_TRANSITIONS, "Transfer", transfer.status, "IN_TRANSIT");

  const source = await activeWarehouse(tx, transfer.fromWarehouseId, "source");
  await activeWarehouse(tx, transfer.toWarehouseId, "destination");

  const items = await transferItems(tx, transfer.id);
  await lockVariants(
    tx,
    items.map((item) => item.variantId),
  );

  const movements: MovementResult[] = [];
  for (const item of items) {
    movements.push(
      await applyMovement(tx, {
        variantId: item.variantId,
        warehouseId: source.id,
        type: "TRANSFER_OUT",
        reason: "TRANSFER",
        qtyDelta: -item.qty,
        note: `Dispatched on ${transfer.reference}`,
        actorId: actor.id,
        refs: { transferItemId: item.id },
      }),
    );
  }

  await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "IN_TRANSIT", shippedAt: new Date() },
    select: { id: true },
  });

  return { id: transfer.id, reference: transfer.reference, status: "IN_TRANSIT", movements };
}

// ------------------------------------------------------------------ receive

export type ReceiveResult = TransferResult & { shortUnits: number };

/**
 * Receive an in-transit transfer. Each line may arrive short; the shortfall
 * left the source when it was dispatched and never reached the destination,
 * so it is recorded against the line and a note explaining it is required.
 */
export async function receiveTransfer(
  tx: Tx,
  input: ReceiveTransferInput,
  actor: { id: string },
): Promise<ReceiveResult> {
  const transfer = await lockTransfer(tx, input.transferId);
  assertTransition(TRANSFER_TRANSITIONS, "Transfer", transfer.status, "RECEIVED");

  const destination = await activeWarehouse(tx, transfer.toWarehouseId, "destination");
  const items = await transferItems(tx, transfer.id);

  const received = new Map(input.lines.map((line) => [line.itemId, line.qtyReceived]));
  for (const itemId of received.keys()) {
    if (!items.some((item) => item.id === itemId)) {
      throw new DomainError("A received line does not belong to this transfer.");
    }
  }

  let shortUnits = 0;
  for (const item of items) {
    const qty = received.get(item.id) ?? item.qty;
    if (qty > item.qty) {
      throw new DomainError(
        `Only ${item.qty} were dispatched on one line, so ${qty} cannot be received. ` +
          `Record extra units with a count correction instead.`,
      );
    }
    shortUnits += item.qty - qty;
  }

  const note = input.note.trim();
  if (shortUnits > 0 && note === "") {
    throw new DomainError(
      `${shortUnits} unit${shortUnits === 1 ? " is" : "s are"} missing. Add a note explaining the shortfall.`,
    );
  }

  await lockVariants(
    tx,
    items.map((item) => item.variantId),
  );

  const movements: MovementResult[] = [];
  for (const item of items) {
    const qty = received.get(item.id) ?? item.qty;

    if (qty > 0) {
      movements.push(
        await applyMovement(tx, {
          variantId: item.variantId,
          warehouseId: destination.id,
          type: "TRANSFER_IN",
          reason: "TRANSFER",
          qtyDelta: qty,
          note:
            qty < item.qty
              ? `Received ${qty} of ${item.qty} on ${transfer.reference}. ${note}`
              : `Received on ${transfer.reference}`,
          actorId: actor.id,
          refs: { transferItemId: item.id },
        }),
      );
    }

    await tx.stockTransferItem.update({
      where: { id: item.id },
      data: { qtyReceived: qty },
      select: { id: true },
    });
  }

  await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: {
      status: "RECEIVED",
      receivedAt: new Date(),
      ...(note ? { note: appendNote(transfer.note, `Receiving: ${note}`) } : {}),
    },
    select: { id: true },
  });

  return {
    id: transfer.id,
    reference: transfer.reference,
    status: "RECEIVED",
    movements,
    shortUnits,
  };
}

// ------------------------------------------------------------------- cancel

/**
 * Cancel a draft, or recall a transfer in transit. A recall returns every
 * dispatched unit to the source with a TRANSFER_IN there, so the ledger shows
 * the stock leaving and coming back rather than a movement being deleted.
 */
export async function cancelTransfer(
  tx: Tx,
  input: CancelTransferInput,
  actor: { id: string },
): Promise<TransferResult> {
  const transfer = await lockTransfer(tx, input.transferId);
  assertTransition(TRANSFER_TRANSITIONS, "Transfer", transfer.status, "CANCELLED");

  const movements: MovementResult[] = [];

  if (transfer.status === "IN_TRANSIT") {
    const items = await transferItems(tx, transfer.id);
    await lockVariants(
      tx,
      items.map((item) => item.variantId),
    );

    for (const item of items) {
      movements.push(
        await applyMovement(tx, {
          variantId: item.variantId,
          warehouseId: transfer.fromWarehouseId,
          type: "TRANSFER_IN",
          reason: "TRANSFER",
          qtyDelta: item.qty,
          note: `Returned to source, ${transfer.reference} cancelled in transit. ${input.reason}`,
          actorId: actor.id,
          refs: { transferItemId: item.id },
        }),
      );
    }
  }

  await tx.stockTransfer.update({
    where: { id: transfer.id },
    data: { status: "CANCELLED", note: appendNote(transfer.note, `Cancelled: ${input.reason}`) },
    select: { id: true },
  });

  return { id: transfer.id, reference: transfer.reference, status: "CANCELLED", movements };
}
