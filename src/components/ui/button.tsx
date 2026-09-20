import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Button geometry follows DESIGN.md: 8px radius (never pill), 8px by 14px
 * padding, 14px/500 label. Depth comes from the surface ladder and hairlines,
 * so there are no shadows here. Focus is the one accent ring used app-wide.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md text-body font-medium leading-none",
    "transition-colors duration-150",
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    // Tactile press, per the taste-skill interactive-states rule.
    "active:translate-y-px",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent-fill text-accent-on-fill hover:bg-accent-fill-hover",
        secondary: "bg-surface-2 text-ink border border-hairline hover:bg-surface-3",
        ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink",
        danger: "bg-danger-fill text-danger-on-fill hover:brightness-110",
        link: "text-accent-strong underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2.5 text-caption",
        md: "h-8 px-3.5",
        lg: "h-9 px-4",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
