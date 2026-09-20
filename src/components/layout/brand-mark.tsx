import { cn } from "@/lib/utils";

/**
 * The one piece of gear-shop character in the chrome: a keycap squircle with
 * the faint top-edge highlight DESIGN.md describes on lifted panels. It is
 * used once, in the sidebar. See docs/design-direction.md.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "edge-highlight bg-accent-fill text-accent-on-fill",
        "inline-flex size-7 items-center justify-center rounded-[9px]",
        "font-mono text-[13px] leading-none font-semibold",
        className,
      )}
      aria-hidden
    >
      TG
    </span>
  );
}
