"use client";

import { useState, useTransition } from "react";
import { TicketPercent, X } from "lucide-react";

import { SearchCombobox, type ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchCustomersAction } from "@/features/customers/actions";
import { checkPromoAction } from "@/features/orders/actions";
import { manualDiscountIssue, type MANUAL_DISCOUNT_TYPES } from "@/features/orders/schemas";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { AppliedPromo } from "../services/sale";

type DiscountType = (typeof MANUAL_DISCOUNT_TYPES)[number];

const TYPE_LABEL: Record<DiscountType, string> = {
  NONE: "None",
  PERCENT: "Percent",
  FIXED: "Peso amount",
};

/**
 * The order discount and the promo code, in one place because a cashier
 * thinks of them as one question: "is anything coming off?". The discount is
 * what a person keys; the promo is checked against the server before it is
 * shown, and checked again under its row lock when the sale is recorded.
 */
export function DiscountDialog({
  open,
  onOpenChange,
  discountType,
  discountValue,
  onDiscount,
  capBps,
  canDiscount,
  canPromo,
  promo,
  onPromo,
  merchandiseCentavos,
  customerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  discountType: DiscountType;
  discountValue: string;
  onDiscount: (type: DiscountType, value: string) => void;
  capBps: number | null;
  canDiscount: boolean;
  canPromo: boolean;
  promo: AppliedPromo | null;
  onPromo: (promo: AppliedPromo | null) => void;
  merchandiseCentavos: number;
  customerId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto sm:max-w-md">
        {open ? (
          <DiscountBody
            initialType={discountType}
            initialValue={discountValue}
            onDone={(type, value) => {
              onDiscount(type, value);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
            capBps={capBps}
            canDiscount={canDiscount}
            canPromo={canPromo}
            promo={promo}
            onPromo={onPromo}
            merchandiseCentavos={merchandiseCentavos}
            customerId={customerId}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DiscountBody({
  initialType,
  initialValue,
  onDone,
  onCancel,
  capBps,
  canDiscount,
  canPromo,
  promo,
  onPromo,
  merchandiseCentavos,
  customerId,
}: {
  initialType: DiscountType;
  initialValue: string;
  onDone: (type: DiscountType, value: string) => void;
  onCancel: () => void;
  capBps: number | null;
  canDiscount: boolean;
  canPromo: boolean;
  promo: AppliedPromo | null;
  onPromo: (promo: AppliedPromo | null) => void;
  merchandiseCentavos: number;
  customerId: string;
}) {
  const [type, setType] = useState<DiscountType>(initialType);
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();

  const issue = type === "NONE" ? null : manualDiscountIssue(type, value);
  const quick = capBps === null ? [5, 10, 15, 20] : [5, 10].filter((pct) => pct * 100 <= capBps);

  function applyPromo() {
    const trimmed = code.trim();
    if (trimmed === "") return;
    setPromoError(null);
    startCheck(async () => {
      const result = await checkPromoAction({ code: trimmed, customerId, merchandiseCentavos });
      if (!result.ok) {
        setPromoError(result.error);
        return;
      }
      onPromo({
        code: result.code,
        type: result.type,
        percentBps: result.percentBps,
        amountCentavos: result.amountCentavos,
        minSubtotalCentavos: result.minSubtotalCentavos,
      });
      setCode("");
    });
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!issue) onDone(type, type === "NONE" ? "" : value);
      }}
    >
      <DialogHeader>
        <DialogTitle>Discount</DialogTitle>
        <DialogDescription>
          A promo comes off first, then the order discount on what is left.
        </DialogDescription>
      </DialogHeader>

      {canDiscount ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-body-sm font-medium text-ink">Order discount</legend>
          <div role="radiogroup" aria-label="Discount type" className="grid grid-cols-3 gap-1.5">
            {(["NONE", "PERCENT", "FIXED"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={type === option}
                onClick={() => {
                  setType(option);
                  setValue("");
                  setTouched(false);
                }}
                className={cn(
                  "h-11 rounded-md border text-body-sm font-medium transition-colors",
                  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
                  type === option
                    ? "border-accent-fill bg-accent-wash text-accent-strong"
                    : "border-hairline bg-canvas text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {TYPE_LABEL[option]}
              </button>
            ))}
          </div>

          {type !== "NONE" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pos-discount-value" className="text-caption text-ink-subtle">
                {type === "PERCENT" ? "Percent off" : "Pesos off"}
              </Label>
              <div className="relative">
                <Input
                  id="pos-discount-value"
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                  aria-invalid={(touched && issue !== null) || undefined}
                  className="h-11 bg-canvas pr-10 text-right font-mono text-body"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-body-sm text-ink-subtle">
                  {type === "PERCENT" ? "%" : "PHP"}
                </span>
              </div>
              {type === "PERCENT" && quick.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {quick.map((pct) => (
                    <Button
                      key={pct}
                      type="button"
                      variant="secondary"
                      className="h-10 min-w-16 font-mono"
                      onClick={() => setValue(String(pct))}
                    >
                      {pct}%
                    </Button>
                  ))}
                </div>
              ) : null}
              {touched && issue ? (
                <p className="text-caption text-danger">{issue}</p>
              ) : (
                <p className="text-caption text-ink-subtle">
                  {capBps === null
                    ? "No limit for your role."
                    : `Up to ${capBps / 100}% of the subtotal. Ask a manager for more.`}
                </p>
              )}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      {canPromo ? (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <Label htmlFor="pos-promo" className="text-body-sm font-medium text-ink">
            Promo code
          </Label>
          {promo ? (
            <div className="flex h-11 items-center justify-between gap-2 rounded-md border border-hairline bg-surface-1 pr-1 pl-3">
              <span className="flex min-w-0 items-center gap-2">
                <TicketPercent className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                <span className="font-mono text-body-sm text-ink">{promo.code}</span>
                <span className="truncate text-caption text-ink-subtle">
                  {promo.type === "PERCENT"
                    ? `${(promo.percentBps ?? 0) / 100}% off`
                    : `${formatPeso(promo.amountCentavos ?? 0)} off`}
                  {promo.minSubtotalCentavos > 0
                    ? `, min. ${formatPeso(promo.minSubtotalCentavos)}`
                    : ""}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label={`Remove promo ${promo.code}`}
                onClick={() => onPromo(null)}
              >
                <X aria-hidden />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                id="pos-promo"
                autoComplete="off"
                placeholder="e.g. TECHGEAR10"
                className="h-11 bg-canvas font-mono text-body uppercase placeholder:normal-case"
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setPromoError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyPromo();
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                className="h-11"
                disabled={checking || code.trim() === ""}
                onClick={applyPromo}
              >
                {checking ? "Checking" : "Apply"}
              </Button>
            </div>
          )}
          {promoError ? (
            <p role="alert" className="text-caption text-danger">
              {promoError}
            </p>
          ) : null}
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" className="h-11">
          Done
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Attach a customer so the sale counts toward their history and segment. */
export function CustomerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (customer: ComboOption) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>
            Optional. Leave it empty for a walk-in; attach one to build their purchase history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 pb-44">
          <Label htmlFor="pos-customer" className="text-caption text-ink-subtle">
            Customer
          </Label>
          <SearchCombobox
            id="pos-customer"
            touch
            autoFocus
            value={null}
            placeholder="Name, phone, email or code"
            emptyText="No customer matches"
            search={async (query) => {
              const result = await searchCustomersAction({ query });
              return result.ok
                ? result.results.map((row) => ({
                    id: row.id,
                    label: row.displayName,
                    detail: row.detail,
                    meta: row.code,
                  }))
                : [];
            }}
            onChange={(option) => {
              if (!option) return;
              onPick(option);
              onOpenChange(false);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
