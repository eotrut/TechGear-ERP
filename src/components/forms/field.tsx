import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * One labelled form control with its hint and its error. The error is linked
 * by id so a screen reader announces it with the field, and it replaces the
 * hint rather than stacking under it.
 */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className="text-caption font-medium text-ink-muted">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Native select in the app's input geometry. Native, because it is the best phone picker there is. */
export const selectClass =
  "h-8 w-full rounded-md border border-input bg-canvas px-2 text-body-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill disabled:opacity-50";

/** Inputs sit on the canvas, like selects, so an empty field never reads as filled in. */
export const inputClass = "h-8 bg-canvas text-body-sm dark:bg-canvas";

/** Server-side failure for a whole form, shown above its actions. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/30 bg-danger-wash px-3 py-2 text-body-sm text-danger"
    >
      {message}
    </p>
  );
}
