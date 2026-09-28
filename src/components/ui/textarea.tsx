import * as React from "react";

import { cn } from "@/lib/utils";

/** Multi-line input in the same material as Input: hairline, canvas, accent focus. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-w-0 rounded-md border border-input bg-canvas px-3 py-2 text-body-sm text-ink transition-[color,box-shadow] outline-none placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
        "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
