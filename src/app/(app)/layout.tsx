import { AppSidebar } from "@/components/layout/app-sidebar";
import { QueryProvider } from "@/components/layout/query-provider";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { TopBar } from "@/components/layout/top-bar";
import { Toaster } from "@/components/ui/sonner";
import { notificationSummary } from "@/features/notifications/queries";
import { CommandPaletteProvider } from "@/features/search/components/command-palette";
import { requireUser } from "@/lib/rbac/guard";

/**
 * Every authenticated page sits under here. Reading the user in the layout
 * means a signed-out or deactivated account is stopped once, at the shell,
 * rather than relying on each page to remember.
 *
 * The notification summary is read here too, so the bell's count is right on
 * first paint; after that the bell keeps itself current in the browser.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const notifications = await notificationSummary(user.id);

  return (
    <QueryProvider>
      <CommandPaletteProvider role={user.role}>
        <SidebarProvider>
          <a
            href="#content"
            className="sr-only z-50 rounded-md bg-accent-fill px-3 py-2 text-body-sm font-medium text-accent-on-fill focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
          >
            Skip to content
          </a>
          <div className="flex min-h-dvh">
            <AppSidebar role={user.role} />

            <div className="flex min-w-0 flex-1 flex-col">
              <TopBar
                user={{ name: user.name, email: user.email, role: user.role }}
                notifications={notifications}
              />
              <main
                id="content"
                tabIndex={-1}
                className="min-w-0 flex-1 px-4 py-5 outline-none lg:px-6 lg:py-6"
              >
                {children}
              </main>
            </div>
          </div>
          <Toaster />
        </SidebarProvider>
      </CommandPaletteProvider>
    </QueryProvider>
  );
}
