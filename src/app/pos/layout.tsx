import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { requireUser } from "@/lib/rbac/guard";

/**
 * The register has its own shell: no sidebar, one slim bar, and the whole
 * screen for the grid and the cart, because it runs on a counter tablet all
 * day. The way back to the rest of the app is one tap, top left.
 */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-canvas px-2 sm:px-4">
        <Button asChild variant="ghost" className="h-10 px-2.5 text-ink-muted">
          <Link href="/orders" aria-label="Leave the register">
            <ArrowLeft aria-hidden />
            <span className="hidden sm:inline">Orders</span>
          </Link>
        </Button>
        <span className="mx-1 hidden h-5 w-px bg-hairline sm:block" aria-hidden />
        <Link href="/pos" className="flex items-center gap-2.5 rounded-md px-1 py-1">
          <BrandMark />
          <span className="text-body font-semibold tracking-[-0.1px] text-ink">Register</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <UserMenu name={user.name} email={user.email} role={user.role} />
        </div>
      </header>
      <main id="content" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
