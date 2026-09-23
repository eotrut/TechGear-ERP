/**
 * URL slugs for products, categories and brands.
 *
 * Slugs are unique columns in the schema, so a collision is a 500 rather than
 * a validation message unless it is resolved before the write. `uniqueSlug`
 * takes the set of slugs already in use and suffixes until it is clear.
 */

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      // Strip combining marks so "Niño" becomes "nino" rather than "nio".
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "")
  );
}

/**
 * A slug not already present in `taken`. Falls back to "item" when the source
 * string has no slug-safe characters at all, which a Zod schema should have
 * caught but a CSV import can still produce.
 */
export function uniqueSlug(value: string, taken: Iterable<string>): string {
  const base = slugify(value) || "item";
  const used = new Set(taken);
  if (!used.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }

  return `${base}-${Date.now()}`;
}
