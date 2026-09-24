import type { ActivityType } from "@prisma/client";
import { CalendarClock, ListTodo, Mail, Phone, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { ACTIVITY_TYPE_LABEL } from "../schemas";

const ICONS: Record<ActivityType, LucideIcon> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: CalendarClock,
  TASK: ListTodo,
};

/** The activity type as a small keycap-framed glyph, labelled for screen readers. */
export function ActivityIcon({ type, className }: { type: ActivityType; className?: string }) {
  const Icon = ICONS[type];
  return (
    <span
      title={ACTIVITY_TYPE_LABEL[type]}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-sm border border-hairline bg-surface-2 text-ink-muted",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{ACTIVITY_TYPE_LABEL[type]}</span>
    </span>
  );
}
