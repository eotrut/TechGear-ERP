import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { roleTone, StatusBadge } from "@/components/ui/status-badge";
import { ChangePasswordForm, ProfileForm } from "@/features/auth/components/account-forms";
import { db } from "@/lib/db";
import { formatRelative } from "@/lib/format";
import { requirePermission } from "@/lib/rbac/guard";
import { permissionsFor } from "@/lib/rbac/can";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const { user } = await requirePermission("account.manageOwn");

  const record = await db.user.findUnique({
    where: { id: user.id },
    select: {
      name: true,
      email: true,
      phone: true,
      role: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  if (!record) return null;

  const granted = permissionsFor(record.role);

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Your account"
        description="Update how you appear to colleagues and change your password."
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border border-hairline bg-surface-1 p-4">
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
              Signed in as
            </div>
            <div className="mt-1 font-mono text-body text-ink">{record.email}</div>
          </div>
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
              Role
            </div>
            <div className="mt-1.5">
              <StatusBadge tone={roleTone(record.role)}>{record.role.toLowerCase()}</StatusBadge>
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
              Permissions
            </div>
            <div className="mt-1 font-mono text-body text-ink" data-numeric>
              {granted.length}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
              Last sign-in
            </div>
            <div className="mt-1 font-mono text-body text-ink">
              {formatRelative(record.lastLoginAt)}
            </div>
          </div>
        </div>

        <ProfileForm name={record.name} phone={record.phone} />
        <ChangePasswordForm />
      </div>
    </div>
  );
}
