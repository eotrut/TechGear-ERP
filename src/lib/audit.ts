import type { AuditAction, Prisma } from "@prisma/client";
import { headers } from "next/headers";

import type { AuditChanges } from "@/lib/audit-diff";
import { db } from "@/lib/db";

/**
 * Audit trail. SPEC section 5.1 requires a record of key create, update and
 * delete actions, stock adjustments, price changes and logins.
 *
 * Every entry answers four questions: who, what, when, and what changed. The
 * "what changed" part is a field-level before/after diff stored on the row, so
 * the audit page can show the actual values rather than just "updated".
 *
 * The actor's email is denormalised onto the row. If the user is later deleted
 * the foreign key nulls out, but the trail still says who did it, which is the
 * whole point of having one.
 */

export { diffRecords, serialise, type AuditChange, type AuditChanges } from "@/lib/audit-diff";

type RequestContext = { ipAddress: string | null; userAgent: string | null };

/**
 * Best-effort client details. Returns nulls outside a request scope, for
 * example when the seed or a script writes an entry.
 */
export async function requestContext(): Promise<RequestContext> {
  try {
    const headerList = await headers();
    const forwardedFor = headerList.get("x-forwarded-for");
    return {
      // x-forwarded-for is a comma separated chain; the client is first.
      ipAddress: forwardedFor?.split(",")[0]?.trim() ?? headerList.get("x-real-ip") ?? null,
      userAgent: headerList.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

export type AuditInput = {
  actorId: string | null;
  actorEmail: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  changes?: AuditChanges;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Pass a transaction client so the entry commits with the change it records. */
  tx?: Prisma.TransactionClient;
};

/**
 * Write one audit entry.
 *
 * Pass `tx` whenever the entry describes a change made in a transaction, so an
 * audit row can never survive a rolled-back mutation, and a committed mutation
 * can never go unrecorded.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const client = input.tx ?? db;

  const context =
    input.ipAddress === undefined || input.userAgent === undefined
      ? await requestContext()
      : { ipAddress: input.ipAddress, userAgent: input.userAgent };

  const hasChanges = input.changes && Object.keys(input.changes).length > 0;

  await client.auditLog.create({
    data: {
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      changes: hasChanges ? (input.changes as Prisma.InputJsonValue) : undefined,
      ipAddress: input.ipAddress ?? context.ipAddress,
      userAgent: input.userAgent ?? context.userAgent,
    },
  });
}

/**
 * Audit writes must never take down the operation they describe. A failed
 * insert is logged to the server console and swallowed, because losing one
 * trail entry is strictly better than failing a stock movement that already
 * committed. Entries written inside a transaction should use recordAudit
 * directly so they share that transaction's fate.
 */
export async function recordAuditSafe(input: AuditInput): Promise<void> {
  try {
    await recordAudit(input);
  } catch (error) {
    console.error(
      "Failed to write audit entry",
      { action: input.action, entityType: input.entityType },
      error,
    );
  }
}
