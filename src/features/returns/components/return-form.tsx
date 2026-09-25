"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field, FormError, inputClass } from "@/components/forms/field";
import { SearchCombobox, type ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { refundForUnits } from "@/features/orders/services/order-rules";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import { createReturnAction, searchReturnableOrdersAction } from "../actions";
import type { ReturnableOrder } from "../queries";

/**
 * Start a return. Each line offers only what can still come back: sold, less
 * already returned, less what another open return is holding. The refund
 * shown is an estimate; the real figure is worked out when the return is
 * completed, from the line's discounted total.
 */

const REASONS = [
  "Defective on arrival",
  "Wrong item or variant shipped",
  "Changed mind within the return window",
  "Damaged in transit",
];

export function OrderPicker() {
  const router = useRouter();
  return (
    <Field id="order" label="Order" hint="Delivered orders with a customer on file.">
      <SearchCombobox
        id="order"
        value={null}
        placeholder="Search by order number or customer"
        search={async (query) => {
          const result = await searchReturnableOrdersAction({ query });
          return result.ok ? result.results : [];
        }}
        onChange={(option: ComboOption | null) => {
          if (option) router.push(`/returns/new?orderId=${option.id}`);
        }}
      />
    </Field>
  );
}

export function ReturnForm({ order, showMoney }: { order: ReturnableOrder; showMoney: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const estimate = order.items.reduce((sum, item) => {
    const units = qty[item.id] ?? 0;
    if (units <= 0 || units > item.returnable) return sum;
    return sum + refundForUnits(item, item.qtyReturned + item.inOpenReturns, units);
  }, 0);
  const units = Object.values(qty).reduce((sum, value) => sum + (value > 0 ? value : 0), 0);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createReturnAction({
        orderId: order.id,
        reason,
        notes,
        lines: order.items.map((item) => ({ orderItemId: item.id, qty: qty[item.id] ?? 0 })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Return raised.");
      router.push(result.id ? `/returns/${result.id}` : "/returns");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="relative overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-hairline bg-surface-1 text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Sold</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                Already back
              </th>
              <th className="w-28 px-3 py-2 text-right font-medium">Returning</th>
              {showMoney ? <th className="px-3 py-2 text-right font-medium">Refund</th> : null}
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => {
              const value = qty[item.id] ?? 0;
              const over = value > item.returnable;
              return (
                <tr key={item.id} className="border-b border-hairline align-top last:border-b-0">
                  <td className="px-3 py-2">
                    <span className="block max-w-[24rem] truncate text-ink">
                      {item.nameSnapshot}
                    </span>
                    <span className="font-mono text-[11px] text-ink-subtle">
                      {item.skuSnapshot}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink-muted" data-numeric>
                    {item.qty}
                  </td>
                  <td
                    className="hidden px-3 py-2 text-right font-mono text-ink-muted sm:table-cell"
                    data-numeric
                  >
                    {item.qtyReturned + item.inOpenReturns}
                    {item.inOpenReturns > 0 ? (
                      <span className="block text-[11px] text-ink-subtle">
                        {item.inOpenReturns} in progress
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {item.returnable === 0 ? (
                      <span className="text-caption text-ink-subtle">none left</span>
                    ) : (
                      <>
                        <Input
                          type="number"
                          min={0}
                          max={item.returnable}
                          inputMode="numeric"
                          aria-label={`Units of ${item.skuSnapshot} to return`}
                          className={cn(
                            inputClass,
                            "ml-auto w-20 text-right font-mono",
                            over && "border-danger",
                          )}
                          value={value === 0 ? "" : value}
                          placeholder="0"
                          onChange={(event) =>
                            setQty((current) => ({
                              ...current,
                              [item.id]: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                            }))
                          }
                        />
                        <span className="mt-0.5 block text-[11px] text-ink-subtle" data-numeric>
                          up to {item.returnable}
                        </span>
                      </>
                    )}
                  </td>
                  {showMoney ? (
                    <td
                      className="px-3 py-2 text-right font-mono whitespace-nowrap text-ink"
                      data-numeric
                    >
                      {value > 0 && !over
                        ? formatPeso(
                            refundForUnits(item, item.qtyReturned + item.inOpenReturns, value),
                          )
                        : ""}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field id="reason" label="Reason" hint="In the customer's words where you can.">
          <Input
            id="reason"
            list="return-reasons"
            className={inputClass}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <datalist id="return-reasons">
            {REASONS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </Field>
        <Field id="notes" label="Notes" hint="Optional: courier, packaging, what was agreed.">
          <Textarea
            id="notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>

      <FormError message={error} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
        <p className="text-body-sm text-ink-muted" data-numeric>
          {units === 0
            ? "Choose the units coming back."
            : `${units} unit${units === 1 ? "" : "s"}${showMoney ? `, about ${formatPeso(estimate)} to refund` : ""}. A manager approves it before anything moves.`}
        </p>
        <Button variant="primary" size="md" disabled={isPending || units === 0} onClick={submit}>
          {isPending ? "Raising" : "Raise return"}
        </Button>
      </div>
    </div>
  );
}
