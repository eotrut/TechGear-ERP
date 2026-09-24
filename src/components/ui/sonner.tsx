"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/**
 * Toasts for outcomes that happen away from the control that caused them: a
 * kanban card that bounced back, a background refresh that finished. Errors
 * that belong to a form stay inline next to the form.
 *
 * Styled from the surface ladder and the one overlay shadow, so a toast reads
 * as the same material as a dialog rather than sonner's default card.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border !border-hairline !bg-surface-2 !text-ink !shadow-[var(--shadow-overlay)] !font-sans !text-body-sm",
          description: "!text-ink-subtle",
          error: "[&_[data-icon]]:!text-danger",
          success: "[&_[data-icon]]:!text-success",
          closeButton: "!border-hairline !bg-surface-2 !text-ink-muted",
        },
      }}
    />
  );
}
