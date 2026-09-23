"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, ArchiveX } from "lucide-react";

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

import { archiveProductAction } from "../actions";

/**
 * Archive is the only destructive catalogue action, and it is soft: orders,
 * movements and reports still resolve the product afterwards. The dialog says
 * so, because "delete" that is really "hide" is worth spelling out.
 */
export function ArchiveProductButton({
  productId,
  name,
  archived,
}: {
  productId: string;
  name: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await archiveProductAction({ productId, archived: !archived });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={archived ? "secondary" : "ghost"} size="sm">
          {archived ? <ArchiveRestore aria-hidden /> : <ArchiveX aria-hidden />}
          {archived ? "Restore" : "Archive"}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{archived ? `Restore ${name}?` : `Archive ${name}?`}</DialogTitle>
          <DialogDescription>
            {archived
              ? "It goes back into the catalogue and its variants can be sold again once you reactivate them."
              : "It leaves the catalogue and the POS, and every variant stops being sellable. Order history, stock movements and reports keep working, and you can restore it at any time."}
          </DialogDescription>
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
          <Button variant={archived ? "primary" : "danger"} onClick={confirm} disabled={isPending}>
            {isPending ? "Working" : archived ? "Restore product" : "Archive product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
