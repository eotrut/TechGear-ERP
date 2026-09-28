"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Tag, Trash2, X } from "lucide-react";

import { Field, FormError, inputClass, selectClass } from "@/components/forms/field";
import { SearchCombobox, type ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { searchCustomersAction } from "@/features/customers/actions";
import { CHANNEL_LABEL } from "@/lib/channels";
import { DomainError } from "@/lib/errors";
import { formatPeso, parsePesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  checkPromoAction,
  createOrderAction,
  customerAddressesAction,
  sellablePositionsAction,
  updateOrderAction,
  type PromoPreview,
} from "../actions";
import type { AddressOption, SellablePick, WarehouseChoice } from "../queries";
import {
  MARKETPLACE_CHANNELS,
  ORDER_FORM_CHANNELS,
  orderFormSchema,
  type OrderFormValues,
  type OrderIntent,
  type TenderValues,
} from "../schemas";
import { manualDiscountFrom } from "../services/form";
import { manualDiscountBps, priceOrder, type OrderPricing } from "../services/pricing";
import { SellablePicker } from "./sellable-picker";
import { emptyTender, TenderFields, tenderTotals } from "./tender-fields";

/**
 * New order, or an edit to a draft.
 *
 * The summary is priced in the browser with the same pure function the server
 * uses, from catalogue prices the server sent, so what a person sees is what
 * will be saved. The server prices it again from the database regardless, and
 * checks stock, the promo and the discount cap inside the transaction.
 */

type AppliedPromo = Extract<PromoPreview, { ok: true }>;

function lineError(message?: string) {
  if (!message) return null;
  return (
    <p role="alert" className="text-caption text-danger">
      {message}
    </p>
  );
}

export function OrderForm({
  mode,
  orderId,
  defaults,
  initialPicks,
  initialCustomer,
  warehouses,
  canPromo,
  canPay,
  discountCapBps,
}: {
  mode: "create" | "edit";
  orderId?: string;
  defaults: OrderFormValues;
  initialPicks: SellablePick[];
  initialCustomer: ComboOption | null;
  warehouses: WarehouseChoice[];
  canPromo: boolean;
  canPay: boolean;
  discountCapBps: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingIntent, setPendingIntent] = useState<OrderIntent | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, SellablePick>>(() =>
    Object.fromEntries(initialPicks.map((pick) => [pick.id, pick])),
  );
  const [customer, setCustomer] = useState<ComboOption | null>(initialCustomer);
  const [addresses, setAddresses] = useState<AddressOption[]>([]);
  const [promoInput, setPromoInput] = useState(defaults.promoCode);
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [tenders, setTenders] = useState<TenderValues[]>([]);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<OrderFormValues>({ resolver: zodResolver(orderFormSchema), defaultValues: defaults });

  const lines = useFieldArray({ control, name: "lines" });
  const channel = useWatch({ control, name: "channel" });
  const warehouseId = useWatch({ control, name: "warehouseId" });
  const watchedLines = useWatch({ control, name: "lines" });
  const shipping = useWatch({ control, name: "shipping" });
  const discountType = useWatch({ control, name: "manualDiscountType" });
  const discountValue = useWatch({ control, name: "manualDiscountValue" });
  const shippingAddressId = useWatch({ control, name: "shippingAddressId" });
  const marketplace = MARKETPLACE_CHANNELS.includes(channel);

  // ------------------------------------------------------------ pricing

  const priced = useMemo((): { pricing: OrderPricing | null; error: string | null } => {
    const rows = (watchedLines ?? []).filter((line) => line?.variantId && picks[line.variantId]);
    if (rows.length === 0) return { pricing: null, error: null };
    try {
      const pricing = priceOrder({
        lines: rows.map((line) => ({
          unitPriceCentavos: picks[line.variantId]?.priceCentavos ?? 0,
          qty: Number.isFinite(line.qty) && line.qty > 0 ? line.qty : 1,
          discountCentavos: parsePesoInput(line.discount ?? "") ?? 0,
        })),
        promo: promo
          ? { type: promo.type, percentBps: promo.percentBps, amountCentavos: promo.amountCentavos }
          : null,
        manualDiscount: (() => {
          try {
            return manualDiscountFrom(discountType, discountValue ?? "");
          } catch {
            return null;
          }
        })(),
        shippingCentavos: parsePesoInput(shipping ?? "") ?? 0,
      });
      return { pricing, error: null };
    } catch (error) {
      return {
        pricing: null,
        error: error instanceof DomainError ? error.message : "The totals could not be worked out.",
      };
    }
  }, [watchedLines, picks, promo, discountType, discountValue, shipping]);

  const pricing = priced.pricing;
  const total = pricing?.totalCentavos ?? 0;
  const manualBps = pricing ? manualDiscountBps(pricing) : 0;
  const overCap = discountCapBps !== null && manualBps > discountCapBps;
  const promoShort =
    promo && pricing ? pricing.merchandiseCentavos < promo.minSubtotalCentavos : false;

  // ----------------------------------------------------------- effects

  const loadAddresses = useCallback(
    (customerId: string, keep: boolean) => {
      startTransition(async () => {
        const result = await customerAddressesAction({ customerId });
        const list = result.ok ? result.results : [];
        setAddresses(list);
        if (!keep) setValue("shippingAddressId", list[0]?.id ?? "");
      });
    },
    [setValue],
  );

  useEffect(() => {
    if (initialCustomer) loadAddresses(initialCustomer.id, true);
  }, [initialCustomer, loadAddresses]);

  const applyPromo = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (trimmed === "") return;
      setPromoError(null);
      startTransition(async () => {
        const result = await checkPromoAction({
          code: trimmed,
          customerId: getValues("customerId"),
          merchandiseCentavos: priced.pricing?.merchandiseCentavos ?? 0,
        });
        if (result.ok) {
          setPromo(result);
          setPromoInput(result.code);
        } else {
          setPromo(null);
          setPromoError(result.error);
        }
      });
    },
    [getValues, priced.pricing?.merchandiseCentavos],
  );

  // A draft that already carries a promo shows it applied from the start.
  const [checkedInitialPromo, setCheckedInitialPromo] = useState(false);
  useEffect(() => {
    if (checkedInitialPromo || !defaults.promoCode || !priced.pricing) return;
    setCheckedInitialPromo(true);
    applyPromo(defaults.promoCode);
  }, [checkedInitialPromo, defaults.promoCode, priced.pricing, applyPromo]);

  function changeWarehouse(next: string) {
    const ids = getValues("lines").map((line) => line.variantId);
    if (ids.length === 0 || !next) return;
    startTransition(async () => {
      const result = await sellablePositionsAction({ ids, warehouseId: next });
      if (result.ok) {
        setPicks((current) => ({
          ...current,
          ...Object.fromEntries(result.results.map((row) => [row.id, row])),
        }));
      }
    });
  }

  function addLine(pick: SellablePick) {
    setPicks((current) => ({ ...current, [pick.id]: pick }));
    lines.append({ variantId: pick.id, qty: 1, discount: "" });
  }

  function togglePaying(next: boolean) {
    setPaying(next);
    setTenders(next ? [emptyTender(channel === "B2B" ? "BANK_TRANSFER" : "GCASH", total)] : []);
  }

  // ------------------------------------------------------------ submit

  function submit(intent: OrderIntent) {
    setValue("intent", intent);
    setValue("tenders", intent === "paid" ? tenders : []);
    setValue("promoCode", promo ? promo.code : "");
    void handleSubmit((values) => {
      setServerError(null);
      setPendingIntent(intent);
      startTransition(async () => {
        const result =
          mode === "edit" && orderId
            ? await updateOrderAction({ orderId, values })
            : await createOrderAction(values);
        setPendingIntent(null);
        if (!result.ok) {
          setServerError(result.error);
          return;
        }
        toast.success(result.message ?? "Saved.");
        router.push(result.id ? `/orders/${result.id}` : "/orders");
        router.refresh();
      });
    })();
  }

  const channelField = register("channel");
  const warehouseField = register("warehouseId");
  const paidReady = paying && tenderTotals(tenders, total).remaining === 0;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(paying ? "paid" : "place");
      }}
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start"
      noValidate
    >
      <div className="flex min-w-0 flex-col gap-5">
        {/* ------------------------------------------------ the order */}
        <section className="grid gap-4 rounded-lg border border-hairline bg-surface-1 p-4 sm:grid-cols-2">
          <Field id="channel" label="Channel" error={errors.channel?.message}>
            <select
              id="channel"
              className={selectClass}
              {...channelField}
              onChange={(event) => {
                void channelField.onChange(event);
              }}
            >
              {ORDER_FORM_CHANNELS.map((value) => (
                <option key={value} value={value}>
                  {CHANNEL_LABEL[value]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id="channelReference"
            label={marketplace ? `${CHANNEL_LABEL[channel]} order number` : "Customer reference"}
            hint={
              marketplace
                ? "Required, so the order can be matched against the marketplace payout."
                : "Optional: a PO number or chat thread."
            }
            error={errors.channelReference?.message}
          >
            <Input
              id="channelReference"
              className={cn(inputClass, "font-mono")}
              {...register("channelReference")}
            />
          </Field>

          <Field
            id="customer"
            label="Customer"
            hint={
              channel === "B2B"
                ? "B2B orders are billed to a business account."
                : "Optional for marketplace buyers."
            }
            error={errors.customerId?.message}
          >
            <SearchCombobox
              id="customer"
              value={customer}
              placeholder="Search by name, email, phone or code"
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
                setCustomer(option);
                setValue("customerId", option?.id ?? "");
                setAddresses([]);
                setValue("shippingAddressId", "");
                if (option) loadAddresses(option.id, false);
              }}
            />
          </Field>

          <Field
            id="shippingAddressId"
            label="Ship to"
            hint={
              customer && addresses.length === 0
                ? "No address on file. Add one on the customer record."
                : undefined
            }
          >
            <select
              id="shippingAddressId"
              className={selectClass}
              disabled={!customer || addresses.length === 0}
              // Controlled: the options arrive after the value is chosen, and an
              // uncontrolled select would fall back to its first option.
              value={shippingAddressId ?? ""}
              onChange={(event) => setValue("shippingAddressId", event.target.value)}
            >
              <option value="">{customer ? "No address" : "Choose a customer first"}</option>
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id="warehouseId"
            label="Ships from"
            hint="Stock is reserved here when the order is placed."
            error={errors.warehouseId?.message}
          >
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
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code}, {warehouse.name}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id="shipping"
            label="Shipping charged"
            hint="VAT-inclusive, like every price here."
            error={errors.shipping?.message}
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

        {/* ---------------------------------------------------- items */}
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-section text-ink">Items</h2>
            {discountCapBps !== null ? (
              <span className="text-caption text-ink-subtle">
                Manual discounts are capped at {discountCapBps / 100} percent for your role.
              </span>
            ) : null}
          </div>
          <SellablePicker
            warehouseId={warehouseId}
            excludeIds={lines.fields.map((field) => field.variantId)}
            onPick={addLine}
          />
          {lineError(errors.lines?.message ?? errors.lines?.root?.message)}

          {lines.fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
              Scan or search above to add the first item.
            </p>
          ) : (
            <div className="relative overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-1 text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="w-20 px-2 py-2 text-right font-medium">Qty</th>
                    <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">Price</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">Discount</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="w-10 px-1 py-2">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.fields.map((field, index) => {
                    const pick = picks[field.variantId];
                    const qty = watchedLines?.[index]?.qty ?? 0;
                    const available = pick ? pick.onHand - pick.reserved : 0;
                    const short = Number.isFinite(qty) && qty > available;
                    const line = pricing?.lines[index];
                    const rowErrors = errors.lines?.[index];
                    return (
                      <tr
                        key={field.id}
                        className="border-b border-hairline align-top last:border-b-0"
                      >
                        <td className="px-3 py-2">
                          <span className="block max-w-[20rem] truncate text-ink">
                            {pick?.productName ?? "Unknown item"}
                          </span>
                          <span className="block max-w-[20rem] truncate text-caption text-ink-subtle">
                            {pick?.optionSummary}{" "}
                            <span className="font-mono text-[11px]">{pick?.sku}</span>
                          </span>
                          <span
                            className={cn(
                              "text-caption",
                              short ? "text-danger" : "text-ink-subtle",
                            )}
                            data-numeric
                          >
                            {short
                              ? `Only ${Math.max(0, available)} free to promise`
                              : `${available} free to promise`}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            aria-label={`Quantity for ${pick?.sku ?? "item"}`}
                            type="number"
                            min={1}
                            inputMode="numeric"
                            className={cn(inputClass, "w-16 text-right font-mono")}
                            {...register(`lines.${index}.qty`, { valueAsNumber: true })}
                          />
                          {lineError(rowErrors?.qty?.message)}
                        </td>
                        <td
                          className="hidden px-2 py-2 pt-3.5 text-right font-mono text-ink-muted sm:table-cell"
                          data-numeric
                        >
                          {pick ? formatPeso(pick.priceCentavos) : ""}
                        </td>
                        <td className="px-2 py-2">
                          <Input
                            aria-label={`Discount for ${pick?.sku ?? "item"}`}
                            inputMode="decimal"
                            placeholder="0.00"
                            className={cn(inputClass, "w-24 text-right font-mono")}
                            {...register(`lines.${index}.discount`)}
                          />
                          {lineError(rowErrors?.discount?.message)}
                        </td>
                        <td
                          className="px-3 py-2 pt-3.5 text-right font-mono whitespace-nowrap text-ink"
                          data-numeric
                        >
                          {line ? formatPeso(line.lineTotalCentavos) : ""}
                          {line && line.allocatedDiscountCentavos > 0 ? (
                            <span className="block text-[11px] text-ink-subtle">
                              incl. -{formatPeso(line.allocatedDiscountCentavos)} order
                            </span>
                          ) : null}
                        </td>
                        <td className="px-1 py-2">
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
          )}
        </section>

        {canPay ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="paying"
                checked={paying}
                disabled={!pricing || total === 0}
                onCheckedChange={(checked) => togglePaying(checked === true)}
              />
              <Label htmlFor="paying" className="text-body-sm text-ink">
                The customer has already paid
              </Label>
            </div>
            {paying ? (
              <TenderFields
                idPrefix="tender"
                tenders={tenders}
                onChange={setTenders}
                dueCentavos={total}
              />
            ) : (
              <p className="text-caption text-ink-subtle">
                Otherwise the order waits as pending, holding its stock, until payment is recorded.
              </p>
            )}
          </section>
        ) : null}

        <Field
          id="notes"
          label="Notes"
          hint="Printed nowhere; for the team."
          error={errors.notes?.message}
        >
          <Textarea id="notes" rows={3} {...register("notes")} />
        </Field>
      </div>

      {/* ------------------------------------------------------ summary */}
      <aside className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface-1 p-4 lg:sticky lg:top-4">
        <h2 className="text-section text-ink">Summary</h2>

        {canPromo ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="promo" className="text-caption font-medium text-ink-muted">
              Promo code
            </Label>
            {promo ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-canvas px-2.5 py-1.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Tag className="size-3.5 shrink-0 text-accent-strong" aria-hidden />
                  <span className="font-mono text-[12px] text-ink">{promo.code}</span>
                  <span className="truncate text-caption text-ink-subtle">{promo.description}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove promo"
                  onClick={() => {
                    setPromo(null);
                    setPromoInput("");
                  }}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input
                  id="promo"
                  value={promoInput}
                  onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyPromo(promoInput);
                    }
                  }}
                  placeholder="Enter a code"
                  className={cn(inputClass, "font-mono uppercase placeholder:normal-case")}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  disabled={promoInput.trim() === "" || !pricing}
                  onClick={() => applyPromo(promoInput)}
                >
                  Apply
                </Button>
              </div>
            )}
            {promoError ? lineError(promoError) : null}
            {promoShort && promo ? (
              <p className="text-caption text-warning" data-numeric>
                {promo.code} needs {formatPeso(promo.minSubtotalCentavos)} of goods; this order has{" "}
                {formatPeso(pricing?.merchandiseCentavos ?? 0)}.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="manualDiscountType" className="text-caption font-medium text-ink-muted">
              Order discount
            </Label>
            <select
              id="manualDiscountType"
              className={selectClass}
              {...register("manualDiscountType")}
            >
              <option value="NONE">None</option>
              <option value="PERCENT">Percent</option>
              <option value="FIXED">Pesos</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="manualDiscountValue"
              className="text-caption font-medium text-ink-muted"
            >
              {discountType === "PERCENT" ? "Percent off" : "Amount off"}
            </Label>
            <Input
              id="manualDiscountValue"
              inputMode="decimal"
              disabled={discountType === "NONE"}
              className={cn(inputClass, "text-right font-mono")}
              {...register("manualDiscountValue")}
            />
          </div>
          <div className="col-span-2">{lineError(errors.manualDiscountValue?.message)}</div>
        </div>

        {pricing ? (
          <dl className="flex flex-col gap-1 border-t border-hairline pt-3 text-body-sm">
            <Row label="Subtotal" value={formatPeso(pricing.subtotalCentavos)} />
            {pricing.lineDiscountCentavos > 0 ? (
              <Row label="Line discounts" value={`-${formatPeso(pricing.lineDiscountCentavos)}`} />
            ) : null}
            {pricing.promoDiscountCentavos > 0 ? (
              <Row
                label={`Promo ${promo?.code ?? ""}`}
                value={`-${formatPeso(pricing.promoDiscountCentavos)}`}
              />
            ) : null}
            {pricing.manualDiscountCentavos > 0 ? (
              <Row
                label="Order discount"
                value={`-${formatPeso(pricing.manualDiscountCentavos)}`}
              />
            ) : null}
            <Row
              label="Shipping"
              value={pricing.shippingCentavos > 0 ? formatPeso(pricing.shippingCentavos) : "Free"}
            />
            <div className="mt-1 flex items-baseline justify-between border-t border-hairline pt-2">
              <dt className="font-medium text-ink">Total</dt>
              <dd className="font-mono text-lead font-medium text-ink" data-numeric>
                {formatPeso(pricing.totalCentavos)}
              </dd>
            </div>
            <Row label="VAT included, 12%" value={formatPeso(pricing.vatCentavos)} subtle />
            <Row label="VATable sales" value={formatPeso(pricing.vatableSalesCentavos)} subtle />
          </dl>
        ) : (
          <p className="border-t border-hairline pt-3 text-body-sm text-ink-subtle">
            {priced.error ?? "Add an item to see the total."}
          </p>
        )}
        {pricing && priced.error === null && overCap ? (
          <p role="alert" className="text-caption text-danger" data-numeric>
            Manual discounts come to {(manualBps / 100).toFixed(2)} percent. Your limit is{" "}
            {(discountCapBps ?? 0) / 100} percent.
          </p>
        ) : null}

        <FormError message={serverError} />

        <div className="flex flex-col gap-2">
          {paying ? (
            <Button type="submit" variant="primary" size="lg" disabled={isPending || !paidReady}>
              {pendingIntent === "paid" ? "Placing" : `Place and record ${formatPeso(total)}`}
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="lg" disabled={isPending || !pricing}>
              {pendingIntent === "place" ? "Placing" : "Place order"}
            </Button>
          )}
          {!marketplace ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={isPending || !pricing}
              onClick={() => submit("draft")}
            >
              {pendingIntent === "draft"
                ? "Saving"
                : mode === "edit"
                  ? "Save draft"
                  : "Save as draft"}
            </Button>
          ) : null}
          <p className="text-caption text-ink-subtle">
            {marketplace
              ? "Marketplace orders are already placed, so they start as pending and hold their stock."
              : "Placing reserves the stock. A draft holds nothing and can be edited."}
          </p>
        </div>
      </aside>
    </form>
  );
}

function Row({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={subtle ? "text-ink-subtle" : "text-ink-muted"}>{label}</dt>
      <dd className={cn("font-mono", subtle ? "text-ink-subtle" : "text-ink")} data-numeric>
        {value}
      </dd>
    </div>
  );
}
