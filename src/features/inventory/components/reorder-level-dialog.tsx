"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { updateReorderLevelAction } from "../actions";

/**
 * Set a variant's reorder point and batch size from where the alert is seen,
 * rather than sending a warehouse lead to the product editor they cannot use.
 * Guarded server-side by `inventory.setReorderLevels`.
 */
export function ReorderLevelDialog({
  variantId,
  sku,
  reorderLevel,
  reorderQty,
}: {
  variantId: string;
  sku: string;
  reorderLevel: number;
  reorderQty: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(String(reorderLevel));
  const [batch, setBatch] = useState(String(reorderQty));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateReorderLevelAction({
        variantId,
        reorderLevel: Number(level),
        reorderQty: Number(batch),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setLevel(String(reorderLevel));
          setBatch(String(reorderQty));
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reorder point for ${sku}`}
          title="Reorder point"
        >
          <SlidersHorizontal aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reorder point</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{sku}</span> alerts at or below the reorder point, and the
            suggestion orders whole batches until stock clears it again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`level-${variantId}`}>Reorder point</Label>
            <Input
              id={`level-${variantId}`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="h-8 font-mono text-body-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`batch-${variantId}`}>Order batch</Label>
            <Input
              id={`batch-${variantId}`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={batch}
              onChange={(event) => setBatch(event.target.value)}
              className="h-8 font-mono text-body-sm"
            />
          </div>
        </div>

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
            variant="primary"
            onClick={save}
            disabled={isPending || level === "" || batch === ""}
          >
            {isPending ? "Saving" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
