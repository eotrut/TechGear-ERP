"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";

import { Input } from "@/components/ui/input";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import { searchSellableAction } from "../actions";
import type { SellablePick } from "../queries";

/**
 * Add-a-line combobox for an order. Scanner friendly like the stock pickers:
 * Enter takes the first match, and an exact SKU or barcode ranks first. Each
 * match shows its shelf price and what the chosen warehouse can still
 * promise, since that is what placing the order will reserve.
 */
export function SellablePicker({
  warehouseId,
  excludeIds,
  onPick,
}: {
  warehouseId: string;
  excludeIds: string[];
  onPick: (pick: SellablePick) => void;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SellablePick[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const visible = results.filter((result) => !excludeIds.includes(result.id));

  useEffect(() => {
    if (!open || !warehouseId) return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const response = await searchSellableAction({ query, warehouseId });
      if (request !== requestRef.current) return;
      setLoading(false);
      setResults(response.ok ? response.results : []);
      setActive(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, warehouseId, open]);

  function pick(result: SellablePick | undefined) {
    if (!result) return;
    onPick(result);
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(visible.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!loading) pick(visible[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <ScanBarcode
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-subtle"
        aria-hidden
      />
      <Input
        ref={inputRef}
        role="combobox"
        aria-expanded={open && visible.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && visible[active] ? `${listId}-${visible[active].id}` : undefined
        }
        aria-label="Add an item"
        value={query}
        disabled={!warehouseId}
        placeholder={
          warehouseId ? "Scan a barcode or search by SKU or name" : "Choose a warehouse first"
        }
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className="h-9 bg-canvas pl-8 text-body-sm dark:bg-canvas"
      />

      {open && warehouseId ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-hairline bg-surface-1 py-1 shadow-overlay"
        >
          {visible.length === 0 ? (
            <li className="px-3 py-2 text-body-sm text-ink-subtle">
              {loading
                ? "Searching"
                : query === ""
                  ? "Start typing to search"
                  : "Nothing on sale matches"}
            </li>
          ) : (
            visible.map((result, index) => {
              const available = result.onHand - result.reserved;
              return (
                <li
                  key={result.id}
                  id={`${listId}-${result.id}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(result);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5",
                    index === active && "bg-surface-3",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-body-sm text-ink">
                      {result.productName}
                    </span>
                    <span className="block truncate text-caption text-ink-subtle">
                      {result.optionSummary}{" "}
                      <span className="font-mono text-[11px]">{result.sku}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right" data-numeric>
                    <span className="block font-mono text-[12px] text-ink">
                      {formatPeso(result.priceCentavos)}
                    </span>
                    <span
                      className={cn(
                        "block font-mono text-[11px]",
                        available > 0 ? "text-ink-subtle" : "text-danger",
                      )}
                    >
                      {available > 0 ? `${available} avail.` : "none free"}
                    </span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
