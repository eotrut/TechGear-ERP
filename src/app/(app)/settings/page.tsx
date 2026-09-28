import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronRight,
  ScrollText,
  Store,
  Tags,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import type { Permission } from "@/lib/rbac/matrix";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS: {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission: Permission;
}[] = [
  {
    href: "/settings/users",
    label: "Users and roles",
    description: "Create accounts, assign roles, reset passwords and deactivate former staff.",
    icon: Users,
    permission: "users.view",
  },
  {
    href: "/warehouses",
    label: "Warehouses",
    description: "Stock locations, their codes, and which of them are active.",
    icon: Warehouse,
    permission: "warehouses.manage",
  },
  {
    href: "/categories",
    label: "Categories",
    description: "How the catalogue is grouped on reports and the product list.",
    icon: Tags,
    permission: "taxonomy.view",
  },
  {
    href: "/brands",
    label: "Brands",
    description: "The makers TechGear carries, used for filtering and SKU prefixes.",
    icon: Store,
    permission: "taxonomy.view",
  },
  {
    href: "/audit",
    label: "Audit log",
    description: "Every sign in, price change, stock adjustment and deletion, with who and when.",
    icon: ScrollText,
    permission: "audit.view",
  },
];

export default async function SettingsPage() {
  const { user } = await requirePermission("settings.manage");
  const sections = SECTIONS.filter((section) => can(user.role, section.permission));

  return (
    <div className="mx-auto w-full max-w-[860px]">
      <PageHeader
        title="Settings"
        description="Administration for TechGear PH: who can sign in, where stock lives, how the catalogue is organised, and the record of every change."
      />

      <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-fill"
              >
                <Icon className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">{section.label}</span>
                  <span className="block text-body-sm text-ink-subtle">{section.description}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
