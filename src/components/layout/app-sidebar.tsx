"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";

import { BrandMark } from "@/components/layout/brand-mark";
import { useSidebar } from "@/components/layout/sidebar-context";
import { Button } from "@/components/ui/button";
import type { Role } from "@prisma/client";

import { findActiveItem, navigationFor } from "@/lib/navigation";
import { cn } from "@/lib/utils";

function SidebarNav({ pathname, role }: { pathname: string; role: Role }) {
  const activeItem = findActiveItem(pathname);
  // Filtering happens here rather than on the server because nav items carry
  // icon components, which cannot cross the server boundary. This is cosmetic
  // either way: middleware and every page enforce the real check.
  const groups = navigationFor(role);

  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-4">
      {groups.map((group, groupIndex) => (
        <div key={group.label ?? "root"} className={cn(groupIndex > 0 && "mt-5")}>
          {group.label ? (
            <h2 className="px-2.5 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
              {group.label}
            </h2>
          ) : null}

          <ul className="flex flex-col gap-px">
            {group.items.map((item) => {
              const isActive = activeItem?.href === item.href;
              const Icon = item.icon;

              return (
                <li key={item.href} className="relative">
                  {isActive ? (
                    <span
                      className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-fill"
                      aria-hidden
                    />
                  ) : null}
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-md px-2.5",
                      "text-body-sm transition-colors duration-150",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-fill",
                      isActive
                        ? "bg-surface-3 font-medium text-ink"
                        : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", isActive ? "text-accent-strong" : "")}
                      aria-hidden
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 px-3.5">
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
      >
        <BrandMark />
        <span className="flex flex-col leading-none">
          <span className="text-body font-semibold tracking-[-0.011em] text-ink">TechGear</span>
          <span className="mt-0.5 text-[11px] tracking-[0.04em] text-ink-subtle uppercase">
            Philippines
          </span>
        </span>
      </Link>

      {onClose ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto lg:hidden"
          onClick={onClose}
          aria-label="Close navigation"
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

export function AppSidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const { isOpen, close } = useSidebar();

  return (
    <>
      {/* Desktop: part of the layout flow. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-hairline bg-sidebar lg:flex">
        <SidebarHeader />
        <SidebarNav pathname={pathname} role={role} />
      </aside>

      {/* Mobile: overlay drawer. */}
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          isOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!isOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-scrim transition-opacity duration-150",
            isOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={close}
        />
        <aside
          className={cn(
            "absolute inset-y-0 left-0 flex w-64 flex-col border-r border-hairline bg-sidebar",
            "transition-transform duration-200 ease-out",
            isOpen ? "translate-x-0" : "-translate-x-full",
          )}
          // Keep the drawer out of the tab order and the a11y tree when closed.
          inert={!isOpen}
        >
          <SidebarHeader onClose={close} />
          <SidebarNav pathname={pathname} role={role} />
        </aside>
      </div>
    </>
  );
}
