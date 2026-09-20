import type { Role } from "@prisma/client";

import { MATRIX, type Access, type Permission } from "./matrix";

/**
 * Pure permission predicates. No database, no request context, no side effects,
 * so these are safe to call from the Edge middleware, from server actions, from
 * server components and from unit tests alike.
 */

/** Does this role have any access at all to this permission? */
export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return MATRIX[permission][role] !== undefined;
}

/**
 * How much access does this role have?
 *
 * "own" means the caller MUST scope the query to records the user owns. It is
 * returned rather than silently treated as "all" so that forgetting to scope is
 * a visible omission at the call site rather than an invisible privilege
 * escalation.
 */
export function scopeFor(role: Role | null | undefined, permission: Permission): Access | null {
  if (!role) return null;
  return MATRIX[permission][role] ?? null;
}

/** Does this role have unrestricted access, rather than own-records-only? */
export function canAll(role: Role | null | undefined, permission: Permission): boolean {
  return scopeFor(role, permission) === "all";
}

/** Is this role limited to its own records for this permission? */
export function isOwnScoped(role: Role | null | undefined, permission: Permission): boolean {
  return scopeFor(role, permission) === "own";
}

/** True when the role satisfies every permission listed. */
export function canAllOf(role: Role | null | undefined, permissions: Permission[]): boolean {
  return permissions.every((permission) => can(role, permission));
}

/** True when the role satisfies at least one of the permissions listed. */
export function canAnyOf(role: Role | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

/** Every permission a role holds. Used by the generated documentation. */
export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(MATRIX) as Permission[]).filter((permission) => can(role, permission));
}
