import type { Role } from "@prisma/client";
import { forbidden, unauthorized } from "next/navigation";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

import { can, scopeFor } from "./can";
import type { Access, Permission } from "./matrix";

/**
 * Server-side authorization. Every protected page, server action and route
 * handler goes through here.
 *
 * The important detail is that this re-reads the user from the database rather
 * than trusting the JWT. The token carries a role so that Edge middleware can
 * do a cheap first pass, but a token is a snapshot: it still says ADMIN for up
 * to eight hours after an admin demotes someone. Decision D-12 in docs/PLAN.md.
 * A deactivated or demoted user is therefore stopped at their next action, not
 * at their next login.
 */

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export class AuthorizationError extends Error {
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "AuthenticationError";
  }
}

/**
 * The signed-in user, read fresh from the database.
 *
 * Returns null when there is no session, when the account has been deleted
 * since the token was issued, or when it has been deactivated.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  if (!user || !user.isActive) return null;

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** The current user, or a 401 page. For pages and server components. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) unauthorized();
  return user;
}

/**
 * Assert a permission, rendering the 403 page if it is missing. Use in pages
 * and server components.
 *
 * Returns both the user and the access level, so a caller granted "own" has the
 * scope in hand and cannot forget that it exists.
 */
export async function requirePermission(
  permission: Permission,
): Promise<{ user: CurrentUser; access: Access }> {
  const user = await requireUser();
  const access = scopeFor(user.role, permission);
  if (!access) forbidden();
  return { user, access };
}

/**
 * Assert a permission inside a server action, throwing instead of rendering.
 *
 * Actions return values to the client, so they need an error to catch and turn
 * into a message, not a navigation. Never omit this call: the UI hiding a
 * button is a convenience, never a control.
 */
export async function authorizeAction(
  permission: Permission,
): Promise<{ user: CurrentUser; access: Access }> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();

  const access = scopeFor(user.role, permission);
  if (!access) throw new AuthorizationError(permission);

  return { user, access };
}

/**
 * Assert a permission over a specific record.
 *
 * When the role's access is "own", the record's owner must be the caller. This
 * is the check that makes the "own" cells in the matrix real rather than
 * advisory, so anything acting on a single record should use it.
 */
export async function authorizeRecord(
  permission: Permission,
  ownerId: string | null | undefined,
): Promise<{ user: CurrentUser; access: Access }> {
  const { user, access } = await authorizeAction(permission);
  if (access === "own" && ownerId !== user.id) {
    throw new AuthorizationError(permission);
  }
  return { user, access };
}

/** Non-throwing check for conditionally rendering UI. */
export async function currentUserCan(permission: Permission): Promise<boolean> {
  const user = await getCurrentUser();
  return can(user?.role, permission);
}
