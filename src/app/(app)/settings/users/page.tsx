import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UserManager } from "@/features/users/components/user-manager";
import { listUsers } from "@/features/users/queries";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  // Admin only. The nav hides this for everyone else and middleware blocks the
  // route, but this is the check that actually enforces it.
  const { user } = await requirePermission("users.view");
  const users = await listUsers();

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Users"
        description="Create accounts, assign roles and deactivate people who have left. Every change here is written to the audit log."
      />
      <UserManager users={users} currentUserId={user.id} />
    </div>
  );
}
