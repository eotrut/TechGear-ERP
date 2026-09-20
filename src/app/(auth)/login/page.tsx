import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/layout/brand-mark";
import { LoginForm } from "@/features/auth/components/login-form";
import { getCurrentUser } from "@/lib/rbac/guard";

export const metadata: Metadata = {
  title: "Sign in",
};

const DEMO_ACCOUNTS = [
  { role: "Admin", email: "admin@techgear.ph" },
  { role: "Manager", email: "manager@techgear.ph" },
  { role: "Sales", email: "sales@techgear.ph" },
  { role: "Warehouse", email: "warehouse@techgear.ph" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Already signed in: no reason to show the form again.
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const { next } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <BrandMark className="mb-3 size-9 rounded-[11px] text-[15px]" />
          <h1 className="text-title text-ink">TechGear ERP</h1>
          <p className="mt-1 text-body-sm text-ink-subtle">
            Sign in to manage inventory, orders and customers.
          </p>
        </div>

        <div className="rounded-lg border border-hairline bg-surface-1 p-5">
          <LoginForm next={next} />
        </div>

        {/* This is a portfolio demo, so the accounts are listed on purpose. */}
        <div className="mt-5 rounded-lg border border-dashed border-hairline p-4">
          <h2 className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
            Demo accounts
          </h2>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.email} className="flex items-baseline justify-between gap-3">
                <span className="text-body-sm text-ink-muted">{account.role}</span>
                <span className="font-mono text-[12px] text-ink">{account.email}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-ink-subtle">
            Password for all four: <span className="font-mono text-ink">techgear123</span>
          </p>
        </div>
      </div>
    </div>
  );
}
