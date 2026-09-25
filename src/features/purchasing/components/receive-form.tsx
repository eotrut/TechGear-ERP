"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";

import { Field, FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatAmount, formatPeso, parsePesoInput, toPesoInput } from "@/lib/money";
import { movingAverageCost } from "@/lib/stock-math";
import { cn } from "@/lib/utils";

import { receivePurchaseOrderAction } from "../actions";

/**
 * Book a delivery against a purchase order.
 *
 * Each outstanding line starts at "everything arrived at the PO price", which
 * is the common case, and the receiver corrects what differs: fewer units,
 * units refused at the dock, a different cost on the delivery note. The last
 * column previews the new moving-average cost with the stock service's own
 * formula, against the total on hand across every warehouse. The server
 * recomputes it under the variant lock, so the preview is a forecast, and the
 * receipt page shows what actually happened.
 */

const th =
  "px-2 py-2 sm:px-3 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

export type ReceiveLine = {
  itemId: string;
  sku: string;
  productName: string;
  optionSummary: string;
  qtyOrdered: number;
  qtyReceived: number;
  outstanding: number;
  unitCostCentavos: number;
  avgCostCentavos: number;
  onHandTotal: number;
};

type Entry = { accept: string; reject: string; cost: string };

function wholeOrNull(value: string): number | null {
  if (value.trim() === "") return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function ReceiveForm({
  purchaseOrderId,
  poNumber,
  warehouseCode,
  lines,
}: {
  purchaseOrderId: string;
  poNumber: string;
  warehouseCode: string;
  lines: ReceiveLine[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.itemId,
        { accept: String(line.outstanding), reject: "0", cost: toPesoInput(line.unitCostCentavos) },
      ]),
    ),
  );

  const rows = lines.map((line) => {
    const entry = entries[line.itemId] ?? { accept: "0", reject: "0", cost: "0" };
    const accept = wholeOrNull(entry.accept);
    const reject = wholeOrNull(entry.reject);
    const cost = parsePesoInput(entry.cost);
    const arrived = (accept ?? 0) + (reject ?? 0);
    const problem =
      accept === null || reject === null
        ? "Whole units only."
        : arrived > line.outstanding
          ? `Only ${line.outstanding} outstanding.`
          : cost === null || cost < 0
            ? "Enter a cost."
            : accept > 0 && cost === 0
              ? "Cost cannot be zero."
              : null;
    const projected =
      !problem && accept && accept > 0 && cost !== null
        ? movingAverageCost(line.onHandTotal, line.avgCostCentavos, accept, cost)
        : null;
    return {
      line,
      entry,
      accept: accept ?? 0,
      reject: reject ?? 0,
      cost: cost ?? 0,
      problem,
      projected,
    };
  });

  const accepted = rows.reduce((sum, row) => sum + row.accept, 0);
  const rejected = rows.reduce((sum, row) => sum + row.reject, 0);
  const value = rows.reduce((sum, row) => sum + row.accept * row.cost, 0);
  const invalid = rows.some((row) => row.problem !== null);
  const empty = accepted + rejected === 0;
  const noteMissing = rejected > 0 && note.trim() === "";

  function update(itemId: string, patch: Partial<Entry>) {
    setEntries((current) => {
      const existing = current[itemId] ?? { accept: "0", reject: "0", cost: "0" };
      return { ...current, [itemId]: { ...existing, ...patch } };
    });
  }

  function setAll(mode: "all" | "none") {
    setEntries((current) =>
      Object.fromEntries(
        lines.map((line) => {
          const existing = current[line.itemId] ?? {
            accept: "0",
            reject: "0",
            cost: toPesoInput(line.unitCostCentavos),
          };
          return [
            line.itemId,
            { ...existing, accept: mode === "all" ? String(line.outstanding) : "0", reject: "0" },
          ];
        }),
      ),
    );
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await receivePurchaseOrderAction({
        purchaseOrderId,
        note,
        lines: rows.map((row) => ({
          itemId: row.line.itemId,
          qtyReceived: row.accept,
          qtyRejected: row.reject,
          unitCost: row.entry.cost,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Delivery received.");
      router.push(`/purchasing/${purchaseOrderId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-section text-ink">What arrived</h2>
            <p className="mt-0.5 max-w-[70ch] text-body-sm text-ink-subtle">
              Count the good units into {warehouseCode}. Units refused at the dock go back to the
              supplier and stay owed on {poNumber}. Change the cost if the delivery note differs
              from the order.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAll("none")}>
              Clear all
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setAll("all")}>
              Everything arrived
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-hairline bg-canvas">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface-1">
                <th className={`${th} text-left`}>Item</th>
                <th className={`${th} hidden text-right lg:table-cell`}>Owed</th>
                <th className={`${th} text-right`}>Accept</th>
                <th className={`${th} text-right`}>Reject</th>
                <th className={`${th} text-right`}>Unit cost</th>
                <th className={`${th} hidden text-right md:table-cell`}>Avg cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ line, entry, problem, projected }) => (
                <tr
                  key={line.itemId}
                  className="border-b border-hairline align-top last:border-b-0"
                >
                  <td className="px-2 py-2 sm:px-3">
                    <span className="block max-w-[7rem] truncate text-ink sm:max-w-[18rem]">
                      {line.productName}
                    </span>
                    <span className="block max-w-[7rem] truncate text-caption text-ink-subtle sm:max-w-[18rem]">
                      {line.optionSummary} <span className="font-mono text-[11px]">{line.sku}</span>
                    </span>
                    <span className="block text-caption text-ink-subtle lg:hidden" data-numeric>
                      {line.outstanding} owed of {line.qtyOrdered}
                    </span>
                    {problem ? (
                      <span role="alert" className="block text-caption text-danger">
                        {problem}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden px-2 py-2 text-right whitespace-nowrap sm:px-3 lg:table-cell">
                    <span data-numeric className="font-mono text-ink">
                      {line.outstanding}
                    </span>
                    <span className="block text-caption text-ink-subtle" data-numeric>
                      of {line.qtyOrdered}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right sm:px-3">
                    <Input
                      type="number"
                      min={0}
                      max={line.outstanding}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Units accepted of ${line.sku}`}
                      value={entry.accept}
                      onChange={(event) => update(line.itemId, { accept: event.target.value })}
                      className="ml-auto h-8 w-12 px-1.5 text-right font-mono text-body-sm sm:w-20 sm:px-2.5"
                    />
                  </td>
                  <td className="px-2 py-2 text-right sm:px-3">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Units rejected of ${line.sku}`}
                      value={entry.reject}
                      onChange={(event) => update(line.itemId, { reject: event.target.value })}
                      className={cn(
                        "ml-auto h-8 w-11 px-1.5 text-right font-mono text-body-sm sm:w-16 sm:px-2.5",
                        entry.reject !== "0" && entry.reject !== "" && "text-danger",
                      )}
                    />
                  </td>
                  <td className="px-2 py-2 text-right sm:px-3">
                    <Input
                      inputMode="decimal"
                      aria-label={`Delivered unit cost of ${line.sku}`}
                      value={entry.cost}
                      onChange={(event) => update(line.itemId, { cost: event.target.value })}
                      className="ml-auto h-8 w-20 px-1.5 text-right font-mono text-body-sm sm:w-28 sm:px-2.5"
                    />
                    {parsePesoInput(entry.cost) !== line.unitCostCentavos ? (
                      <span className="block text-caption text-ink-subtle" data-numeric>
                        ordered at {formatAmount(line.unitCostCentavos)}
                      </span>
                    ) : null}
                  </td>
                  <td className="hidden px-2 py-2 text-right whitespace-nowrap sm:px-3 md:table-cell">
                    <span data-numeric className="font-mono text-ink-muted">
                      {formatAmount(line.avgCostCentavos)}
                    </span>
                    {projected !== null && projected !== line.avgCostCentavos ? (
                      <span
                        data-numeric
                        className={cn(
                          "block font-mono text-[12px]",
                          projected > line.avgCostCentavos ? "text-warning" : "text-success",
                        )}
                      >
                        to {formatAmount(projected)}
                      </span>
                    ) : (
                      <span className="block text-caption text-ink-subtle">unchanged</span>
                    )}
                    <span className="block text-caption text-ink-subtle" data-numeric>
                      {line.onHandTotal} on hand
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <Field
          id="receive-note"
          label={rejected > 0 ? "Note (required, units were rejected)" : "Note (optional)"}
          error={
            noteMissing
              ? "Say why units were rejected, so the supplier claim has a record."
              : undefined
          }
        >
          <Textarea
            id="receive-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Delivery note number, carton damage, anything the next person should know"
            className="bg-canvas text-body-sm"
          />
        </Field>

        <dl className="self-start rounded-lg border border-hairline bg-surface-1 px-4 py-3">
          <div className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-body-sm text-ink-muted">Units in</dt>
            <dd data-numeric className="font-mono text-body-sm text-ink">
              {accepted}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-1">
            <dt className="text-body-sm text-ink-muted">Rejected</dt>
            <dd
              data-numeric
              className={cn("font-mono text-body-sm", rejected > 0 ? "text-danger" : "text-ink")}
            >
              {rejected}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
            <dt className="text-body-sm font-medium text-ink">Stock value in</dt>
            <dd data-numeric className="font-mono text-lead font-medium text-ink">
              {formatPeso(value)}
            </dd>
          </div>
        </dl>
      </div>

      <FormError message={error} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={submit}
          disabled={isPending || invalid || empty || noteMissing}
        >
          <PackageCheck aria-hidden />
          {isPending
            ? "Receiving"
            : accepted === 0 && rejected > 0
              ? "Record the rejection"
              : `Receive ${accepted} unit${accepted === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
