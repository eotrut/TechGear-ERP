"use client";

import { Plus, X } from "lucide-react";

import { inputClass, selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPeso, parsePesoInput, toPesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  REFERENCE_REQUIRED,
  type TenderValues,
} from "../schemas";

/**
 * Split payment entry. Each row is one tender; the amounts must add up to
 * exactly what is due, which the running tally says in words before the
 * server has to. Cash is the one method with a tendered amount, and the
 * change it gives is shown as it is typed.
 */

export function emptyTender(method: TenderValues["method"], dueCentavos: number): TenderValues {
  return {
    method,
    amount: dueCentavos > 0 ? toPesoInput(dueCentavos) : "",
    tendered: "",
    reference: "",
  };
}

export function tenderTotals(tenders: readonly TenderValues[], dueCentavos: number) {
  let paid = 0;
  let change = 0;
  for (const tender of tenders) {
    const amount = parsePesoInput(tender.amount) ?? 0;
    paid += amount;
    if (tender.method === "CASH" && tender.tendered.trim() !== "") {
      const handed = parsePesoInput(tender.tendered) ?? 0;
      change += Math.max(0, handed - amount);
    }
  }
  return { paid, change, remaining: dueCentavos - paid };
}

export function TenderFields({
  idPrefix,
  tenders,
  onChange,
  dueCentavos,
  allowCod = true,
}: {
  idPrefix: string;
  tenders: TenderValues[];
  onChange: (next: TenderValues[]) => void;
  dueCentavos: number;
  allowCod?: boolean;
}) {
  const { paid, change, remaining } = tenderTotals(tenders, dueCentavos);
  const methods = PAYMENT_METHODS.filter((method) => allowCod || method !== "COD");

  function update(index: number, patch: Partial<TenderValues>) {
    onChange(tenders.map((tender, i) => (i === index ? { ...tender, ...patch } : tender)));
  }

  return (
    <div className="flex flex-col gap-3">
      {tenders.map((tender, index) => {
        const base = `${idPrefix}-${index}`;
        const needsRef = REFERENCE_REQUIRED.includes(tender.method);
        return (
          <fieldset
            key={index}
            className="grid grid-cols-2 gap-2 rounded-md border border-hairline bg-surface-1 p-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
          >
            <legend className="sr-only">Payment {index + 1}</legend>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${base}-method`} className="text-caption text-ink-subtle">
                Method
              </Label>
              <select
                id={`${base}-method`}
                className={selectClass}
                value={tender.method}
                onChange={(event) =>
                  update(index, {
                    method: event.target.value as TenderValues["method"],
                    tendered: "",
                  })
                }
              >
                {methods.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABEL[method]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${base}-amount`} className="text-caption text-ink-subtle">
                Amount
              </Label>
              <Input
                id={`${base}-amount`}
                inputMode="decimal"
                className={cn(inputClass, "text-right font-mono")}
                value={tender.amount}
                onChange={(event) => update(index, { amount: event.target.value })}
              />
            </div>
            {tender.method === "CASH" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${base}-tendered`} className="text-caption text-ink-subtle">
                  Cash handed over
                </Label>
                <Input
                  id={`${base}-tendered`}
                  inputMode="decimal"
                  placeholder="Same as amount"
                  className={cn(inputClass, "text-right font-mono")}
                  value={tender.tendered}
                  onChange={(event) => update(index, { tendered: event.target.value })}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${base}-reference`} className="text-caption text-ink-subtle">
                  Reference{needsRef ? "" : " (optional)"}
                </Label>
                <Input
                  id={`${base}-reference`}
                  className={cn(inputClass, "font-mono")}
                  placeholder={tender.method === "CARD" ? "Approval code" : "Reference number"}
                  value={tender.reference}
                  onChange={(event) => update(index, { reference: event.target.value })}
                />
              </div>
            )}
            <div className="col-span-2 flex items-end justify-end sm:col-span-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove payment ${index + 1}`}
                disabled={tenders.length === 1}
                onClick={() => onChange(tenders.filter((_, i) => i !== index))}
              >
                <X aria-hidden />
              </Button>
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={tenders.length >= 4 || remaining <= 0}
          onClick={() =>
            onChange([
              ...tenders,
              emptyTender(
                tenders.some((tender) => tender.method === "CASH") ? "GCASH" : "CASH",
                Math.max(0, remaining),
              ),
            ])
          }
        >
          <Plus aria-hidden />
          Split payment
        </Button>
        <p className="text-body-sm" aria-live="polite" data-numeric>
          {remaining === 0 ? (
            <span className="text-success">Paid in full</span>
          ) : remaining > 0 ? (
            <span className="text-warning">{formatPeso(remaining)} still to pay</span>
          ) : (
            <span className="text-danger">{formatPeso(-remaining)} more than is due</span>
          )}
          <span className="text-ink-subtle">
            {" "}
            of {formatPeso(dueCentavos)}, {formatPeso(paid)} entered
          </span>
          {change > 0 ? (
            <span className="ml-2 font-mono text-ink">Change {formatPeso(change)}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
