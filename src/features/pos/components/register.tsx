"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, PackageSearch, ScanBarcode, X } from "lucide-react";

import type { ComboOption } from "@/components/forms/search-combobox";
import { Button } from "@/components/ui/button";
import type { WarehouseChoice } from "@/features/orders/queries";
import type { MANUAL_DISCOUNT_TYPES, TenderValues } from "@/features/orders/schemas";
import { formatPeso, parsePesoInput } from "@/lib/money";
import { cn } from "@/lib/utils";

import { ringUpSaleAction, searchRegisterAction } from "../actions";
import type { RegisterItem } from "../queries";
import { previewSale, type AppliedPromo } from "../services/sale";
import { CartPanel, type CartLine } from "./cart-panel";
import { ItemTile } from "./item-tile";
import { PaymentDialog } from "./payment-dialog";
import { CustomerDialog, DiscountDialog } from "./sale-dialogs";

type DiscountType = (typeof MANUAL_DISCOUNT_TYPES)[number];
type Notice = { tone: "danger" | "info"; text: string };

/**
 * The register. A barcode scanner is a keyboard that types fast and presses
 * Enter, so any printable key pressed while focus sits on a tile or a button
 * is sent back to the scan field. Taps never move focus into the field
 * themselves, because on a tablet that would raise the on-screen keyboard
 * after every tap. Enter in the field adds the exact SKU or barcode match
 * without anyone looking at the screen, and Enter on an empty field opens
 * payment, so scan, scan, Enter, Enter rings up a sale.
 *
 * Nothing here decides a price or a payment. The cart previews with the
 * order service's own pure functions, and the sale is recorded by the order
 * service on the server, which prices it again from the catalogue.
 */
export function Register({
  warehouses,
  warehouseId,
  quickPicks,
  capBps,
  canDiscount,
  canPromo,
  canVoid,
  canAttachCustomer,
}: {
  warehouses: WarehouseChoice[];
  warehouseId: string;
  quickPicks: RegisterItem[];
  capBps: number | null;
  canDiscount: boolean;
  canPromo: boolean;
  canVoid: boolean;
  canAttachCustomer: boolean;
}) {
  const router = useRouter();
  const store = warehouses.find((warehouse) => warehouse.id === warehouseId);
  const storeCode = store?.code ?? "this store";

  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegisterItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const [lines, setLines] = useState<CartLine[]>([]);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<ComboOption | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType>("NONE");
  const [discountValue, setDiscountValue] = useState("");
  const [promo, setPromo] = useState<AppliedPromo | null>(null);

  const [dialog, setDialog] = useState<"pay" | "discount" | "customer" | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [recording, startRecording] = useTransition();

  const preview = useMemo(
    () =>
      previewSale({
        lines: lines.map((line) => ({
          unitPriceCentavos: line.item.priceCentavos,
          qty: line.qty,
        })),
        discountType,
        discountValue,
        promo,
        capBps,
      }),
    [lines, discountType, discountValue, promo, capBps],
  );

  const chargeBlocked =
    lines.length === 0
      ? "Add an item first."
      : preview.error
        ? preview.error
        : preview.overCap
          ? "The discount is over your limit."
          : preview.promoShortCentavos > 0
            ? "The promo's minimum spend is not met."
            : null;

  const inCart = useMemo(() => new Map(lines.map((line) => [line.item.id, line.qty])), [lines]);

  // ------------------------------------------------------------------ search

  useEffect(() => {
    const term = query.trim();
    const request = ++requestRef.current;
    if (term === "") {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const response = await searchRegisterAction({ query: term, warehouseId });
      if (request !== requestRef.current) return;
      setSearching(false);
      setResults(response.ok ? response.results : []);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query, warehouseId]);

  // A scanner types wherever focus is. Send stray keystrokes back to the field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (dialog || document.querySelector("[role=dialog]")) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  function focusScanner() {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  // -------------------------------------------------------------------- cart

  function addItem(item: RegisterItem) {
    const available = item.onHand - item.reserved;
    const existing = lines.find((line) => line.item.id === item.id);
    const nextQty = (existing?.qty ?? 0) + 1;
    if (available <= 0) {
      setNotice({ tone: "danger", text: `${item.sku} is out of stock at ${storeCode}.` });
      return;
    }
    if (nextQty > available) {
      setNotice({
        tone: "danger",
        text: `Only ${available} of ${item.sku} left at ${storeCode}, all in this sale.`,
      });
      return;
    }
    setLines(
      existing
        ? lines.map((line) => (line.item.id === item.id ? { item, qty: nextQty } : line))
        : [{ item, qty: 1 }, ...lines],
    );
    setLastAddedId(item.id);
    setAnnouncement(`Added ${item.productName}. ${nextQty} in the sale.`);
    setNotice(null);
    setQuery("");
    setResults(null);
  }

  function setQty(id: string, qty: number) {
    const line = lines.find((candidate) => candidate.item.id === id);
    if (!line) return;
    const available = line.item.onHand - line.item.reserved;
    const next = Math.max(1, Math.min(qty, available, 9_999));
    if (qty > available) {
      setNotice({
        tone: "danger",
        text: `Only ${available} of ${line.item.sku} left at ${storeCode}.`,
      });
    } else {
      setNotice(null);
    }
    setLines(
      lines.map((candidate) =>
        candidate.item.id === id ? { ...candidate, qty: next } : candidate,
      ),
    );
  }

  function removeLine(id: string) {
    const next = lines.filter((line) => line.item.id !== id);
    setLines(next);
    if (next.length === 0) clearDiscounts();
  }

  function clearDiscounts() {
    setDiscountType("NONE");
    setDiscountValue("");
    setPromo(null);
  }

  function voidSale() {
    setLines([]);
    setCustomer(null);
    clearDiscounts();
    setLastAddedId(null);
    setNotice(null);
    setAnnouncement("Sale voided.");
  }

  // -------------------------------------------------------------------- scan

  async function submitScan() {
    const code = query.trim();
    if (code === "") {
      if (!chargeBlocked) openPayment();
      return;
    }
    const request = ++requestRef.current;
    setSearching(true);
    const response = await searchRegisterAction({ query: code, warehouseId });
    if (request !== requestRef.current) return;
    setSearching(false);
    const found = response.ok ? response.results : [];
    setResults(found);

    const lower = code.toLowerCase();
    const exact = found.find((item) => item.sku.toLowerCase() === lower || item.barcode === code);
    const pick = exact ?? (found.length === 1 ? found[0] : undefined);
    if (pick) {
      addItem(pick);
    } else if (found.length === 0) {
      setNotice({ tone: "danger", text: `Nothing on sale matches "${code}".` });
      inputRef.current?.select();
    } else {
      setNotice({ tone: "info", text: `${found.length} items match. Tap the one you want.` });
    }
  }

  // ----------------------------------------------------------------- payment

  function openPayment() {
    setSaleError(null);
    setDialog("pay");
  }

  function completeSale(tenders: TenderValues[]) {
    setSaleError(null);
    startRecording(async () => {
      const result = await ringUpSaleAction({
        warehouseId,
        customerId: customer?.id ?? "",
        lines: lines.map((line) => ({ variantId: line.item.id, qty: line.qty })),
        discountType,
        discountValue,
        promoCode: promo?.code ?? "",
        tenders,
      });
      if (!result.ok) {
        setSaleError(result.error);
        return;
      }
      router.push(`/pos/receipt/${result.id}`);
    });
  }

  const discountLabel = (() => {
    const parts: string[] = [];
    if (promo) parts.push(`Promo ${promo.code}`);
    if (discountType === "PERCENT" && discountValue) parts.push(`${discountValue}% off`);
    if (discountType === "FIXED" && discountValue)
      parts.push(`${formatPeso(parsePesoInput(discountValue) ?? 0)} off`);
    return parts.length > 0 ? parts.join(", ") : null;
  })();

  const shown = results ?? quickPicks;

  return (
    <>
      <div className="flex flex-1 flex-col md:grid md:h-[calc(100dvh-3.5rem)] md:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section aria-label="Find items" className="flex min-h-0 flex-col">
          <div className="flex shrink-0 flex-col gap-2 border-b border-hairline p-3 sm:flex-row md:p-4">
            <div className="relative flex-1">
              <ScanBarcode
                className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-subtle"
                aria-hidden
              />
              <input
                ref={inputRef}
                id="pos-scan"
                type="search"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="enter"
                aria-label="Scan a barcode or search items"
                aria-describedby="pos-scan-hint"
                placeholder="Scan a barcode, or type a SKU or name"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setNotice(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitScan();
                  } else if (event.key === "Escape") {
                    setQuery("");
                  }
                }}
                className={cn(
                  "h-12 w-full rounded-md border border-input bg-canvas pr-11 pl-11 text-lead text-ink",
                  "placeholder:text-ink-subtle [&::-webkit-search-cancel-button]:hidden",
                  "outline-none focus-visible:border-accent-fill focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent-fill",
                )}
              />
              {searching ? (
                <LoaderCircle
                  className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-ink-subtle"
                  aria-hidden
                />
              ) : query ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-1/2 right-1.5 size-9 -translate-y-1/2"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    focusScanner();
                  }}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
            {warehouses.length > 1 ? (
              <label className="flex shrink-0 items-center gap-2">
                <span className="text-caption text-ink-subtle">Store</span>
                <select
                  aria-label="Store this register sells from"
                  className="h-12 min-w-0 flex-1 rounded-md border border-input bg-canvas px-3 font-mono text-body-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent-fill disabled:opacity-60 sm:flex-none"
                  value={warehouseId}
                  disabled={lines.length > 0}
                  title={lines.length > 0 ? "Finish or void this sale to change store." : undefined}
                  onChange={(event) => router.replace(`/pos?store=${event.target.value}`)}
                >
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.code}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
            <div className="mb-3 flex min-h-5 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-body-sm font-medium text-ink-muted">
                {results
                  ? `${results.length === 24 ? "First 24" : results.length} match${results.length === 1 ? "" : "es"} for "${query.trim()}"`
                  : `Top sellers at ${storeCode}`}
              </h2>
              <p id="pos-scan-hint" className="hidden text-caption text-ink-subtle lg:block">
                Enter adds an exact SKU or barcode. Enter on an empty field takes payment.
              </p>
            </div>

            {notice ? (
              <p
                role={notice.tone === "danger" ? "alert" : "status"}
                className={cn(
                  "mb-3 rounded-md px-3 py-2 text-body-sm",
                  notice.tone === "danger"
                    ? "bg-danger-wash text-danger"
                    : "bg-info-wash text-info",
                )}
              >
                {notice.text}
              </p>
            ) : null}

            {shown.length === 0 ? (
              <div className="flex flex-col items-center rounded-lg border border-dashed border-hairline-strong px-6 py-12 text-center">
                <PackageSearch className="mb-3 size-5 text-ink-subtle" aria-hidden />
                <p className="text-body font-medium text-ink">
                  {results ? "Nothing on sale matches" : "No recent counter sales here"}
                </p>
                <p className="mt-1 max-w-[42ch] text-body-sm text-ink-subtle">
                  {results
                    ? "Check the SKU or barcode, or search by product name."
                    : "Scan a barcode or search by SKU or name to add the first item."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shown.map((item) => (
                  <ItemTile
                    key={item.id}
                    item={item}
                    inCart={inCart.get(item.id) ?? 0}
                    onAdd={addItem}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Phones stack the cart under the grid; this bar holds the bottom edge until it arrives. */}
        {lines.length > 0 ? (
          <div className="no-print sticky bottom-0 z-20 flex items-center gap-3 border-t border-hairline bg-canvas px-4 py-3 md:hidden">
            <a href="#cart" className="min-w-0 flex-1">
              <span className="block text-caption text-ink-subtle">
                {`${lines.length} line${lines.length === 1 ? "" : "s"}, view sale`}
              </span>
              <span className="block font-mono text-lead text-ink tabular-nums">
                {formatPeso(preview.pricing?.totalCentavos ?? 0)}
              </span>
            </a>
            <Button
              variant="primary"
              className="h-12 px-6 text-body"
              onClick={openPayment}
              disabled={chargeBlocked !== null}
            >
              Charge
            </Button>
          </div>
        ) : null}
        <CartPanel
          className="border-t border-hairline md:border-t-0 md:border-l"
          lines={lines}
          lastAddedId={lastAddedId}
          onQty={setQty}
          onRemove={removeLine}
          onVoid={voidSale}
          canVoid={canVoid}
          customer={customer}
          onAddCustomer={() => setDialog("customer")}
          onClearCustomer={() => {
            setCustomer(null);
            setPromo(null);
          }}
          canAttachCustomer={canAttachCustomer}
          discountLabel={discountLabel}
          onOpenDiscount={() => setDialog("discount")}
          canOpenDiscount={canDiscount || canPromo}
          promo={promo}
          preview={preview}
          capBps={capBps}
          onCharge={openPayment}
          chargeBlocked={chargeBlocked}
        />
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <PaymentDialog
        open={dialog === "pay"}
        onOpenChange={(open) => {
          setDialog(open ? "pay" : null);
        }}
        dueCentavos={preview.pricing?.totalCentavos ?? 0}
        pending={recording}
        error={saleError}
        onComplete={completeSale}
      />
      <DiscountDialog
        open={dialog === "discount"}
        onOpenChange={(open) => {
          setDialog(open ? "discount" : null);
        }}
        discountType={discountType}
        discountValue={discountValue}
        onDiscount={(type, value) => {
          setDiscountType(type);
          setDiscountValue(value);
        }}
        capBps={capBps}
        canDiscount={canDiscount}
        canPromo={canPromo}
        promo={promo}
        onPromo={setPromo}
        merchandiseCentavos={preview.pricing?.merchandiseCentavos ?? 0}
        customerId={customer?.id ?? ""}
      />
      <CustomerDialog
        open={dialog === "customer"}
        onOpenChange={(open) => {
          setDialog(open ? "customer" : null);
        }}
        onPick={(option) => {
          setCustomer(option);
          // A promo's per-customer limit depends on who is buying; check it again.
          setPromo(null);
        }}
      />
    </>
  );
}
