"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A report filter that sits beside the date range: a native select whose
 * value is one URL parameter. Native, because it is the best picker a phone
 * has, and a report filter has a handful of options at most.
 */
export function ParamSelect({
  name,
  label,
  value,
  options,
  className,
}: {
  name: string;
  label: string;
  value: string;
  /** An empty value removes the parameter, which means the report's default. */
  options: { value: string; label: string }[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  return (
    <label className={cn("flex items-center", className)}>
      <span className="sr-only">{label}</span>
      <select
        name={name}
        value={value}
        aria-busy={isPending}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          if (event.target.value === "") params.delete(name);
          else params.set(name, event.target.value);
          const query = params.toString();
          startTransition(() => router.push(query === "" ? pathname : `${pathname}?${query}`));
        }}
        className={cn(
          "h-8 max-w-[14rem] rounded-md border border-hairline bg-surface-2 px-2 text-body-sm text-ink hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
          isPending && "opacity-70",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
