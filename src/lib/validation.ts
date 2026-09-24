import { z } from "zod";

import { isPesoInput } from "@/lib/money";

/**
 * Field builders shared by the CRM schemas. Each one carries the message a
 * person sees, so the client form and the server action say the same thing.
 */

const DASHES = /[–—]/;

/**
 * Free text with a length cap and the house rule on dashes: user-visible
 * strings never carry an en dash or em dash, and that includes what people
 * type, because it ends up on invoices and tickets.
 */
export function text(max: number, options: { min?: number; required?: string } = {}) {
  const base = z.string().trim().max(max, `Keep it under ${max} characters.`);
  const sized =
    options.min !== undefined ? base.min(options.min, options.required ?? "Required.") : base;
  return sized.refine((value) => !DASHES.test(value), {
    message: "Use a plain hyphen rather than an en dash or em dash.",
  });
}

export const optionalEmail = z
  .string()
  .trim()
  .max(120)
  .refine((value) => value === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), {
    message: "That is not an email address.",
  });

/**
 * Philippine phone numbers as people write them: "+63 917 555 0142",
 * "0917-555-0142", "(02) 8812 3456". Formatting is kept as typed; only the
 * digit count is checked, which is what actually catches a typo.
 */
export const optionalPhone = z
  .string()
  .trim()
  .max(32)
  .refine(
    (value) => {
      if (value === "") return true;
      if (!/^[+\d][\d\s()-]*$/.test(value)) return false;
      const digits = value.replace(/\D/g, "").length;
      return digits >= 7 && digits <= 13;
    },
    { message: "Use a Philippine mobile or landline number, such as 0917 555 0142." },
  );

export const optionalPeso = z
  .string()
  .trim()
  .refine((value) => value === "" || isPesoInput(value), {
    message: "Enter an amount in pesos, such as 25000 or 25,000.00.",
  });

export const requiredPeso = z
  .string()
  .trim()
  .min(1, "Enter an amount.")
  .refine((value) => isPesoInput(value), {
    message: "Enter an amount in pesos, such as 25000 or 25,000.00.",
  });

/** A record id from a select or a hidden field. Empty means "none". */
export const optionalId = z.string().trim().max(64);

export const requiredId = (message: string) => z.string().trim().min(1, message).max(64);

/** Comma separated tags to a clean, deduplicated, lowercase list. */
export function parseTags(value: string): string[] {
  const tags = value
    .split(",")
    .map((tag) =>
      tag
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, ""),
    )
    .filter((tag) => tag.length > 0 && tag.length <= 32);
  return [...new Set(tags)].slice(0, 12);
}

export function emptyToNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Integer page number from a URL, defaulting to the first page. */
export const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);
