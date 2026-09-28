"use client";

import type { Role } from "@prisma/client";
import { PanelLeft } from "lucide-react";

import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { useSidebar } from "@/components/layout/sidebar-context";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import type { NotificationSummary } from "@/features/notifications/queries";
import { PaletteTrigger } from "@/features/search/components/command-palette";

export function TopBar({
  user,
  notifications,
}: {
  user: { name: string; email: string; role: Role };
  notifications: NotificationSummary;
}) {
  const { open } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-4 lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={open}
        aria-label="Open navigation"
      >
        <PanelLeft aria-hidden />
      </Button>

      <Breadcrumbs role={user.role} />

      <div className="ml-auto flex items-center gap-1">
        <div className="mr-1">
          <PaletteTrigger />
        </div>
        <NotificationBell initial={notifications} />
        <ThemeToggle />
        <UserMenu name={user.name} email={user.email} role={user.role} />
      </div>
    </header>
  );
}
