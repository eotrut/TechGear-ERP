"use client";

import Link from "next/link";
import { LogOut, UserCog } from "lucide-react";
import { useTransition } from "react";

import { logoutAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { roleTone, StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  const [isPending, startTransition] = useTransition();

  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Account menu for ${name}`}>
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-3 font-mono text-[10px] font-semibold text-ink-muted">
            {initials}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-body-sm font-medium text-ink">{name}</span>
          <span className="font-mono text-[11px] font-normal text-ink-subtle">{email}</span>
          <span className="pt-1">
            <StatusBadge tone={roleTone(role)}>{role.toLowerCase()}</StatusBadge>
          </span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserCog aria-hidden />
            Your account
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant="destructive"
          disabled={isPending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(() => {
              void logoutAction();
            });
          }}
        >
          <LogOut aria-hidden />
          {isPending ? "Signing out" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
