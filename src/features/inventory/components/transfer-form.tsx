"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ArrowRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { createTransferAction, variantPositionsAction } from "../actions";
import type { VariantPick, WarehouseOption } from "../queries";
import { transferSchema, type TransferInput } from "../schemas";
import { VariantPicker } from "./variant-picker";

/**
 * New inter-warehouse transfer.
 *
 * Lines are picked against the source warehouse and show what it has
 * available, since that is what the dispatch draws on. Dispatch now takes the
 * stock out immediately; Save draft records the plan and moves nothing, for
 * a transfer that still has to be picked.
 */

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

export function TransferForm({
  warehouses,
  defaults,
  initialLines,
}: {
  warehouses: WarehouseOption[];
  defaults: { fromWarehouseId: string; toWarehouseId: string };
  initialLines: { pick: VariantPick; qty: number }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"draft" | "dispatch" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, VariantPick>>(() =>
    Object.fromEntries(initialLines.map((line) => [line.pick.id, line.pick])),
  );

  const {
    control,
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<TransferInput>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromWarehouseId: defaults.fromWarehouseId,
      toWarehouseId: defaults.toWarehouseId,
      note: "",
      dispatch: true,
      lines: initialLines.map((line) => ({ variantId: line.pick.id, qty: line.qty })),
    },
  });

  const lines = useFieldArray({ control, name: "lines" });
  const fromWarehouseId = useWatch({ control, name: "fromWarehouseId" });
  const values = useWatch({ control, name: "lines" });
  const active = warehouses.filter((warehouse) => warehouse.isActive);

  function changeSource(next: string) {
    const ids = getValues("lines").map((line) => line.variantId);
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await variantPositionsAction({ ids, warehouseId: next });
      if (result.ok) setPositions(Object.fromEntries(result.results.map((row) => [row.id, row])));
    });
  }

  function addLine(pick: VariantPick) {
    setPositions((current) => ({ ...current, [pick.id]: pick }));
    lines.append({ variantId: pick.id, qty: 1 });
  }

  function submit(dispatch: boolean) {
    return handleSubmit((input) => {
      setServerError(null);
      setPendingAction(dispatch ? "dispatch" : "draft");
      startTransition(async () => {
        const result = await createTransferAction({ ...input, dispatch });
        setPendingAction(null);
        if (!result.ok) {
          setServerError(result.error);
          return;
        }
        router.push(result.id ? `/inventory/transfers/${result.id}` : "/inventory/transfers");
        router.refresh();
      });
    });
  }

  const fromField = register("fromWarehouseId");
  const lineErrors = errors.lines;
  const totalUnits = (values ?? []).reduce(
    (sum, line) => sum + (Number.isFinite(line?.qty) ? line.qty : 0),
    0,
  );

  return (
    <form onSubmit={submit(true)} className="flex flex-col gap-4" noValidate>
      <section className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 md:grid-cols-[1fr_auto_1fr_1.4fr] md:items-start">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fromWarehouseId">From</Label>
          <select
            id="fromWarehouseId"
            className={selectClass}
            {...fromField}
            onChange={(event) => {
              void fromField.onChange(event);
              changeSource(event.target.value);
            }}
          >
            {active.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code}, {warehouse.name}
              </option>
            ))}
          </select>
          <FieldError message={errors.fromWarehouseId?.message} />
        </div>

        <ArrowRight
          className="hidden size-4 self-center text-ink-subtle md:mt-5 md:block"
          aria-hidden
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="toWarehouseId">To</Label>
          <select id="toWarehouseId" className={selectClass} {...register("toWarehouseId")}>
            {active.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code}, {warehouse.name}
              </option>
            ))}
          </select>
          <FieldError message={errors.toWarehouseId?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note">
            Note <span className="font-normal text-ink-subtle">(optional)</span>
          </Label>
          <Input
            id="note"
            placeholder="Why this stock is moving"
            className="h-8 text-body-sm"
            {...register("note")}
          />
          <FieldError message={errors.note?.message} />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-4">
        <div>
          <h2 className="text-section text-ink">Lines</h2>
          <p className="mt-0.5 text-body-sm text-ink-subtle">
            Available is what the source can give now: on hand less units reserved for pending
            orders.
          </p>
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
                    Available
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                    Send
                  </th>
                  <th className="hidden px-3 py-2 text-right text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase sm:table-cell">
                    Left
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
                  const available = (position?.onHand ?? 0) - (position?.reserved ?? 0);
                  const raw = values?.[index]?.qty;
                  const qty = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
                  const left = available - qty;
                  const lineError = lineErrors?.[index];

                  return (
                    <tr
                      key={field.id}
                      className="border-b border-hairline align-top last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <input type="hidden" {...register(`lines.${index}.variantId`)} />
                        <span className="block max-w-[10rem] truncate text-ink sm:max-w-[18rem]">
                          {position?.productName ?? "Variant"}
                        </span>
                        <span className="block max-w-[10rem] truncate text-caption text-ink-subtle sm:max-w-[18rem]">
                          {position?.optionSummary}{" "}
                          <span className="font-mono text-[11px]">{position?.sku}</span>
                        </span>
                        <span
                          className={cn(
                            "block text-caption sm:hidden",
                            left < 0 ? "text-danger" : "text-ink-subtle",
                          )}
                          data-numeric
                        >
                          {available} available{left < 0 ? ", not enough" : ""}
                        </span>
                        <FieldError message={lineError?.variantId?.message} />
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-muted sm:table-cell"
                        data-numeric
                      >
                        {available}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          aria-label={`Units to send of ${position?.sku ?? "line"}`}
                          aria-invalid={lineError?.qty ? true : undefined}
                          className="ml-auto h-8 w-20 text-right font-mono text-body-sm sm:w-24"
                          {...register(`lines.${index}.qty`, { valueAsNumber: true })}
                        />
                        <FieldError message={lineError?.qty?.message} />
                      </td>
                      <td className="hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell">
                        <span
                          data-numeric
                          className={cn("font-mono", left < 0 ? "text-danger" : "text-ink")}
                        >
                          {left}
                        </span>
                        {left < 0 ? (
                          <span className="block text-caption text-danger">not enough</span>
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
          warehouseId={fromWarehouseId}
          excludeIds={(values ?? []).map((line) => line.variantId)}
          onPick={addLine}
          disabled={!fromWarehouseId}
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
        {lines.fields.length > 0 ? (
          <p className="mr-auto text-body-sm text-ink-subtle">
            <span data-numeric className="font-mono text-ink">
              {totalUnits}
            </span>{" "}
            units on{" "}
            <span data-numeric className="font-mono text-ink">
              {lines.fields.length}
            </span>{" "}
            line{lines.fields.length === 1 ? "" : "s"}
          </p>
        ) : null}
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={submit(false)}
          disabled={isPending || lines.fields.length === 0}
        >
          {pendingAction === "draft" ? "Saving" : "Save draft"}
        </Button>
        <Button type="submit" variant="primary" disabled={isPending || lines.fields.length === 0}>
          {pendingAction === "dispatch" ? "Dispatching" : "Dispatch now"}
        </Button>
      </div>
    </form>
  );
}
