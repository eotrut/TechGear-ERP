"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * URL-driven filter bar shared by the inventory lists.
 *
 * The URL is the state, as on the product list: a filtered ledger is a link
 * somebody can be sent. Selects and dates apply as soon as they change; the
 * search box waits for Enter so typing is not a navigation per keystroke.
 * "/" focuses search from anywhere on the page.
 */

export type FilterField =
  | { kind: "search"; name: string; label: string; placeholder: string }
  | {
      kind: "select";
      name: string;
      label: string;
      allLabel: string;
      options: { value: string; label: string }[];
    }
  | { kind: "date"; name: string; label: string };

const selectClass =
  "h-8 w-full rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill";

export function ListFilters({
  fields,
  /** Params that are not fields but should survive a filter change, such as a sort. */
  keep = ["sort", "dir", "view"],
}: {
  fields: FilterField[];
  keep?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!searchRef.current) return;
      event.preventDefault();
      searchRef.current.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function apply(formData: FormData) {
    const params = new URLSearchParams();
    for (const key of keep) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string" && value.trim() !== "") params.set(key, value.trim());
    }
    const query = params.toString();
    startTransition(() => router.push(query === "" ? pathname : `${pathname}?${query}`));
  }

  const fieldNames = new Set(fields.map((field) => field.name));
  const active = [...searchParams.keys()].filter((key) => fieldNames.has(key));

  const clearHref = (() => {
    const params = new URLSearchParams();
    for (const key of keep) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query === "" ? pathname : `${pathname}?${query}`;
  })();

  return (
    <form
      ref={formRef}
      action={apply}
      className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-surface-1 p-3 md:grid-cols-6 xl:grid-cols-12"
    >
      {fields.map((field) => {
        const id = `filter-${field.name}`;

        if (field.kind === "search") {
          return (
            <div
              key={field.name}
              className="col-span-2 flex flex-col gap-1.5 md:col-span-6 xl:col-span-4"
            >
              <Label htmlFor={id} className="text-caption text-ink-subtle">
                {field.label}
              </Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-subtle"
                  aria-hidden
                />
                <Input
                  ref={searchRef}
                  id={id}
                  name={field.name}
                  defaultValue={searchParams.get(field.name) ?? ""}
                  placeholder={field.placeholder}
                  className="h-8 pl-8 text-body-sm"
                />
              </div>
            </div>
          );
        }

        if (field.kind === "select") {
          return (
            <div key={field.name} className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor={id} className="text-caption text-ink-subtle">
                {field.label}
              </Label>
              <select
                id={id}
                name={field.name}
                defaultValue={searchParams.get(field.name) ?? ""}
                onChange={() => formRef.current?.requestSubmit()}
                className={selectClass}
              >
                <option value="">{field.allLabel}</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        return (
          <div key={field.name} className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor={id} className="text-caption text-ink-subtle">
              {field.label}
            </Label>
            <Input
              id={id}
              type="date"
              name={field.name}
              defaultValue={searchParams.get(field.name) ?? ""}
              onChange={() => formRef.current?.requestSubmit()}
              className="h-8 font-mono text-body-sm"
            />
          </div>
        );
      })}

      <div className="col-span-2 flex items-end gap-2">
        <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
          {isPending ? "Filtering" : "Apply"}
        </Button>
        {active.length > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={clearHref}>
              <X aria-hidden />
              Clear
            </Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}
