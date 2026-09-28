import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // DESIGN.md input geometry: 8px radius, 12px side padding, sitting on
        // the canvas so an empty field never reads as filled in.
        "h-8 w-full min-w-0 rounded-md border border-input bg-canvas px-3 py-1 text-body-sm text-ink transition-colors",
        "placeholder:text-ink-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-body-sm file:font-medium file:text-ink",
        // The same 2px accent ring as every other control in the app.
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
        "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
