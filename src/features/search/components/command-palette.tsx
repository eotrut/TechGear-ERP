"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  ClipboardList,
  CornerDownLeft,
  Moon,
  Package,
  Search,
  ShoppingCart,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { paletteEntriesFor } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { paletteSearchAction } from "../actions";
import { PALETTE_GROUP_LABEL, PALETTE_GROUPS, type PaletteGroup } from "../schemas";
import { MIN_RECORD_QUERY, rankMatches } from "../services/palette-rules";

/**
 * Ctrl/Cmd+K. Jump to any page the role can open, start any record it can
 * create, or find a product, customer, order or purchase order by name or
 * number. For a keyboard shop, this is the personality (design-direction 6).
 *
 * Pages and actions are matched in the browser, instantly. Records are
 * searched on the server, debounced, with the previous results held on screen
 * while the next ones load so the list never flashes empty mid-word.
 *
 * It is a combobox in the ARIA sense: focus stays in the input, the arrow keys
 * move `aria-activedescendant`, and Enter opens. Nothing here is a mouse-only
 * affordance.
 */

type Entry = {
  key: string;
  section: string;
  label: string;
  detail?: string | null;
  meta?: string | null;
  icon: LucideIcon;
  run: () => void;
};

const RECORD_ICON: Record<PaletteGroup, LucideIcon> = {
  products: Package,
  customers: Users,
  orders: ShoppingCart,
  purchaseOrders: ClipboardList,
};

const PaletteContext = createContext<{ open: () => void } | null>(null);

export function usePalette() {
  const context = useContext(PaletteContext);
  if (!context) throw new Error("usePalette needs a CommandPaletteProvider above it.");
  return context;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function CommandPaletteProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Ctrl+K and Cmd+K from anywhere, inputs included: that is the point.
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const context = useMemo(() => ({ open: () => setOpen(true) }), []);

  return (
    <PaletteContext.Provider value={context}>
      {children}
      <DialogPrimitive.Root open={isOpen} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className={cn(
              "fixed top-[12dvh] left-1/2 z-50 flex w-[calc(100%-1.5rem)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden",
              "rounded-lg border border-hairline bg-popover text-popover-foreground shadow-overlay outline-none",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            )}
          >
            <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
            {isOpen ? <PaletteBody role={role} close={() => setOpen(false)} /> : null}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </PaletteContext.Provider>
  );
}

function PaletteBody({ role, close }: { role: Role; close: () => void }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query.trim(), 150);

  const searchable = debounced.length >= MIN_RECORD_QUERY;
  const records = useQuery({
    queryKey: ["palette", debounced],
    queryFn: () => paletteSearchAction({ query: debounced }),
    enabled: searchable,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const { pages, actions } = useMemo(() => paletteEntriesFor(role), [role]);

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim();
    const isDark = resolvedTheme === "dark";
    const theme = {
      label: isDark ? "Switch to light theme" : "Switch to dark theme",
      keywords: ["theme", "dark", "light", "appearance"],
    };

    const actionEntries = rankMatches(q, actions, q ? 4 : 5).map((item): Entry => ({
      key: `action:${item.href}`,
      section: "Create",
      label: item.label,
      icon: item.icon,
      run: () => go(item.href),
    }));
    const pageEntries = rankMatches(q, pages, q ? 6 : pages.length).map((item): Entry => ({
      key: `page:${item.href}`,
      section: "Go to",
      label: item.label,
      detail: item.group,
      icon: item.icon,
      run: () => go(item.href),
    }));
    const themeEntries =
      rankMatches(q, [theme]).length > 0
        ? [
            {
              key: "theme",
              section: "Preferences",
              label: theme.label,
              icon: isDark ? Sun : Moon,
              run: () => {
                setTheme(isDark ? "light" : "dark");
                close();
              },
            } satisfies Entry,
          ]
        : [];

    const recordEntries: Entry[] =
      searchable && records.data
        ? PALETTE_GROUPS.flatMap((group) =>
            records.data
              .filter((record) => record.group === group)
              .map((record): Entry => ({
                key: `${group}:${record.id}`,
                section: PALETTE_GROUP_LABEL[group],
                label: record.label,
                detail: record.detail,
                meta: record.meta,
                icon: RECORD_ICON[group],
                run: () => go(record.href),
              })),
          )
        : [];

    // Typing a record name should put records first; an empty box is for
    // getting around, so create and go-to lead.
    return q
      ? [...recordEntries, ...pageEntries, ...actionEntries, ...themeEntries]
      : [...actionEntries, ...pageEntries, ...themeEntries];
  }, [query, resolvedTheme, actions, pages, searchable, records.data, go, setTheme, close]);

  // A new result set starts at the top.
  useEffect(() => setActive(0), [query, records.data]);

  // Keep the active option in view as the arrows walk past the fold.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (entries.length === 0) return;
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      setActive((index) => (index + 1) % entries.length);
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      setActive((index) => (index - 1 + entries.length) % entries.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(entries.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      entries[active]?.run();
    }
  }

  const loading = searchable && records.isFetching;
  const optionId = (index: number) => `${listId}-option-${index}`;
  let lastSection = "";

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-hairline px-3.5">
        <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={entries[active] ? optionId(active) : undefined}
          aria-label="Search pages, products, customers and orders"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search or jump to"
          spellCheck={false}
          autoComplete="off"
          className="h-12 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-subtle"
        />
        {loading ? (
          <span className="font-mono text-[11px] text-ink-subtle" role="status">
            Searching
          </span>
        ) : null}
        <kbd className="hidden rounded-xs border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-subtle sm:inline">
          Esc
        </kbd>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Results"
        className="max-h-[min(420px,60dvh)] overflow-y-auto p-1.5"
      >
        {entries.length === 0 ? (
          <p className="px-3 py-8 text-center text-body-sm text-ink-subtle" role="status">
            {searchable && records.isFetching
              ? "Searching"
              : query.trim().length > 0 && query.trim().length < MIN_RECORD_QUERY
                ? "Keep typing to search records"
                : `Nothing matches "${query.trim()}"`}
          </p>
        ) : (
          entries.map((entry, index) => {
            const heading = entry.section !== lastSection ? entry.section : null;
            lastSection = entry.section;
            const Icon = entry.icon;
            const isActive = index === active;
            return (
              <div key={entry.key}>
                {heading ? (
                  <div
                    role="presentation"
                    className="px-2.5 pt-2.5 pb-1 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase"
                  >
                    {heading}
                  </div>
                ) : null}
                <div
                  id={optionId(index)}
                  role="option"
                  aria-selected={isActive}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => entry.run()}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-body-sm",
                    isActive ? "bg-surface-3 text-ink" : "text-ink-muted",
                  )}
                >
                  <Icon
                    className={cn("size-4 shrink-0", isActive ? "text-ink" : "text-ink-subtle")}
                    aria-hidden
                  />
                  <span className="truncate">{entry.label}</span>
                  {entry.detail ? (
                    <span className="hidden truncate text-ink-subtle sm:inline">
                      {entry.detail}
                    </span>
                  ) : null}
                  {entry.meta ? (
                    <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] text-ink-subtle">
                      {entry.meta}
                    </span>
                  ) : null}
                  {isActive && !entry.meta ? (
                    <CornerDownLeft className="ml-auto size-3.5 text-ink-subtle" aria-hidden />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden items-center gap-4 border-t border-hairline px-3.5 py-2 text-[11px] text-ink-subtle sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> to move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Enter</Kbd> to open
        </span>
        <span className="ml-auto">
          Records need {MIN_RECORD_QUERY} characters. Search by name, SKU or number.
        </span>
      </div>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-xs border border-hairline bg-surface-2 px-1 py-px font-mono text-[10px] text-ink-subtle">
      {children}
    </kbd>
  );
}

/**
 * The top bar's way into the palette, for people who do not know the shortcut
 * yet. The key hint says Ctrl on the server and switches to the Command glyph
 * after mount on a Mac, so the markup never mismatches during hydration.
 */
export function PaletteTrigger() {
  const { open } = usePalette();
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}
        className={cn(
          "hidden h-8 w-64 items-center gap-2 rounded-md border border-hairline bg-surface-1 pr-1.5 pl-2.5 text-left text-body-sm text-ink-subtle md:flex",
          "transition-colors hover:border-hairline-strong hover:text-ink-muted",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search or jump to</span>
        <kbd className="rounded-xs border border-hairline bg-surface-2 px-1.5 py-px font-mono text-[11px]">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <button
        type="button"
        onClick={open}
        aria-label="Search or jump to"
        className="inline-flex size-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill md:hidden"
      >
        <Search className="size-4" aria-hidden />
      </button>
    </>
  );
}
