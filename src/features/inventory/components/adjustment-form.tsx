"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { createAdjustmentAction, searchVariantsAction, variantPositionsAction } from "../actions";
import type { VariantPick, WarehouseOption } from "../queries";
import {
  ADJUSTMENT_REASON_META,
  ADJUSTMENT_REASONS,
  adjustmentSchema,
  type AdjustmentInput,
} from "../schemas";
import { VariantPicker } from "./variant-picker";

/**
 * New stock adjustment.
 *
 * Two ways to enter a line. "Change by" records a movement ("-2 damaged").
 * "Counted" records what is on the shelf after a count, and the server works
 * out the change against the live position under the row lock, so a sale
 * that happens while this form is open cannot make the count wrong. The
 * preview column here is a courtesy; the server is the one that decides.
 */

type Mode = AdjustmentInput["lines"][number]["mode"];

const selectClass =
  "h-8 w-full rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-caption text-danger">
      {message}
    </p>
  );
}

export function AdjustmentForm({
  warehouses,
  defaultWarehouseId,
  initialLines,
}: {
  warehouses: WarehouseOption[];
  defaultWarehouseId: string;
  initialLines: VariantPick[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("delta");
  const [positions, setPositions] = useState<Record<string, VariantPick>>(() =>
    Object.fromEntries(initialLines.map((line) => [line.id, line])),
  );

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<AdjustmentInput>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: {
      warehouseId: defaultWarehouseId,
      reason: "COUNT_CORRECTION",
      note: "",
      lines: initialLines.map((line) => ({ variantId: line.id, mode: "delta", quantity: -1 })),
    },
  });

  const lines = useFieldArray({ control, name: "lines" });
  const warehouseId = useWatch({ control, name: "warehouseId" });
  const reason = useWatch({ control, name: "reason" });
  const values = useWatch({ control, name: "lines" });
  const meta = ADJUSTMENT_REASON_META[reason];

  function switchMode(next: Mode) {
    setMode(next);
    getValues("lines").forEach((line, index) => {
      setValue(`lines.${index}.mode`, next);
      // A count starts from what the system believes is there; a change from zero.
      const position = positions[line.variantId];
      setValue(`lines.${index}.quantity`, next === "count" ? (position?.onHand ?? 0) : -1, {
        shouldValidate: false,
      });
    });
  }

  function changeWarehouse(next: string) {
    const ids = getValues("lines").map((line) => line.variantId);
    if (ids.length === 0) return;
    // Positions differ by warehouse, so refresh what each line shows.
    startTransition(async () => {
      const result = await variantPositionsAction({ ids, warehouseId: next });
      if (result.ok) setPositions(Object.fromEntries(result.results.map((row) => [row.id, row])));
    });
  }

  function addLine(pick: VariantPick) {
    setPositions((current) => ({ ...current, [pick.id]: pick }));
    lines.append({ variantId: pick.id, mode, quantity: mode === "count" ? pick.onHand : -1 });
  }

  function onSubmit(input: AdjustmentInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await createAdjustmentAction(input);
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      router.push(result.id ? `/inventory/adjustments/${result.id}` : "/inventory/adjustments");
      router.refresh();
    });
  }

  const warehouseField = register("warehouseId");
  const lineErrors = errors.lines;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <section className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 md:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="warehouseId">Warehouse</Label>
          <select
            id="warehouseId"
            className={selectClass}
            {...warehouseField}
            onChange={(event) => {
              void warehouseField.onChange(event);
              changeWarehouse(event.target.value);
            }}
          >
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id} disabled={!warehouse.isActive}>
                {warehouse.code}, {warehouse.name}
                {warehouse.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </select>
          <FieldError message={errors.warehouseId?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">Reason</Label>
          <select id="reason" className={selectClass} {...register("reason")}>
            {ADJUSTMENT_REASONS.map((value) => (
              <option key={value} value={value}>
                {ADJUSTMENT_REASON_META[value].label}
              </option>
            ))}
          </select>
          <p className="text-caption text-ink-subtle">
            {meta.hint}
            {meta.direction === "decrease" ? " Removes stock only." : ""}
          </p>
          <FieldError message={errors.reason?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note">
            Note{" "}
            <span className="font-normal text-ink-subtle">
              {meta.noteRequired ? "(required)" : "(optional)"}
            </span>
          </Label>
          <textarea
            id="note"
            rows={2}
            placeholder="What happened, where, and who found it"
            className="min-h-16 rounded-md border border-input bg-canvas px-3 py-2 text-body-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
            {...register("note")}
          />
          <FieldError message={errors.note?.message} />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-section text-ink">Lines</h2>
            <p className="mt-0.5 text-body-sm text-ink-subtle">
              {mode === "delta"
                ? "Enter the change for each item: -2 removes two units, 3 adds three."
                : "Enter what you counted on the shelf. The change is worked out when you save."}
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="Entry mode"
            className="flex rounded-md border border-hairline p-0.5"
          >
            {(
              [
                ["delta", "Change by"],
                ["count", "Counted"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => switchMode(value)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-caption font-medium transition-colors",
                  mode === value ? "bg-surface-3 text-ink" : "text-ink-subtle hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {lines.fields.length > 0 ? (
          <div className="relative overflow-x-auto rounded-md border border-hairline bg-canvas">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface-1">
                  <th className="px-3 py-2 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    Item
                  </th>
                  <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:table-cell">
                    On hand
                  </th>
                  <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:table-cell">
                    Reserved
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    {mode === "delta" ? "Change" : "Counted"}
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    After
                  </th>
                  <th className="w-9 px-1 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.fields.map((field, index) => {
                  const variantId = values?.[index]?.variantId ?? field.variantId;
                  const position = positions[variantId];
                  const raw = values?.[index]?.quantity;
                  const quantity = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
                  const onHand = position?.onHand ?? 0;
                  const reserved = position?.reserved ?? 0;
                  const after = mode === "delta" ? onHand + quantity : quantity;
                  const change = after - onHand;
                  const tooLow = after < reserved;
                  const lineError = lineErrors?.[index];

                  return (
                    <tr
                      key={field.id}
                      className="border-b border-hairline align-top last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <input type="hidden" {...register(`lines.${index}.variantId`)} />
                        <input type="hidden" {...register(`lines.${index}.mode`)} />
                        <span className="block max-w-[9rem] truncate text-ink sm:max-w-[18rem]">
                          {position?.productName ?? "Variant"}
                        </span>
                        <span className="block max-w-[9rem] truncate text-caption text-ink-subtle sm:max-w-[18rem]">
                          {position?.optionSummary}{" "}
                          <span className="font-mono text-[11px]">{position?.sku}</span>
                        </span>
                        <span className="block text-caption text-ink-subtle sm:hidden" data-numeric>
                          {onHand} on hand{reserved > 0 ? `, ${reserved} reserved` : ""}
                        </span>
                        <FieldError message={lineError?.variantId?.message} />
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-muted sm:table-cell"
                        data-numeric
                      >
                        {onHand}
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-subtle sm:table-cell"
                        data-numeric
                      >
                        {reserved}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          step={1}
                          inputMode="numeric"
                          aria-label={`${mode === "delta" ? "Change" : "Counted"} for ${position?.sku ?? "line"}`}
                          aria-invalid={lineError?.quantity ? true : undefined}
                          className="ml-auto h-8 w-20 text-right font-mono text-body-sm sm:w-24"
                          {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                        />
                        <FieldError message={lineError?.quantity?.message} />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span
                          data-numeric
                          className={cn("font-mono", tooLow ? "text-danger" : "text-ink")}
                        >
                          {after}
                        </span>
                        {mode === "count" && change !== 0 ? (
                          <span
                            className="block font-mono text-[11px] text-ink-subtle"
                            data-numeric
                          >
                            {change > 0 ? `+${change}` : change}
                          </span>
                        ) : null}
                        {tooLow ? (
                          <span className="block text-caption text-danger">below reserved</span>
                        ) : null}
                      </td>
                      <td className="px-1 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${position?.sku ?? "line"}`}
                          onClick={() => lines.remove(index)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <VariantPicker
          search={searchVariantsAction}
          warehouseId={warehouseId}
          excludeIds={(values ?? []).map((line) => line.variantId)}
          onPick={addLine}
          disabled={!warehouseId}
        />
        <FieldError message={lineErrors?.root?.message ?? lineErrors?.message} />
      </section>

      {serverError ? (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-wash px-3 py-2 text-body-sm text-danger"
        >
          {serverError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isPending || lines.fields.length === 0}>
          {isPending ? "Recording" : "Record adjustment"}
        </Button>
      </div>
    </form>
  );
}
