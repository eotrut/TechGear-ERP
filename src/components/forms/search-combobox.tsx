"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Type-ahead picker for a single record: a customer, a product variant. The
 * search runs on the server through a server action, debounced, and only the
 * latest response is allowed to update the list however they resolve.
 *
 * Keyboard first, like the rest of the app: arrows move, Enter picks, Escape
 * closes. Once something is picked it shows as a chip with a clear button, so
 * the choice is obvious and changing it is one click.
 */

export type ComboOption = {
  id: string;
  label: string;
  detail?: string | null;
  /** Short mono tag on the right: a code, a segment. */
  meta?: string | null;
};

export function SearchCombobox({
  id,
  value,
  onChange,
  search,
  placeholder,
  invalid = false,
  disabled = false,
  emptyText = "No matches",
  touch = false,
  autoFocus = false,
}: {
  id: string;
  value: ComboOption | null;
  onChange: (option: ComboOption | null) => void;
  search: (query: string) => Promise<ComboOption[]>;
  placeholder: string;
  invalid?: boolean;
  disabled?: boolean;
  emptyText?: string;
  /** 44px targets, for the register. */
  touch?: boolean;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComboOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const found = await search(query);
      if (request !== requestRef.current) return;
      setLoading(false);
      setResults(found);
      setActive(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, open, search]);

  function pick(option: ComboOption | undefined) {
    if (!option) return;
    onChange(option);
    setQuery("");
    setOpen(false);
  }

  if (value) {
    return (
      <div
        className={cn(
          "flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-surface-1 pr-1 pl-2.5",
          touch && "h-11",
          disabled && "opacity-50",
        )}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-body-sm text-ink">{value.label}</span>
          {value.meta ? (
            <span className="shrink-0 font-mono text-[11px] text-ink-subtle">{value.meta}</span>
          ) : null}
        </span>
        {!disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label={`Clear ${value.label}`}
            onClick={() => {
              onChange(null);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-subtle"
        aria-hidden
      />
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={
          open && results[active] ? `${listId}-${results[active].id}` : undefined
        }
        autoComplete="off"
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (!loading) pick(results[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        autoFocus={autoFocus}
        className={cn("h-8 bg-canvas pl-8 text-body-sm", touch && "h-11 text-body")}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-40 mt-1 max-h-72 overflow-y-auto rounded-md border border-hairline bg-surface-1 py-1 shadow-overlay"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-body-sm text-ink-subtle">
              {loading ? "Searching" : emptyText}
            </li>
          ) : (
            results.map((option, index) => (
              <li
                key={option.id}
                id={`${listId}-${option.id}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5",
                  touch && "py-2.5",
                  index === active && "bg-surface-3",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-body-sm text-ink">{option.label}</span>
                  {option.detail ? (
                    <span className="block truncate text-caption text-ink-subtle">
                      {option.detail}
                    </span>
                  ) : null}
                </span>
                {option.meta ? (
                  <span className="shrink-0 font-mono text-[11px] text-ink-subtle">
                    {option.meta}
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
