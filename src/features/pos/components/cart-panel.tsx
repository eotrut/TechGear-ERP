"use client";

import { Minus, Percent, Plus, ScanBarcode, Trash2, UserPlus, UserRound, X } from "lucide-react";

import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import type { ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { RegisterItem } from "../queries";
import type { AppliedPromo, SalePreview } from "../services/sale";

export type CartLine = { item: RegisterItem; qty: number };

/**
 * The right-hand side of the register: what is being sold, to whom, what is
 * coming off, and the one big button. Lines are newest first, so the item
 * just scanned is always in view; it carries the accent bar, the app's
 * selected-row mark, so a cashier can see which scan landed.
 */
export function CartPanel({
  lines,
  lastAddedId,
  onQty,
  onRemove,
  onVoid,
  canVoid,
  customer,
  onAddCustomer,
  onClearCustomer,
  canAttachCustomer,
  discountLabel,
  onOpenDiscount,
  canOpenDiscount,
  promo,
  preview,
  capBps,
  onCharge,
  chargeBlocked,
  className,
}: {
  lines: CartLine[];
  lastAddedId: string | null;
  onQty: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onVoid: () => void;
  canVoid: boolean;
  customer: ComboOption | null;
  onAddCustomer: () => void;
  onClearCustomer: () => void;
  canAttachCustomer: boolean;
  discountLabel: string | null;
  onOpenDiscount: () => void;
  canOpenDiscount: boolean;
  promo: AppliedPromo | null;
  preview: SalePreview;
  capBps: number | null;
  onCharge: () => void;
  chargeBlocked: string | null;
  className?: string;
}) {
  const units = lines.reduce((sum, line) => sum + line.qty, 0);
  const pricing = preview.pricing;

  return (
    <section
      id="cart"
      aria-label="Current sale"
      className={cn("flex min-h-0 flex-col bg-surface-1", className)}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-hairline px-4">
        <h2 className="flex items-baseline gap-2 text-section text-ink">
          Sale
          <span className="font-mono text-body-sm font-normal text-ink-subtle" data-numeric>
            {units === 0 ? "empty" : `${units} unit${units === 1 ? "" : "s"}`}
          </span>
        </h2>
        {canVoid && lines.length > 0 ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" className="h-10 text-ink-subtle">
                <Trash2 aria-hidden />
                Void
              </Button>
            }
            title="Void this sale?"
            description="Every line comes off the screen. Nothing has been charged or taken from stock yet."
            confirmLabel="Void sale"
            onConfirm={async () => {
              onVoid();
              return { ok: true };
            }}
          />
        ) : null}
      </header>

      <div className="shrink-0 border-b border-hairline px-4 py-2.5">
        {customer ? (
          <div className="flex min-h-11 items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
                <UserRound className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-body-sm font-medium text-ink">
                  {customer.label}
                </span>
                <span className="block truncate font-mono text-[11px] text-ink-subtle">
                  {customer.meta}
                </span>
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-10"
              aria-label={`Remove ${customer.label} from the sale`}
              onClick={onClearCustomer}
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="h-11 w-full justify-start px-2 text-ink-muted"
            onClick={onAddCustomer}
            disabled={!canAttachCustomer}
          >
            <UserPlus aria-hidden />
            Walk-in customer
            <span className="ml-auto text-caption text-ink-subtle">Add customer</span>
          </Button>
        )}
      </div>

      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <span className="mb-3 inline-flex size-10 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-subtle">
            <ScanBarcode className="size-5" aria-hidden />
          </span>
          <p className="text-body font-medium text-ink">Scan an item to start</p>
          <p className="mt-1 max-w-[30ch] text-body-sm text-ink-subtle">
            Scan a barcode, type a SKU, or tap an item.
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Items in this sale">
          {lines.map((line) => {
            const available = line.item.onHand - line.item.reserved;
            return (
              <li
                key={line.item.id}
                className={cn(
                  "relative border-b border-hairline px-4 py-3",
                  line.item.id === lastAddedId &&
                    "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent-fill",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-ink">
                      {line.item.productName}
                    </p>
                    <p className="truncate text-caption text-ink-subtle">
                      {line.item.optionSummary}{" "}
                      <span className="font-mono text-[11px]">{line.item.sku}</span>
                    </p>
                  </div>
                  <p
                    className="shrink-0 text-right font-mono text-body-sm text-ink tabular-nums"
                    data-numeric
                  >
                    {formatPeso(line.item.priceCentavos * line.qty)}
                  </p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1" role="group" aria-label="Quantity">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-10"
                      aria-label={`One fewer ${line.item.sku}`}
                      disabled={line.qty <= 1}
                      onClick={() => onQty(line.item.id, line.qty - 1)}
                    >
                      <Minus aria-hidden />
                    </Button>
                    <input
                      aria-label={`Quantity of ${line.item.sku}`}
                      inputMode="numeric"
                      autoComplete="off"
                      className="h-10 w-14 rounded-md border border-input bg-canvas text-center font-mono text-body text-ink tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-fill"
                      value={line.qty}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => {
                        const next = Number.parseInt(event.target.value.replace(/\D/g, ""), 10);
                        if (!Number.isNaN(next)) onQty(line.item.id, next);
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-10"
                      aria-label={`One more ${line.item.sku}`}
                      disabled={line.qty >= available}
                      onClick={() => onQty(line.item.id, line.qty + 1)}
                    >
                      <Plus aria-hidden />
                    </Button>
                    <span className="ml-2 font-mono text-caption text-ink-subtle" data-numeric>
                      {formatPeso(line.item.priceCentavos)} ea
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 text-ink-subtle"
                    aria-label={`Remove ${line.item.sku}`}
                    onClick={() => onRemove(line.item.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="shrink-0 border-t border-hairline bg-surface-1 px-4 pt-3 pb-4">
        <Button
          variant="ghost"
          className="h-11 w-full justify-start px-2 text-ink-muted"
          onClick={onOpenDiscount}
          disabled={!canOpenDiscount || lines.length === 0}
        >
          <Percent aria-hidden />
          {discountLabel ?? "Add discount or promo"}
        </Button>

        <dl className="mt-2 flex flex-col gap-1 text-body-sm" data-numeric>
          <Row
            label="Subtotal"
            value={pricing ? formatPeso(pricing.subtotalCentavos) : formatPeso(0)}
          />
          {pricing && pricing.promoDiscountCentavos > 0 && promo ? (
            <Row
              label={`Promo ${promo.code}`}
              value={`-${formatPeso(pricing.promoDiscountCentavos)}`}
            />
          ) : null}
          {pricing && pricing.manualDiscountCentavos > 0 ? (
            <Row label="Discount" value={`-${formatPeso(pricing.manualDiscountCentavos)}`} />
          ) : null}
          <Row
            label="VAT included (12%)"
            value={pricing ? formatPeso(pricing.vatCentavos) : formatPeso(0)}
            muted
          />
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
            <dt className="text-body font-medium text-ink">Total</dt>
            <dd className="font-mono text-title text-ink tabular-nums" data-testid="cart-total">
              {formatPeso(pricing?.totalCentavos ?? 0)}
            </dd>
          </div>
        </dl>

        {preview.error || preview.overCap || preview.promoShortCentavos > 0 ? (
          <p role="alert" className="mt-2 text-caption text-danger">
            {preview.error ??
              (preview.overCap
                ? `Discount is ${(preview.manualBps / 100).toFixed(2)}% of the subtotal; your limit is ${(capBps ?? 0) / 100}%.`
                : `${promo?.code} needs ${formatPeso(preview.promoShortCentavos)} more in goods.`)}
          </p>
        ) : null}

        <Button
          variant="primary"
          className="mt-3 h-14 w-full text-lead"
          onClick={onCharge}
          disabled={chargeBlocked !== null}
          title={chargeBlocked ?? undefined}
        >
          {pricing ? `Charge ${formatPeso(pricing.totalCentavos)}` : "Charge"}
        </Button>
      </footer>
    </section>
  );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? "text-ink-subtle" : "text-ink-muted"}>{label}</dt>
      <dd className={cn("font-mono tabular-nums", muted ? "text-ink-subtle" : "text-ink")}>
        {value}
      </dd>
    </div>
  );
}
