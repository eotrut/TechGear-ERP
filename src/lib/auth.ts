import bcrypt from "bcryptjs";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { authConfig } from "@/lib/auth.config";
import { recordAuditSafe } from "@/lib/audit";
import { db } from "@/lib/db";
import { checkLoginRateLimit, clearLoginFailures, recordLoginAttempt } from "@/lib/rate-limit";

/**
 * Auth.js v5 with a credentials provider, per SPEC section 2.
 *
 * Runs on the Node runtime, so bcrypt and Prisma are available here. The
 * Edge-safe half lives in auth.config.ts and is what middleware imports.
 */

const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(200),
});

/**
 * A bcrypt hash of a value nobody can supply. Compared against when the email
 * is unknown so that a missing account and a wrong password take the same time,
 * which stops the login form being used to enumerate valid addresses.
 */
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.dGvHn9MBNqvfJZ1ULaKPzJQKPu/2";

/** Distinguishable failures, so the form can say something useful. */
export class InvalidCredentials extends CredentialsSignin {
  override code = "invalid_credentials";
}
export class AccountDeactivated extends CredentialsSignin {
  override code = "account_deactivated";
}
export class TooManyAttempts extends CredentialsSignin {
  override code = "too_many_attempts";
}

function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials, request) {
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) throw new InvalidCredentials();

        const email = parsed.data.email.trim().toLowerCase();
        const ipAddress = clientIp(request);

        // Check the lock before touching the password, so a locked account
        // cannot be probed at all.
        const limit = await checkLoginRateLimit(email, ipAddress);
        if (!limit.allowed) {
          await recordLoginAttempt(email, ipAddress, false);
          await recordAuditSafe({
            actorId: null,
            actorEmail: email,
            action: "LOGIN_FAILED",
            entityType: "User",
            summary: `Sign-in blocked by rate limit (${limit.reason}).`,
            ipAddress,
            userAgent: request.headers.get("user-agent"),
          });
          throw new TooManyAttempts();
        }

        const user = await db.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            passwordHash: true,
          },
        });

        // Always run a comparison, even with no user, to keep timing flat.
        const passwordMatches = await bcrypt.compare(
          parsed.data.password,
          user?.passwordHash ?? DUMMY_HASH,
        );

        if (!user || !passwordMatches) {
          await recordLoginAttempt(email, ipAddress, false);
          await recordAuditSafe({
            actorId: user?.id ?? null,
            actorEmail: email,
            action: "LOGIN_FAILED",
            entityType: "User",
            entityId: user?.id ?? null,
            summary: "Sign-in failed: invalid email or password.",
            ipAddress,
            userAgent: request.headers.get("user-agent"),
          });
          throw new InvalidCredentials();
        }

        // The password was correct, so naming the real reason leaks nothing the
        // caller does not already know.
        if (!user.isActive) {
          await recordLoginAttempt(email, ipAddress, false);
          await recordAuditSafe({
            actorId: user.id,
            actorEmail: email,
            action: "LOGIN_FAILED",
            entityType: "User",
            entityId: user.id,
            summary: "Sign-in refused: account is deactivated.",
            ipAddress,
            userAgent: request.headers.get("user-agent"),
          });
          throw new AccountDeactivated();
        }

        await recordLoginAttempt(email, ipAddress, true);
        await clearLoginFailures(email);
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await recordAuditSafe({
          actorId: user.id,
          actorEmail: user.email,
          action: "LOGIN",
          entityType: "User",
          entityId: user.id,
          summary: `${user.name} signed in.`,
          ipAddress,
          userAgent: request.headers.get("user-agent"),
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
