"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { recordAudit, recordAuditSafe, requestContext } from "@/lib/audit";
import { diffRecords } from "@/lib/audit-diff";
import { signIn, signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { authorizeAction } from "@/lib/rbac/guard";
import { LOGIN_WINDOW_MINUTES } from "@/lib/rate-limit";

import { changePasswordSchema, loginSchema, updateProfileSchema } from "../schemas";
import { hashPassword } from "../services/password";
import { safeRedirectTarget } from "../services/redirect";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Sign in. The provider in src/lib/auth.ts does the rate limiting, the constant
 * time comparison and the audit trail; this maps its failures onto a message.
 */
export async function loginAction(_previous: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const destination = safeRedirectTarget(parsed.data.next);

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;

    if (error instanceof AuthError) {
      switch (error.cause?.err?.message ?? (error as { code?: string }).code) {
        case "account_deactivated":
          return {
            ok: false,
            error: "That account has been deactivated. Ask an administrator to reactivate it.",
          };
        case "too_many_attempts":
          return {
            ok: false,
            error: `Too many failed attempts. Try again in ${LOGIN_WINDOW_MINUTES} minutes.`,
          };
        default:
          // Deliberately identical for an unknown email and a wrong password.
          return { ok: false, error: "Incorrect email or password." };
      }
    }

    throw error;
  }

  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  const context = await requestContext();
  const { user } = await authorizeAction("account.manageOwn").catch(() => ({ user: null }));

  if (user) {
    await recordAuditSafe({
      actorId: user.id,
      actorEmail: user.email,
      action: "LOGOUT",
      entityType: "User",
      entityId: user.id,
      summary: `${user.name} signed out.`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }

  await signOut({ redirectTo: "/login" });
}

export async function changePasswordAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await authorizeAction("account.manageOwn");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record) return { ok: false, error: "Your account could not be found." };

  const matches = await bcrypt.compare(parsed.data.currentPassword, record.passwordHash);
  if (!matches) {
    await recordAuditSafe({
      actorId: user.id,
      actorEmail: user.email,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      summary: "Password change refused: current password was incorrect.",
    });
    return { ok: false, error: "Your current password is not correct." };
  }

  // Hash before opening the transaction: bcrypt is deliberately slow, and the
  // row lock should not wait on it.
  const passwordHash = await hashPassword(parsed.data.newPassword);

  // The change and its audit entry commit together, like every other mutation.
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      summary: `${user.name} changed their own password.`,
      // The hash never enters the trail, only the fact that it changed.
      changes: { passwordHash: { from: "[redacted]", to: "[redacted]" } },
      tx,
    });
  });

  revalidatePath("/account");
  return { ok: true, message: "Password updated." };
}

export async function updateProfileAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { user } = await authorizeAction("account.manageOwn");

  const parsed = updateProfileSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  await db.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { name: true, phone: true },
    });
    const after = await tx.user.update({
      where: { id: user.id },
      data: { name: parsed.data.name, phone: parsed.data.phone },
      select: { name: true, phone: true },
    });
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      summary: `${after.name} updated their profile.`,
      changes: diffRecords(before, after),
      tx,
    });
  });

  revalidatePath("/account");
  return { ok: true, message: "Profile updated." };
}
