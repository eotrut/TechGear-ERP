"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import type { NotificationDay } from "../queries";
import { NotificationRow } from "./notification-row";
import { useMarkRead } from "./use-notifications";

/** The centre's list, one hairline-ruled block per Manila day. */
export function NotificationFeed({ days }: { days: NotificationDay[] }) {
  const { markOne } = useMarkRead();

  return (
    <div className="flex flex-col gap-5">
      {days.map((day) => (
        <section key={day.key} aria-labelledby={`day-${day.key}`}>
          <h2
            id={`day-${day.key}`}
            className="pb-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase"
          >
            {day.label}
          </h2>
          <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
            {day.items.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} onOpen={markOne} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const { markAll } = useMarkRead();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      disabled={disabled || isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAll();
          if (result.ok) toast.success(result.message ?? "All caught up.");
          else toast.error(result.error);
          router.refresh();
        })
      }
    >
      <CheckCheck aria-hidden />
      {isPending ? "Marking" : "Mark all read"}
    </Button>
  );
}
