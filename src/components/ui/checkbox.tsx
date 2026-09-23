"use client";

import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Selection control for data tables and forms. 4px radius to match chips,
 * hairline border at rest, accent fill when on, and the one focus ring the
 * app uses everywhere. Indeterminate renders a dash, which is what a
 * partially selected page of rows means.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-xs border border-hairline-strong bg-canvas",
        "transition-colors outline-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
        "hover:border-ink-subtle",
        "data-[state=checked]:border-accent-fill data-[state=checked]:bg-accent-fill",
        "data-[state=indeterminate]:border-accent-fill data-[state=indeterminate]:bg-accent-fill",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-accent-on-fill"
      >
        {props.checked === "indeterminate" ? (
          <Minus className="size-3" strokeWidth={3} aria-hidden />
        ) : (
          <Check className="size-3" strokeWidth={3} aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
