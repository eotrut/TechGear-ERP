"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag } from "lucide-react";

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
import { formatAmount } from "@/lib/money";

import { applyBulkPriceAction, previewBulkPriceAction } from "../actions";
import type { BulkPriceMode, BulkPriceRounding } from "../schemas";

/**
 * Bulk price update.
 *
 * Nothing is written until the preview has been seen: the dialog asks the
 * server what the rule would do, shows every affected SKU with its old and new
 * price, and only then offers to apply it. A price list is the sort of thing
 * that is very hard to put back.
 */

type Mode = { value: BulkPriceMode; label: string; hint: string; suffix: string };

const MODES: [Mode, ...Mode[]] = [
  {
    value: "percent",
    label: "Change by percent",
    hint: "5 raises by 5%, -10 cuts by 10%",
    suffix: "%",
  },
  {
    value: "amount",
    label: "Change by amount",
    hint: "250 adds PHP 250.00 to each price",
    suffix: "PHP",
  },
  {
    value: "set",
    label: "Set to amount",
    hint: "Every selected price becomes this",
    suffix: "PHP",
  },
];

const ROUNDINGS: { value: BulkPriceRounding; label: string }[] = [
  { value: "none", label: "Leave centavos as they fall" },
  { value: "peso", label: "Round to the nearest peso" },
  { value: "nearest5", label: "Round to the nearest 5 pesos" },
  { value: "charm", label: "End every price in .95" },
];

type Preview = {
  changes: { sku: string; product: string; option: string; from: number; to: number }[];
  unchanged: number;
};

const selectClass =
  "h-8 w-full rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

export function BulkPriceDialog({
  productIds,
  onDone,
}: {
  productIds: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BulkPriceMode>("percent");
  const [value, setValue] = useState("");
  const [rounding, setRounding] = useState<BulkPriceRounding>("peso");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const activeMode: Mode = MODES.find((candidate) => candidate.value === mode) ?? MODES[0];

  function reset() {
    setPreview(null);
    setError(null);
  }

  function runPreview() {
    setError(null);
    startTransition(async () => {
      const result = await previewBulkPriceAction({ productIds, mode, value, rounding });
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      setPreview({ changes: result.changes, unchanged: result.unchanged });
    });
  }

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await applyBulkPriceAction({ productIds, mode, value, rounding });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setPreview(null);
      setValue("");
      onDone();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <Tag aria-hidden />
          Update prices
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk price update</DialogTitle>
          <DialogDescription>
            Applies to every active variant of the <span data-numeric>{productIds.length}</span>{" "}
            selected product
            {productIds.length === 1 ? "" : "s"}. Each change is written to the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-mode">Rule</Label>
            <select
              id="bulk-mode"
              className={selectClass}
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as BulkPriceMode);
                reset();
              }}
            >
              {MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-value">
              {activeMode.suffix === "%" ? "Percent" : "Amount in pesos"}
            </Label>
            <Input
              id="bulk-value"
              inputMode="decimal"
              value={value}
              placeholder={activeMode.suffix === "%" ? "5" : "250.00"}
              onChange={(event) => {
                setValue(event.target.value);
                reset();
              }}
              className="h-8 font-mono text-body-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-rounding">Rounding</Label>
            <select
              id="bulk-rounding"
              className={selectClass}
              value={rounding}
              onChange={(event) => {
                setRounding(event.target.value as BulkPriceRounding);
                reset();
              }}
            >
              {ROUNDINGS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-caption text-ink-subtle">{activeMode.hint}</p>

        {error ? (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        ) : null}

        {preview ? (
          preview.changes.length === 0 ? (
            <p className="rounded-md border border-hairline bg-surface-1 px-3 py-2 text-body-sm text-ink-muted">
              That rule leaves all {preview.unchanged} prices exactly where they are.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-hairline">
              <table className="w-full text-body-sm">
                <thead className="sticky top-0 bg-surface-1">
                  <tr className="border-b border-hairline">
                    <th className="px-3 py-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      SKU
                    </th>
                    <th className="px-3 py-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      Variant
                    </th>
                    <th className="px-3 py-1.5 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      Now
                    </th>
                    <th className="px-3 py-1.5 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changes.map((change) => (
                    <tr key={change.sku} className="border-b border-hairline last:border-b-0">
                      <td className="px-3 py-1.5 font-mono text-[12px] text-ink-muted">
                        {change.sku}
                      </td>
                      <td className="px-3 py-1.5 text-ink-muted">
                        <span className="text-ink">{change.product}</span>
                        <span className="text-ink-subtle"> {change.option}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-ink-subtle line-through">
                        {formatAmount(change.from)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-medium text-ink">
                        {formatAmount(change.to)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {preview && preview.changes.length > 0 ? (
          <p className="text-caption text-ink-subtle">
            <span data-numeric>{preview.changes.length}</span> price
            {preview.changes.length === 1 ? "" : "s"} change,{" "}
            <span data-numeric>{preview.unchanged}</span> stay the same.
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={runPreview} disabled={isPending || value === ""}>
            {isPending && !preview ? "Checking" : "Preview"}
          </Button>
          <Button
            variant="primary"
            onClick={apply}
            disabled={isPending || !preview || preview.changes.length === 0}
          >
            {isPending && preview ? "Applying" : "Apply to prices"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
