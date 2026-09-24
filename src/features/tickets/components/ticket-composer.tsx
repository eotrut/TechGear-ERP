"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { addCommentAction } from "../actions";

/**
 * Reply to the customer, or leave a note only staff can see. The two modes
 * look different on purpose: a note written in the reply box and sent to a
 * customer is the one support mistake that cannot be taken back.
 */
export function TicketComposer({
  ticketId,
  canNote,
  closed,
  firstResponsePending,
}: {
  ticketId: string;
  canNote: boolean;
  closed: boolean;
  firstResponsePending: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (closed) {
    return (
      <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-3 text-body-sm text-ink-subtle">
        This ticket is closed. Reopen it to add to the thread.
      </p>
    );
  }

  const internal = mode === "note";

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addCommentAction({ ticketId, body, internal });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      toast.success(result.message ?? "Posted.");
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        internal ? "border-warning/40 bg-warning-wash" : "border-hairline bg-surface-1",
      )}
    >
      <div role="tablist" aria-label="Message type" className="flex items-center gap-1">
        {(
          [
            ["reply", "Reply to customer"],
            ["note", "Internal note"],
          ] as const
        ).map(([value, label]) =>
          value === "note" && !canNote ? null : (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-body-sm transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
                mode === value ? "bg-canvas text-ink" : "text-ink-subtle hover:text-ink",
              )}
            >
              {value === "note" ? <Lock className="size-3.5" aria-hidden /> : null}
              {label}
            </button>
          ),
        )}
        {!internal && firstResponsePending ? (
          <span className="ml-auto text-caption text-ink-subtle">
            This will be the first response
          </span>
        ) : null}
      </div>
      <label htmlFor="ticket-reply" className="sr-only">
        {internal ? "Internal note" : "Reply"}
      </label>
      <Textarea
        id="ticket-reply"
        rows={4}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && body.trim().length > 1) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={
          internal
            ? "Only the team sees this. Courier references, stock checks, what to try next."
            : "Write to the customer. They see this."
        }
        className="bg-canvas"
      />
      {error ? (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-ink-subtle">
          <kbd className="font-mono text-[11px]">Ctrl</kbd> +{" "}
          <kbd className="font-mono text-[11px]">Enter</kbd> to send
        </span>
        <Button
          variant={internal ? "secondary" : "primary"}
          size="sm"
          disabled={isPending || body.trim().length < 2}
          onClick={submit}
        >
          {internal ? <Lock aria-hidden /> : <Send aria-hidden />}
          {isPending ? "Posting" : internal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </div>
  );
}
