"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Check, ChevronDown } from "lucide-react";

import { Field, inputClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { PRESET_LABEL, type RangePreset } from "../services/date-range";

/**
 * The date-range control, the filter every reader reaches for first. Presets
 * are rows (nobody fights a calendar for "last 30 days"), the selected one
 * carries a check, and a custom range sits behind a hairline at the foot.
 * The URL is the state, so the page, its comparison and its CSV export all
 * read the same parameters.
 */

const PRESETS: Exclude<RangePreset, "custom">[] = [
  "today",
  "wtd",
  "7d",
  "30d",
  "90d",
  "mtd",
  "qtd",
  "ytd",
  "12m",
];

export function RangePicker({
  preset,
  fromDay,
  toDay,
  summary,
  today,
  presets = PRESETS,
}: {
  preset: RangePreset;
  fromDay: string;
  toDay: string;
  /** "Aug 30 to Sep 28, 2026", computed on the server. */
  summary: string;
  /** Manila today, from the server, so the date inputs cannot run past it. */
  today: string;
  presets?: Exclude<RangePreset, "custom">[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);
  const invalid = from === "" || to === "" || from > to;

  function go(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["range", "from", "to", "page"]) params.delete(key);
    for (const [key, value] of Object.entries(next)) params.set(key, value);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="md"
            aria-busy={isPending}
            className={cn("max-w-full justify-start", isPending && "opacity-70")}
          >
            <CalendarRange aria-hidden />
            <span className="truncate">{PRESET_LABEL[preset]}</span>
            <span className="hidden truncate text-ink-subtle lg:inline">{summary}</span>
            <ChevronDown aria-hidden className="ml-auto text-ink-subtle" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {presets.map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => go({ range: option })}
              className="justify-between"
            >
              {PRESET_LABEL[option]}
              {option === preset ? (
                <Check
                  aria-label="Selected"
                  className="size-4 text-accent-strong"
                  strokeWidth={2.5}
                />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)} className="justify-between">
            Custom range
            {preset === "custom" ? (
              <Check
                aria-label="Selected"
                className="size-4 text-accent-strong"
                strokeWidth={2.5}
              />
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Custom range</DialogTitle>
            <DialogDescription>
              Manila calendar days, both included. The comparison is the same number of days
              immediately before.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (invalid) return;
              setCustomOpen(false);
              go({ range: "custom", from, to });
            }}
          >
            <Field id="range-from" label="First day">
              <Input
                id="range-from"
                type="date"
                max={today}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className={cn(inputClass, "font-mono")}
              />
            </Field>
            <Field
              id="range-to"
              label="Last day"
              error={from > to && to !== "" ? "Ends before it starts." : undefined}
            >
              <Input
                id="range-to"
                type="date"
                max={today}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className={cn(inputClass, "font-mono")}
              />
            </Field>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="ghost" onClick={() => setCustomOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={invalid}>
                Apply
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
