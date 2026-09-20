import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePermission("settings.manage");

  return (
    <div className="mx-auto w-full max-w-[1280px]">
      <PageHeader
        title="Settings"
        description="Administration for TechGear PH. Company details, tax and numbering arrive with the reporting phase."
      />

      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
        <li>
          <Link
            href="/settings/users"
            className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-fill"
          >
            <Users className="size-4 text-ink-subtle" aria-hidden />
            <span className="min-w-0">
              <span className="block text-body font-medium text-ink">Users and roles</span>
              <span className="block text-body-sm text-ink-subtle">
                Create accounts, assign roles, deactivate former staff
              </span>
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
