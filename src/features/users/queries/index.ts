import { db } from "@/lib/db";
import { requirePermission } from "@/lib/rbac/guard";

/**
 * Read paths for user management.
 *
 * The permission check lives here rather than only on the page, so a query can
 * never be reused from somewhere that forgot to check. `passwordHash` is never
 * selected.
 */
export async function listUsers() {
  await requirePermission("users.view");

  return db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });
}

export type UserListItem = Awaited<ReturnType<typeof listUsers>>[number];
