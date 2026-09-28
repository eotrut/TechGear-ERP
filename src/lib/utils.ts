import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock font sizes. Ours are named
 * (globals.css `--text-*`), and an unknown `text-*` class is read as a colour,
 * so `cn("text-caption text-ink-subtle")` would drop the size in favour of the
 * colour. Registering the scale keeps size and colour in separate groups.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["caption", "body-sm", "body", "lead", "section", "title", "display"] },
      ],
    },
  },
});

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
