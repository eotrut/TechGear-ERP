"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { VariantPick } from "../queries";

/**
 * Add-a-line combobox for the adjustment, transfer and purchase order forms.
 *
 * Built for a barcode scanner as much as a keyboard: a scanner types the code
 * and presses Enter, so Enter takes the first match, and an exact SKU or
 * barcode always ranks first. Arrow keys move through the matches, Escape
 * closes the list. Each match shows what is available in the chosen
 * warehouse, because that is the number the line is about to change.
 */
type SearchResult<T> = { ok: true; results: T[] } | { ok: false; error: string };

export function VariantPicker<T extends VariantPick>({
  warehouseId,
  excludeIds,
  onPick,
  search,
  disabled = false,
  placeholder = "Scan a barcode or search by SKU or name",
}: {
  warehouseId: string;
  excludeIds: string[];
  onPick: (pick: T) => void;
  /** The server action that finds matches. Purchasing passes one that also returns cost. */
  search: (input: { query: string; warehouseId: string }) => Promise<SearchResult<T>>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const visible = results.filter((result) => !excludeIds.includes(result.id));

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const response = await search({ query, warehouseId });
      // Only the latest request may update the list, however they resolve.
      if (request !== requestRef.current) return;
      setLoading(false);
      setResults(response.ok ? response.results : []);
      setActive(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, warehouseId, open, search]);

  function pick(result: T | undefined) {
    if (!result) return;
    onPick(result);
    setQuery("");
    setActive(0);
    setOpen(true);
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
      // Never submit the surrounding form from the picker.
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
        disabled={disabled}
        placeholder={disabled ? "Choose a warehouse first" : placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        className="h-9 pl-8 text-body-sm"
      />

      {open && !disabled ? (
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
                  : "No matching variants"}
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
                  <span
                    data-numeric
                    className={cn(
                      "shrink-0 font-mono text-[12px]",
                      available > 0 ? "text-ink-muted" : "text-danger",
                    )}
                  >
                    {available} avail.
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
