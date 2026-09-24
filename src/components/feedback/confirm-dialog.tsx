"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Outcome = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Confirmation for destructive actions. The action runs from the dialog, so a
 * refusal from the server (an open ticket blocking an archive) is shown right
 * where the person decided, and the dialog stays open to read it.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel = "Working",
  tone = "danger",
  onConfirm,
  onDone,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => Promise<Outcome>;
  onDone?: (message?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant={tone}
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await onConfirm();
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setOpen(false);
                onDone?.(result.message);
              })
            }
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
