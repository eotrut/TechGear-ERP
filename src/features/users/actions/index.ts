"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";

import type { ActionResult } from "@/features/auth/actions";
import { recordAudit } from "@/lib/audit";
import { diffRecords } from "@/lib/audit-diff";
import { db } from "@/lib/db";
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

const BCRYPT_ROUNDS = 12;

async function countOtherActiveAdmins(excludingUserId: string): Promise<number> {
  return db.user.count({
    where: { role: "ADMIN", isActive: true, id: { not: excludingUserId } },
  });
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

  const created = await db.$transaction(async (tx) => {
    const record = await tx.user.create({
      data: {
        name: parsed.data.name,
        email,
        role: parsed.data.role,
        phone: parsed.data.phone,
        passwordHash: await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS),
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

  const before = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, email: true, role: true, phone: true, isActive: true },
  });
  if (!before) return { ok: false, error: "That user no longer exists." };

  // Do not let the last administrator demote themselves out of the system.
  const demotingAnAdmin = before.role === "ADMIN" && parsed.data.role !== "ADMIN";
  if (demotingAnAdmin && before.isActive) {
    const others = await countOtherActiveAdmins(before.id);
    if (others === 0) {
      return {
        ok: false,
        error: "This is the last active administrator. Promote someone else first.",
      };
    }
  }

  await db.$transaction(async (tx) => {
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

  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  if (!target) return { ok: false, error: "That user no longer exists." };

  if (!parsed.data.isActive) {
    // Locking yourself out is never what you meant.
    if (target.id === actor.id) {
      return { ok: false, error: "You cannot deactivate your own account." };
    }
    if (target.role === "ADMIN") {
      const others = await countOtherActiveAdmins(target.id);
      if (others === 0) {
        return {
          ok: false,
          error: "This is the last active administrator. Promote someone else first.",
        };
      }
    }
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { isActive: parsed.data.isActive },
    });

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "UPDATE",
      entityType: "User",
      entityId: target.id,
      summary: parsed.data.isActive
        ? `Reactivated ${target.name} (${target.email}).`
        : `Deactivated ${target.name} (${target.email}).`,
      changes: { isActive: { from: target.isActive, to: parsed.data.isActive } },
      tx,
    });
  });

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

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS) },
    });

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
  });

  // Any failed attempts that locked the account are no longer relevant.
  await db.loginAttempt.deleteMany({ where: { email: target.email, success: false } });

  revalidatePath("/settings/users");
  return { ok: true, message: `Password reset for ${target.name}.` };
}
