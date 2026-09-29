"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { hashPassword } from "@/features/auth/services/password";
import { recordAudit } from "@/lib/audit";
import { diffRecords } from "@/lib/audit-diff";
import { db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { authorizeAction } from "@/lib/rbac/guard";

import {
  createUserSchema,
  resetPasswordSchema,
  setUserActiveSchema,
  updateUserSchema,
} from "../schemas";

/**
 * User management. Admin only, enforced by authorizeAction on every entry
 * point rather than by the page that happens to render the form.
 *
 * Two self-inflicted lockouts are blocked explicitly: an admin cannot
 * deactivate their own account, and the last active admin cannot be demoted or
 * deactivated. Without those guards a single click can leave the system with
 * nobody able to administer it.
 */

const LAST_ADMIN = "This is the last active administrator. Promote someone else first.";

/**
 * Active administrators other than this one, counted under a lock on every
 * active admin row. Counted outside the transaction, two admins demoting each
 * other at once would each see the other as the survivor and both succeed.
 * With the rows locked the second waits, re-reads, and is refused.
 */
async function lockOtherActiveAdmins(
  tx: Prisma.TransactionClient,
  excludingUserId: string,
): Promise<number> {
  const admins = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User"
    WHERE role = 'ADMIN' AND "isActive" = true
    ORDER BY id COLLATE "C"
    FOR UPDATE
  `;
  return admins.filter((admin) => admin.id !== excludingUserId).length;
}

function isDuplicateEmail(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createUserAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { user: actor } = await authorizeAction("users.manage");

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
    phone: formData.get("phone") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const email = parsed.data.email.trim().toLowerCase();

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: "That email address is already in use." };

  // Hashed before the transaction opens: bcrypt is deliberately slow.
  const passwordHash = await hashPassword(parsed.data.password);

  let created: { id: string; name: string; email: string; role: string };
  try {
    created = await db.$transaction(async (tx) => {
      const record = await tx.user.create({
        data: {
          name: parsed.data.name,
          email,
          role: parsed.data.role,
          phone: parsed.data.phone,
          passwordHash,
          isActive: true,
        },
        select: { id: true, name: true, email: true, role: true },
      });

      await recordAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "CREATE",
        entityType: "User",
        entityId: record.id,
        summary: `Created user ${record.name} (${record.email}) with role ${record.role}.`,
        changes: {
          name: { from: null, to: record.name },
          email: { from: null, to: record.email },
          role: { from: null, to: record.role },
        },
        tx,
      });

      return record;
    });
  } catch (error) {
    // Someone took the address between the check above and the insert.
    if (isDuplicateEmail(error)) {
      return { ok: false, error: "That email address is already in use." };
    }
    throw error;
  }

  revalidatePath("/settings/users");
  return { ok: true, message: `${created.name} can now sign in.` };
}

export async function updateUserAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { user: actor } = await authorizeAction("users.manage");

  const parsed = updateUserSchema.safeParse({
    userId: formData.get("userId"),
    name: formData.get("name"),
    role: formData.get("role"),
    phone: formData.get("phone") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  try {
    await db.$transaction(async (tx) => {
      // The admin rows are locked before the user row, on every path, so two
      // of these cannot deadlock each other.
      const others = await lockOtherActiveAdmins(tx, parsed.data.userId);

      const before = await tx.user.findUnique({
        where: { id: parsed.data.userId },
        select: { id: true, name: true, email: true, role: true, phone: true, isActive: true },
      });
      if (!before) throw new DomainError("That user no longer exists.");

      // Do not let the last administrator demote themselves out of the system.
      const demotingAnAdmin = before.role === "ADMIN" && parsed.data.role !== "ADMIN";
      if (demotingAnAdmin && before.isActive && others === 0) throw new DomainError(LAST_ADMIN);

      const after = await tx.user.update({
        where: { id: before.id },
        data: { name: parsed.data.name, role: parsed.data.role, phone: parsed.data.phone },
        select: { id: true, name: true, email: true, role: true, phone: true, isActive: true },
      });

      await recordAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "UPDATE",
        entityType: "User",
        entityId: before.id,
        summary:
          before.role === after.role
            ? `Updated user ${after.name} (${after.email}).`
            : `Changed role for ${after.name} (${after.email}) from ${before.role} to ${after.role}.`,
        changes: diffRecords(before, after),
        tx,
      });
    });
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }

  revalidatePath("/settings/users");
  return { ok: true, message: "User updated." };
}

export async function setUserActiveAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { user: actor } = await authorizeAction("users.manage");

  const parsed = setUserActiveSchema.safeParse({
    userId: formData.get("userId"),
    isActive: formData.get("isActive") === "true",
  });

  if (!parsed.success) return { ok: false, error: "Could not read that request." };

  // Locking yourself out is never what you meant.
  if (!parsed.data.isActive && parsed.data.userId === actor.id) {
    return { ok: false, error: "You cannot deactivate your own account." };
  }

  let target: { name: string };
  try {
    target = await db.$transaction(async (tx) => {
      const others = await lockOtherActiveAdmins(tx, parsed.data.userId);

      const record = await tx.user.findUnique({
        where: { id: parsed.data.userId },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });
      if (!record) throw new DomainError("That user no longer exists.");

      if (!parsed.data.isActive && record.role === "ADMIN" && others === 0) {
        throw new DomainError(LAST_ADMIN);
      }

      await tx.user.update({
        where: { id: record.id },
        data: { isActive: parsed.data.isActive },
      });

      await recordAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "UPDATE",
        entityType: "User",
        entityId: record.id,
        summary: parsed.data.isActive
          ? `Reactivated ${record.name} (${record.email}).`
          : `Deactivated ${record.name} (${record.email}).`,
        changes: { isActive: { from: record.isActive, to: parsed.data.isActive } },
        tx,
      });

      return record;
    });
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }

  revalidatePath("/settings/users");
  return {
    ok: true,
    message: parsed.data.isActive
      ? `${target.name} can sign in again.`
      : `${target.name} is deactivated.`,
  };
}

export async function resetUserPasswordAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { user: actor } = await authorizeAction("users.resetPassword");

  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    newPassword: formData.get("newPassword"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, email: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists." };

  const passwordHash = await hashPassword(parsed.data.newPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { passwordHash } });

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "UPDATE",
      entityType: "User",
      entityId: target.id,
      summary: `Reset the password for ${target.name} (${target.email}).`,
      // The trail records that it happened, never the value.
      changes: { passwordHash: { from: "[redacted]", to: "[redacted]" } },
      tx,
    });

    // Any failed attempts that locked the account are no longer relevant.
    await tx.loginAttempt.deleteMany({ where: { email: target.email, success: false } });
  });

  revalidatePath("/settings/users");
  return { ok: true, message: `Password reset for ${target.name}.` };
}
