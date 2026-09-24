"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { refreshSegmentsAction } from "../actions";

/** Recompute every segment now, rather than waiting for the nightly run. */
export function RefreshSegmentsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      title="Recompute VIP, Repeat, New and Dormant from order history"
      onClick={() =>
        startTransition(async () => {
          const result = await refreshSegmentsAction();
          if (result.ok) {
            toast.success(result.message ?? "Segments refreshed.");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      <RefreshCw aria-hidden className={cn(isPending && "animate-spin")} />
      {isPending ? "Refreshing" : "Refresh segments"}
    </Button>
  );
}
