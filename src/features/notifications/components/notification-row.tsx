"use client";

import Link from "next/link";
import type { NotificationType } from "@prisma/client";
import {
  CalendarClock,
  LifeBuoy,
  PackageCheck,
  PackageMinus,
  PackageX,
  ShieldCheck,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { NotificationItem } from "../queries";

/**
 * One notification, as the tray and the centre both render it. Tone comes
 * from the status palette the rest of the app already speaks: an empty shelf
 * is critical, a low one is a warning, stock arriving is good news.
 */

const TYPE_ICON: Record<NotificationType, { icon: LucideIcon; tone: string; label: string }> = {
  LOW_STOCK: { icon: PackageMinus, tone: "text-warning", label: "Low stock" },
  OUT_OF_STOCK: { icon: PackageX, tone: "text-danger", label: "Out of stock" },
  NEW_TICKET: { icon: LifeBuoy, tone: "text-info", label: "New ticket" },
  OVERDUE_TASK: { icon: CalendarClock, tone: "text-warning", label: "Overdue task" },
  PO_RECEIVED: { icon: PackageCheck, tone: "text-success", label: "Stock received" },
  WARRANTY_CLAIM: { icon: ShieldCheck, tone: "text-info", label: "Warranty claim" },
  ORDER_PLACED: { icon: ShoppingCart, tone: "text-info", label: "Order placed" },
};

export function NotificationRow({
  item,
  onOpen,
  dense = false,
}: {
  item: NotificationItem;
  /** Called before navigating, to mark it read. */
  onOpen: (item: NotificationItem) => void;
  dense?: boolean;
}) {
  const kind = TYPE_ICON[item.type];
  const Icon = kind.icon;

  const content = (
    <>
      {/* Unread carries the same inset bar as the active nav item. */}
      {!item.read ? (
        <span
          className="absolute top-3 bottom-3 left-0 w-0.5 rounded-r-full bg-accent-fill"
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-2",
          kind.tone,
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              "truncate text-body-sm",
              item.read ? "text-ink-muted" : "font-medium text-ink",
            )}
          >
            {item.title}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-ink-subtle">{item.age}</span>
        </span>
        <span className={cn("text-caption text-ink-subtle", dense && "line-clamp-2")}>
          {item.body}
        </span>
        <span className="sr-only">
          {kind.label}
          {item.read ? "" : ", unread"}
        </span>
      </span>
    </>
  );

  const className = cn(
    "relative flex items-start gap-3 px-3 text-left transition-colors hover:bg-surface-2",
    "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-fill",
    dense ? "py-2.5" : "py-3",
  );

  if (!item.link) {
    return (
      <button type="button" className={cn(className, "w-full")} onClick={() => onOpen(item)}>
        {content}
      </button>
    );
  }

  return (
    <Link href={item.link} className={className} onClick={() => onOpen(item)}>
      {content}
    </Link>
  );
}
