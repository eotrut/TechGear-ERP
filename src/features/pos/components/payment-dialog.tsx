"use client";

import { useState } from "react";
import { Banknote, CreditCard, Landmark, Plus, Smartphone, Wallet, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { emptyTender, tenderTotals } from "@/features/orders/components/tender-fields";
import {
  PAYMENT_METHOD_LABEL,
  REFERENCE_REQUIRED,
  type TenderValues,
} from "@/features/orders/schemas";
import { tendersFrom } from "@/features/orders/services/form";
import { settleTenders } from "@/features/orders/services/order-rules";
import { DomainError } from "@/lib/errors";
import { formatPeso, parsePesoInput, toPesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import { quickCashAmounts } from "../services/sale";

/**
 * Taking payment at the counter. One tender covers the whole amount unless
 * the cashier splits it; cash is the one tender with an amount handed over
 * and change. Every rule is `settleTenders`, the function the order service
 * runs again on the server, so the button is enabled exactly when the sale
 * would be accepted, and the reason it is not is the server's own sentence.
 */

const COUNTER_METHODS = ["CASH", "GCASH", "MAYA", "CARD", "BANK_TRANSFER"] as const;

const METHOD_ICON: Record<(typeof COUNTER_METHODS)[number], typeof Banknote> = {
  CASH: Banknote,
  GCASH: Smartphone,
  MAYA: Wallet,
  CARD: CreditCard,
  BANK_TRANSFER: Landmark,
};

function initialTenders(dueCentavos: number): TenderValues[] {
  return dueCentavos > 0 ? [emptyTender("CASH", dueCentavos)] : [];
}

/** Why these tenders would be refused, in the server's words, or null. */
function settlementProblem(dueCentavos: number, tenders: TenderValues[]): string | null {
  try {
    settleTenders(dueCentavos, tendersFrom(tenders), { channel: "POS" });
    return null;
  } catch (error) {
    if (error instanceof DomainError) return error.message;
    throw error;
  }
}

export function PaymentDialog({
  open,
  onOpenChange,
  dueCentavos,
  pending,
  error,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dueCentavos: number;
  pending: boolean;
  error: string | null;
  onComplete: (tenders: TenderValues[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!pending ? onOpenChange(next) : undefined)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-xl"
        showCloseButton={!pending}
      >
        {/* Remounted per opening, so a reopened dialog starts from the current total. */}
        {open ? (
          <PaymentBody
            dueCentavos={dueCentavos}
            pending={pending}
            error={error}
            onComplete={onComplete}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PaymentBody({
  dueCentavos,
  pending,
  error,
  onComplete,
}: {
  dueCentavos: number;
  pending: boolean;
  error: string | null;
  onComplete: (tenders: TenderValues[]) => void;
}) {
  // The newest split row takes whatever the others leave, until the cashier
  // types an amount into it: split, key the first amount, the rest fills in.
  const [state, setState] = useState<{ tenders: TenderValues[]; balancing: number | null }>(() => ({
    tenders: initialTenders(dueCentavos),
    balancing: null,
  }));
  const { tenders } = state;
  const split = tenders.length > 1;
  const { change, remaining } = tenderTotals(tenders, dueCentavos);
  const problem = settlementProblem(dueCentavos, tenders);

  function balanced(list: TenderValues[], balancing: number | null) {
    if (balancing === null) return { tenders: list, balancing };
    const others = tenderTotals(
      list.filter((_, i) => i !== balancing),
      dueCentavos,
    ).paid;
    const rest = Math.max(0, dueCentavos - others);
    return {
      tenders: list.map((tender, i) =>
        i === balancing ? { ...tender, amount: rest > 0 ? toPesoInput(rest) : "" } : tender,
      ),
      balancing,
    };
  }

  function update(index: number, patch: Partial<TenderValues>) {
    setState((current) => {
      const list = current.tenders.map((tender, i) =>
        i === index ? { ...tender, ...patch } : tender,
      );
      const typedIntoBalancer = patch.amount !== undefined && index === current.balancing;
      return balanced(list, typedIntoBalancer ? null : current.balancing);
    });
  }

  function addSplit() {
    setState((current) => {
      const usesCash = current.tenders.some((tender) => tender.method === "CASH");
      const list = [...current.tenders, emptyTender(usesCash ? "GCASH" : "CASH", 0)];
      return balanced(list, list.length - 1);
    });
  }

  function removeTender(index: number) {
    setState((current) => {
      const list = current.tenders.filter((_, i) => i !== index);
      // Back to one tender: it covers the whole amount again.
      if (list.length === 1 && list[0]) {
        return { tenders: [{ ...list[0], amount: toPesoInput(dueCentavos) }], balancing: null };
      }
      const balancing =
        current.balancing === null || current.balancing === index
          ? list.length - 1
          : current.balancing > index
            ? current.balancing - 1
            : current.balancing;
      return balanced(list, balancing);
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!problem && !pending) onComplete(tenders);
      }}
    >
      <DialogHeader>
        <DialogTitle>Take payment</DialogTitle>
        <DialogDescription>
          {dueCentavos === 0
            ? "Nothing is due on this sale."
            : "Choose how the customer is paying. Split it to take two or more methods."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-baseline justify-between gap-4 border-y border-hairline py-4">
        <span className="text-body-sm text-ink-subtle">Amount due</span>
        <span className="font-mono text-display text-ink tabular-nums" data-testid="amount-due">
          {formatPeso(dueCentavos)}
        </span>
      </div>

      {tenders.map((tender, index) => (
        <TenderBlock
          key={index}
          index={index}
          tender={tender}
          split={split}
          otherHasCash={tenders.some((other, i) => i !== index && other.method === "CASH")}
          onChange={(patch) => update(index, patch)}
          onRemove={split ? () => removeTender(index) : undefined}
        />
      ))}

      {dueCentavos > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={addSplit}
            disabled={tenders.length >= 4}
          >
            <Plus aria-hidden />
            Split payment
          </Button>
          <p className="text-body-sm" aria-live="polite" data-numeric>
            {remaining === 0 ? (
              <span className="text-success">Covered in full</span>
            ) : remaining > 0 ? (
              <span className="text-warning">{formatPeso(remaining)} still to cover</span>
            ) : (
              <span className="text-danger">{formatPeso(-remaining)} over the amount due</span>
            )}
          </p>
        </div>
      ) : null}

      {change > 0 ? (
        <div
          className="flex items-baseline justify-between gap-4 rounded-lg border border-hairline bg-surface-2 px-4 py-3"
          aria-live="polite"
        >
          <span className="text-body font-medium text-ink">Change</span>
          <span className="font-mono text-title text-ink tabular-nums" data-testid="change-due">
            {formatPeso(change)}
          </span>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md bg-danger-wash px-3 py-2 text-body-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex flex-col gap-2 border-t border-hairline bg-background px-6 pt-3 pb-6">
        <Button
          type="submit"
          variant="primary"
          className="h-12 w-full text-lead"
          disabled={problem !== null || pending}
        >
          {pending ? "Recording sale" : "Complete sale"}
        </Button>
        {problem && !pending ? (
          <p className="text-center text-caption text-ink-subtle">{problem}</p>
        ) : null}
      </div>
    </form>
  );
}

function TenderBlock({
  index,
  tender,
  split,
  otherHasCash,
  onChange,
  onRemove,
}: {
  index: number;
  tender: TenderValues;
  split: boolean;
  otherHasCash: boolean;
  onChange: (patch: Partial<TenderValues>) => void;
  onRemove?: () => void;
}) {
  const base = `tender-${index}`;
  const amountCentavos = parsePesoInput(tender.amount) ?? 0;
  const needsRef = REFERENCE_REQUIRED.includes(tender.method);

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface-1 p-3">
      <legend className="sr-only">Payment {index + 1}</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption font-medium text-ink-subtle">
          {split ? `Payment ${index + 1}` : "Method"}
        </span>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            aria-label={`Remove payment ${index + 1}`}
            onClick={onRemove}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label="Payment method"
        className="grid grid-cols-3 gap-1.5 sm:grid-cols-5"
      >
        {COUNTER_METHODS.map((method) => {
          const Icon = METHOD_ICON[method];
          const selected = tender.method === method;
          // Cash is one tender, so a second cash row is not offered.
          const blocked = method === "CASH" && otherHasCash && !selected;
          return (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={blocked}
              onClick={() => onChange({ method, tendered: "", reference: "" })}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1 rounded-md border text-caption font-medium transition-colors",
                "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
                "disabled:cursor-not-allowed disabled:opacity-40",
                selected
                  ? "border-accent-fill bg-accent-wash text-accent-strong"
                  : "border-hairline bg-canvas text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {method === "BANK_TRANSFER" ? (
                <>
                  Bank<span className="sr-only"> transfer</span>
                </>
              ) : (
                PAYMENT_METHOD_LABEL[method]
              )}
            </button>
          );
        })}
      </div>

      <div className={cn("grid gap-3", split && "sm:grid-cols-2")}>
        {split ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-amount`} className="text-caption text-ink-subtle">
              Amount
            </Label>
            <Input
              id={`${base}-amount`}
              inputMode="decimal"
              autoComplete="off"
              className="h-11 bg-canvas text-right font-mono text-body"
              value={tender.amount}
              onChange={(event) => onChange({ amount: event.target.value })}
              onFocus={(event) => event.target.select()}
            />
          </div>
        ) : null}

        {tender.method === "CASH" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-tendered`} className="text-caption text-ink-subtle">
              Cash received
            </Label>
            <Input
              id={`${base}-tendered`}
              inputMode="decimal"
              autoComplete="off"
              autoFocus={index === 0}
              placeholder={amountCentavos > 0 ? toPesoInput(amountCentavos) : "0.00"}
              className="h-11 bg-canvas text-right font-mono text-body"
              value={tender.tendered}
              onChange={(event) => onChange({ tendered: event.target.value })}
              onFocus={(event) => event.target.select()}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-reference`} className="text-caption text-ink-subtle">
              {tender.method === "CARD" ? "Approval code (optional)" : "Reference number"}
              {needsRef ? <span className="sr-only"> (required)</span> : null}
            </Label>
            <Input
              id={`${base}-reference`}
              autoComplete="off"
              className="h-11 bg-canvas font-mono text-body"
              value={tender.reference}
              onChange={(event) => onChange({ reference: event.target.value })}
            />
          </div>
        )}
      </div>

      {tender.method === "CASH" && amountCentavos > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Quick cash amounts">
          {quickCashAmounts(amountCentavos).map((amount, i) => (
            <Button
              key={amount}
              type="button"
              variant="secondary"
              className="h-10 min-w-[5.5rem] font-mono tabular-nums"
              onClick={() => onChange({ tendered: toPesoInput(amount) })}
            >
              {i === 0 ? "Exact" : formatPeso(amount)}
            </Button>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
