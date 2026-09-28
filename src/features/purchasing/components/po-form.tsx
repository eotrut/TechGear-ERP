"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ListPlus, Send, Trash2 } from "lucide-react";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_TERMS_LABELS } from "@/features/suppliers/schemas";
import { VariantPicker } from "@/features/inventory/components/variant-picker";
import type { WarehouseOption } from "@/features/inventory/queries";
import { formatDate, manilaDayKey } from "@/lib/format";
import { formatAmount, formatPeso, parsePesoInput, toPesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  purchasablePositionsAction,
  reorderLinesAction,
  savePurchaseOrderAction,
  searchPurchasableAction,
} from "../actions";
import type { PurchasablePick, SupplierOption } from "../queries";
import { purchaseOrderSchema, type PurchaseOrderInput } from "../schemas";
import { expectedDateFor, pricePurchaseOrder } from "../services/purchase-rules";

/**
 * Raise or edit a draft purchase order.
 *
 * Lines default to the variant's last delivered cost, which is what the
 * supplier most likely still charges; the buyer overrides it from the quote.
 * The totals are previewed with the same pricing function the server uses,
 * so what this form shows is what the PO will say. Reorder suggestions for
 * the chosen supplier can be dropped in as lines in one step.
 */

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

export type PoFormLine = { pick: PurchasablePick; qty: number; unitCost: string };

/** The server's pricing, made safe for half-typed input: an overflow previews as nothing. */
function previewTotals(lines: { qty: number; unitCostCentavos: number }[], freight: number) {
  try {
    return pricePurchaseOrder(
      lines.filter((line) => line.qty > 0),
      freight,
    );
  } catch {
    return pricePurchaseOrder([], 0);
  }
}

export function PoForm({
  suppliers,
  warehouses,
  reorderIds,
  canSend,
  initial,
  now,
}: {
  suppliers: SupplierOption[];
  warehouses: WarehouseOption[];
  /** Reorder suggestions per supplier: variant ids, keyed by supplier id. */
  reorderIds: Record<string, string[]>;
  canSend: boolean;
  initial: {
    id?: string;
    poNumber?: string;
    supplierId: string;
    warehouseId: string;
    expectedDate: string;
    shipping: string;
    notes: string;
    lines: PoFormLine[];
  };
  /** Server time, so the default expected date renders the same on both sides. */
  now: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingIntent, setPendingIntent] = useState<"draft" | "send" | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, PurchasablePick>>(() =>
    Object.fromEntries(initial.lines.map((line) => [line.pick.id, line.pick])),
  );

  const {
    control,
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<PurchaseOrderInput>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      id: initial.id,
      supplierId: initial.supplierId,
      warehouseId: initial.warehouseId,
      expectedDate: initial.expectedDate,
      shipping: initial.shipping,
      notes: initial.notes,
      intent: "draft",
      lines: initial.lines.map((line) => ({
        variantId: line.pick.id,
        qty: line.qty,
        unitCost: line.unitCost,
      })),
    },
  });

  const lines = useFieldArray({ control, name: "lines" });
  const supplierId = useWatch({ control, name: "supplierId" });
  const warehouseId = useWatch({ control, name: "warehouseId" });
  const values = useWatch({ control, name: "lines" });
  const shippingText = useWatch({ control, name: "shipping" });

  const supplier = suppliers.find((candidate) => candidate.id === supplierId);
  const activeSuppliers = suppliers.filter(
    (candidate) => candidate.isActive || candidate.id === initial.supplierId,
  );
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.isActive);
  const onForm = new Set((values ?? []).map((line) => line.variantId));
  const suggestions = supplierId
    ? (reorderIds[supplierId] ?? []).filter((id) => !onForm.has(id)).length
    : 0;
  const defaultExpected = supplier ? expectedDateFor(new Date(now), supplier.leadTimeDays) : null;

  // Preview with the server's own pricing. Lines that do not parse yet count as zero.
  const previewLines = (values ?? []).map((line) => ({
    qty: Number.isSafeInteger(line?.qty) && line.qty > 0 ? line.qty : 0,
    unitCostCentavos: Math.max(0, parsePesoInput(line?.unitCost ?? "") ?? 0),
  }));
  const freight = Math.max(0, parsePesoInput(shippingText ?? "") ?? 0);
  const totals = previewTotals(previewLines, freight);
  const lineTotal = (index: number) => {
    const line = previewLines[index];
    return line ? line.qty * line.unitCostCentavos : 0;
  };

  function refreshPositions(nextWarehouseId: string) {
    const ids = getValues("lines").map((line) => line.variantId);
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await purchasablePositionsAction({ ids, warehouseId: nextWarehouseId });
      if (result.ok) setPicks(Object.fromEntries(result.results.map((row) => [row.id, row])));
    });
  }

  function addLine(pick: PurchasablePick, qty = 1) {
    setPicks((current) => ({ ...current, [pick.id]: pick }));
    lines.append({ variantId: pick.id, qty, unitCost: toPesoInput(pick.unitCostCentavos) });
  }

  function addSuggestions() {
    setNotice(null);
    startTransition(async () => {
      const result = await reorderLinesAction({ supplierId, warehouseId });
      if (!result.ok) {
        setServerError(result.error);
        return;
      }
      const onForm = new Set(getValues("lines").map((line) => line.variantId));
      const fresh = result.lines.filter((line) => !onForm.has(line.pick.id));
      for (const line of fresh) addLine(line.pick, line.qty);
      setNotice(
        fresh.length === 0
          ? "Every suggestion for this supplier is already on the order."
          : `Added ${fresh.length} suggested line${fresh.length === 1 ? "" : "s"} at the reorder quantity.`,
      );
    });
  }

  function submit(intent: "draft" | "send") {
    return handleSubmit((input) => {
      setServerError(null);
      setPendingIntent(intent);
      startTransition(async () => {
        const result = await savePurchaseOrderAction({ ...input, intent });
        setPendingIntent(null);
        if (!result.ok) {
          setServerError(result.error);
          return;
        }
        router.push(result.id ? `/purchasing/${result.id}` : "/purchasing");
        router.refresh();
      });
    });
  }

  const warehouseField = register("warehouseId");
  const lineErrors = errors.lines;
  const units = previewLines.reduce((sum, line) => sum + line.qty, 0);

  return (
    <form onSubmit={submit("draft")} className="flex flex-col gap-4" noValidate>
      <section className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 md:grid-cols-2 xl:grid-cols-4">
        <Field
          id="supplierId"
          label="Supplier"
          error={errors.supplierId?.message}
          hint={
            supplier
              ? `${supplier.leadTimeDays} day lead time, ${PAYMENT_TERMS_LABELS[
                  supplier.paymentTerms
                ].toLowerCase()}`
              : undefined
          }
        >
          <select id="supplierId" className={selectClass} {...register("supplierId")}>
            <option value="">Choose a supplier</option>
            {activeSuppliers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </Field>

        <Field id="warehouseId" label="Deliver to" error={errors.warehouseId?.message}>
          <select
            id="warehouseId"
            className={selectClass}
            {...warehouseField}
            onChange={(event) => {
              void warehouseField.onChange(event);
              refreshPositions(event.target.value);
            }}
          >
            {activeWarehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code}, {warehouse.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="expectedDate"
          label="Expected"
          error={errors.expectedDate?.message}
          hint={
            defaultExpected
              ? `Leave empty for ${formatDate(defaultExpected)}, from the lead time`
              : "Leave empty to use the supplier's lead time"
          }
        >
          <Input
            id="expectedDate"
            type="date"
            min={manilaDayKey(now)}
            className={cn(inputClass, "font-mono")}
            {...register("expectedDate")}
          />
        </Field>

        <Field
          id="shipping"
          label="Freight, PHP"
          error={errors.shipping?.message}
          hint="Billed with the order, not added to unit cost"
        >
          <Input
            id="shipping"
            inputMode="decimal"
            placeholder="0.00"
            className={cn(inputClass, "text-right font-mono")}
            {...register("shipping")}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-section text-ink">Lines</h2>
            <p className="mt-0.5 text-body-sm text-ink-subtle">
              Costs are net of VAT, as suppliers quote them. On hand is what the receiving warehouse
              holds now.
            </p>
          </div>
          {suggestions > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addSuggestions}
              disabled={isPending}
            >
              <ListPlus aria-hidden />
              Add {suggestions} reorder suggestion{suggestions === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
        {notice ? (
          <p role="status" className="text-body-sm text-ink-muted">
            {notice}
          </p>
        ) : null}

        {lines.fields.length > 0 ? (
          <div className="relative overflow-x-auto rounded-md border border-hairline bg-canvas">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface-1">
                  <th className={`${th} text-left`}>Item</th>
                  <th className={`${th} hidden text-right md:table-cell`}>On hand</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>Unit cost</th>
                  <th className={`${th} hidden text-right sm:table-cell`}>Line, PHP</th>
                  <th className="w-9 px-1 py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.fields.map((field, index) => {
                  const variantId = values?.[index]?.variantId ?? field.variantId;
                  const pick = picks[variantId];
                  const lineError = lineErrors?.[index];
                  const cost = previewLines[index]?.unitCostCentavos ?? 0;
                  const drift =
                    pick && pick.avgCostCentavos > 0 && cost > 0
                      ? (cost - pick.avgCostCentavos) / pick.avgCostCentavos
                      : 0;

                  return (
                    <tr
                      key={field.id}
                      className="border-b border-hairline align-top last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <input type="hidden" {...register(`lines.${index}.variantId`)} />
                        <span className="block max-w-[11rem] truncate text-ink sm:max-w-[20rem]">
                          {pick?.productName ?? "Variant"}
                        </span>
                        <span className="block max-w-[11rem] truncate text-caption text-ink-subtle sm:max-w-[20rem]">
                          {pick?.optionSummary}{" "}
                          <span className="font-mono text-[11px]">{pick?.sku}</span>
                        </span>
                        {pick && pick.avgCostCentavos > 0 ? (
                          <span className="block text-caption text-ink-subtle" data-numeric>
                            avg cost {formatAmount(pick.avgCostCentavos)}
                            {Math.abs(drift) >= 0.05 ? (
                              <span className={drift > 0 ? "text-warning" : "text-success"}>
                                {" "}
                                ({drift > 0 ? "+" : ""}
                                {Math.round(drift * 100)}%)
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-muted md:table-cell"
                        data-numeric
                      >
                        {pick?.onHand ?? 0}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          aria-label={`Quantity of ${pick?.sku ?? "line"}`}
                          aria-invalid={lineError?.qty ? true : undefined}
                          className="ml-auto h-8 w-16 text-right font-mono text-body-sm sm:w-20"
                          {...register(`lines.${index}.qty`, { valueAsNumber: true })}
                        />
                        {lineError?.qty?.message ? (
                          <p role="alert" className="text-caption text-danger">
                            {lineError.qty.message}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          inputMode="decimal"
                          aria-label={`Unit cost of ${pick?.sku ?? "line"}`}
                          aria-invalid={lineError?.unitCost ? true : undefined}
                          className="ml-auto h-8 w-24 text-right font-mono text-body-sm sm:w-28"
                          {...register(`lines.${index}.unitCost`)}
                        />
                        {lineError?.unitCost?.message ? (
                          <p role="alert" className="text-caption text-danger">
                            {lineError.unitCost.message}
                          </p>
                        ) : null}
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono whitespace-nowrap text-ink sm:table-cell"
                        data-numeric
                      >
                        {formatAmount(lineTotal(index))}
                      </td>
                      <td className="px-1 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${pick?.sku ?? "line"}`}
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
          search={searchPurchasableAction}
          warehouseId={warehouseId}
          excludeIds={(values ?? []).map((line) => line.variantId)}
          onPick={(pick) => addLine(pick)}
          disabled={!warehouseId}
        />
        {(lineErrors?.root?.message ?? lineErrors?.message) ? (
          <p role="alert" className="text-caption text-danger">
            {lineErrors?.root?.message ?? lineErrors?.message}
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_320px]">
        <Field id="notes" label="Notes for the supplier" error={errors.notes?.message}>
          <Textarea
            id="notes"
            rows={4}
            placeholder="Delivery window, packing instructions, the quote this order follows"
            className="bg-canvas text-body-sm"
            {...register("notes")}
          />
        </Field>

        <dl className="self-start rounded-lg border border-hairline bg-surface-1 px-4 py-3">
          {[
            {
              label: `Goods, ${units} unit${units === 1 ? "" : "s"}`,
              value: totals.subtotalCentavos,
            },
            { label: "Freight", value: totals.shippingCentavos },
            { label: "VAT 12%", value: totals.vatCentavos },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-body-sm text-ink-muted">{row.label}</dt>
              <dd data-numeric className="font-mono text-body-sm text-ink">
                {formatAmount(row.value)}
              </dd>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
            <dt className="text-body-sm font-medium text-ink">Total</dt>
            <dd data-numeric className="font-mono text-lead font-medium text-ink">
              {formatPeso(totals.totalCentavos)}
            </dd>
          </div>
        </dl>
      </div>

      <FormError message={serverError} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={canSend ? "secondary" : "primary"}
          disabled={isPending || lines.fields.length === 0}
        >
          {pendingIntent === "draft" ? "Saving" : "Save draft"}
        </Button>
        {canSend ? (
          <Button
            type="button"
            variant="primary"
            onClick={submit("send")}
            disabled={isPending || lines.fields.length === 0}
          >
            <Send aria-hidden />
            {pendingIntent === "send" ? "Sending" : "Send to supplier"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
