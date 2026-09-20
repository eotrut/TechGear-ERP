import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { TopBar } from "@/components/layout/top-bar";
import { requireUser } from "@/lib/rbac/guard";

/**
 * Every authenticated page sits under here. Reading the user in the layout
 * means a signed-out or deactivated account is stopped once, at the shell,
 * rather than relying on each page to remember.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <SidebarProvider>
      <div className="flex min-h-dvh">
        <AppSidebar role={user.role} />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar user={{ name: user.name, email: user.email, role: user.role }} />
          <main id="content" className="min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
