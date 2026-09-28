"use client";

import type { Role } from "@prisma/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { buildCrumbs } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function Breadcrumbs({ role }: { role: Role }) {
  const pathname = usePathname();
  const crumbs = buildCrumbs(pathname, role);

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-body-sm">
        {crumbs.map((crumb, index) => (
          <li
            key={crumb.href}
            className={cn(
              "flex min-w-0 items-center gap-1",
              // On a phone only the parent and the current page fit without
              // truncating every crumb to three letters; the rest return at sm.
              index < crumbs.length - 2 && "hidden sm:flex",
            )}
          >
            {index > 0 ? (
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-ink-subtle",
                  index === crumbs.length - 2 && "hidden sm:block",
                )}
                aria-hidden
              />
            ) : null}

            {crumb.isCurrent ? (
              <span aria-current="page" className="truncate font-medium text-ink">
                {crumb.label}
              </span>
            ) : !crumb.reachable ? (
              // A parent this role cannot open is context, not a link to a 403.
              <span className="truncate text-ink-subtle">{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate rounded-xs text-ink-subtle transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
