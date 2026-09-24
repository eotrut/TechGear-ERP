"use server";

import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { diffRecords, recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { authorizeAction } from "@/lib/rbac/guard";

import { recentOrdersFor, searchCustomers, type CustomerPick } from "../queries";
import {
  customerFormSchema,
  customerIdSchema,
  customerSearchSchema,
  updateCustomerSchema,
} from "../schemas";
import { archiveCustomer, createCustomer, updateCustomer } from "../services/customers";
import { recomputeSegments } from "../services/segments";

/**
 * Customer mutations. Each one authorizes against the live user record,
 * validates with the schema the form uses, writes its change and its audit
 * entry in one transaction, and revalidates the pages that show it.
 */

function fail(error: unknown): { ok: false; error: string } {
  if (error instanceof DomainError) return { ok: false, error: error.message };
  console.error("Customer action failed", error);
  return { ok: false, error: "Something went wrong saving that. Nothing was changed." };
}

function invalid(issues: { message: string }[]): { ok: false; error: string } {
  return { ok: false, error: issues[0]?.message ?? "Check the form and try again." };
}

export async function createCustomerAction(
  input: unknown,
): Promise<ActionResult & { id?: string }> {
  const { user } = await authorizeAction("customers.manage");

  const parsed = customerFormSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const customer = await db.$transaction(async (tx) => {
      const created = await createCustomer(tx, parsed.data);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "CREATE",
        entityType: "Customer",
        entityId: created.id,
        summary: `Added customer ${created.displayName} (${created.code}).`,
        tx,
      });
      return created;
    });

    revalidatePath("/customers");
    return {
      ok: true,
      id: customer.id,
      message: `${customer.displayName} added as ${customer.code}.`,
    };
  } catch (error) {
    return fail(error);
  }
}

export async function updateCustomerAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("customers.manage");

  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { customerId, values } = parsed.data;

  try {
    const result = await db.$transaction(async (tx) => {
      const change = await updateCustomer(tx, customerId, values);
      const changes = diffRecords(change.before, change.after);
      if (Object.keys(changes).length > 0) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entityType: "Customer",
          entityId: customerId,
          summary: `Updated customer ${change.after.displayName} (${change.code}).`,
          changes,
          tx,
        });
      }
      return change;
    });

    revalidatePath("/customers");
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, message: `${result.after.displayName} saved.` };
  } catch (error) {
    return fail(error);
  }
}

export async function archiveCustomerAction(input: unknown): Promise<ActionResult> {
  const { user } = await authorizeAction("customers.delete");

  const parsed = customerIdSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error.issues);

  try {
    const customer = await db.$transaction(async (tx) => {
      const archived = await archiveCustomer(tx, parsed.data.customerId);
      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: "DELETE",
        entityType: "Customer",
        entityId: parsed.data.customerId,
        summary: `Archived customer ${archived.displayName} (${archived.code}).`,
        tx,
      });
      return archived;
    });

    revalidatePath("/customers");
    return { ok: true, message: `${customer.displayName} archived. Their history is kept.` };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Recompute every segment now. Segments follow orders on their own; this
 * exists for the input no event announces, a customer going quiet, and is
 * what the nightly `npm run db:segments` does.
 */
export async function refreshSegmentsAction(): Promise<ActionResult> {
  const { user } = await authorizeAction("customers.refreshSegments");

  try {
    const result = await db.$transaction(async (tx) => {
      const refresh = await recomputeSegments(tx, new Date());
      if (refresh.changed > 0) {
        await recordAudit({
          actorId: user.id,
          actorEmail: user.email,
          action: "UPDATE",
          entityType: "Customer",
          summary: `Recomputed customer segments: ${refresh.changed} of ${refresh.customers} changed.`,
          changes: Object.fromEntries(
            refresh.moves.slice(0, 50).map((move) => [move.id, { from: move.from, to: move.to }]),
          ),
          tx,
        });
      }
      return refresh;
    });

    revalidatePath("/customers");
    return {
      ok: true,
      message:
        result.changed === 0
          ? `All ${result.customers} segments were already current.`
          : `${result.changed} customer${result.changed === 1 ? "" : "s"} moved segment.`,
    };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------ lookups

export async function searchCustomersAction(
  input: unknown,
): Promise<{ ok: true; results: CustomerPick[] } | { ok: false; error: string }> {
  await authorizeAction("customers.view");
  const parsed = customerSearchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Search could not be read." };
  return { ok: true, results: await searchCustomers(parsed.data.query) };
}

export async function customerOrdersAction(input: unknown): Promise<
  | {
      ok: true;
      results: {
        id: string;
        orderNumber: string;
        placedAt: Date;
        status: string;
        channel: string;
      }[];
    }
  | { ok: false; error: string }
> {
  await authorizeAction("orders.view");
  const parsed = customerIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Missing customer." };
  return { ok: true, results: await recentOrdersFor(parsed.data.customerId) };
}
