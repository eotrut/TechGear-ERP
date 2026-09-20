import { db } from "@/lib/db";

/**
 * Login rate limiting, required by SPEC section 5.1.
 *
 * Backed by the LoginAttempt table rather than an in-memory counter, because a
 * counter in process memory resets on every deploy and is not shared between
 * instances, which makes it decorative rather than a control.
 *
 * Two independent limits:
 *   per email  stops someone grinding one account's password
 *   per IP     stops someone spraying one password across many accounts
 *
 * Both count only failures, so a busy shared terminal where people log in
 * successfully all day is never locked out.
 */

export const LOGIN_WINDOW_MINUTES = 15;
export const MAX_FAILURES_PER_EMAIL = 5;
export const MAX_FAILURES_PER_IP = 20;

export type RateLimitResult =
  { allowed: true } | { allowed: false; reason: "email" | "ip"; retryAfterSeconds: number };

function windowStart(): Date {
  return new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000);
}

export async function checkLoginRateLimit(
  email: string,
  ipAddress: string,
): Promise<RateLimitResult> {
  const since = windowStart();
  const normalisedEmail = email.trim().toLowerCase();

  const [emailFailures, ipFailures] = await Promise.all([
    db.loginAttempt.findMany({
      where: { email: normalisedEmail, success: false, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.loginAttempt.count({
      where: { ipAddress, success: false, createdAt: { gte: since } },
    }),
  ]);

  if (emailFailures.length >= MAX_FAILURES_PER_EMAIL) {
    // The lock lifts once the oldest failure ages out of the window.
    const oldest = emailFailures[0]?.createdAt ?? since;
    const unlocksAt = oldest.getTime() + LOGIN_WINDOW_MINUTES * 60_000;
    return {
      allowed: false,
      reason: "email",
      retryAfterSeconds: Math.max(1, Math.ceil((unlocksAt - Date.now()) / 1000)),
    };
  }

  if (ipFailures >= MAX_FAILURES_PER_IP) {
    return {
      allowed: false,
      reason: "ip",
      retryAfterSeconds: LOGIN_WINDOW_MINUTES * 60,
    };
  }

  return { allowed: true };
}

export async function recordLoginAttempt(
  email: string,
  ipAddress: string,
  success: boolean,
): Promise<void> {
  try {
    await db.loginAttempt.create({
      data: { email: email.trim().toLowerCase(), ipAddress, success },
    });
  } catch (error) {
    // Never let bookkeeping block a legitimate sign-in.
    console.error("Failed to record login attempt", error);
  }
}

/** Clear an account's failures after a successful sign-in, lifting any lock. */
export async function clearLoginFailures(email: string): Promise<void> {
  try {
    await db.loginAttempt.deleteMany({
      where: {
        email: email.trim().toLowerCase(),
        success: false,
        createdAt: { gte: windowStart() },
      },
    });
  } catch (error) {
    console.error("Failed to clear login failures", error);
  }
}
