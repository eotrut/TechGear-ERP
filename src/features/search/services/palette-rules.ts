/**
 * Matching for the palette's static entries: pages and quick actions. Records
 * are searched in the database; these few dozen strings are matched here, in
 * the browser, so jumping to a page never waits on a round trip.
 *
 * Pure, so it is unit tested and shared by the palette and nothing else.
 */

export type Matchable = { label: string; keywords?: string[] };

/**
 * Higher is better; 0 means no match. A label that starts with the query beats
 * a word inside it, which beats the initials, which beats a keyword, which
 * beats letters in order: "po" finds Purchase orders by its initials and
 * "ordrs" still finds Orders.
 */
export function scoreMatch(query: string, item: Matchable): number {
  const q = normalise(query);
  if (q === "") return 1;
  const label = normalise(item.label);

  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.split(" ").some((word) => word.startsWith(q))) return 60;
  if (initials(label).startsWith(q)) return 50;
  if (item.keywords?.some((keyword) => normalise(keyword).startsWith(q))) return 40;
  if (label.includes(q)) return 30;
  if (isSubsequence(q, label)) return 10;
  return 0;
}

/** Matching entries, best first, ties kept in their original order. */
export function rankMatches<T extends Matchable>(query: string, items: T[], limit = 8): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreMatch(query, item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

/** Record search needs two characters; one letter matches half the catalogue. */
export const MIN_RECORD_QUERY = 2;

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function initials(label: string): string {
  return label
    .split(" ")
    .map((word) => word[0] ?? "")
    .join("");
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const char of haystack) {
    if (char === needle[at]) at += 1;
    if (at === needle.length) return true;
  }
  return false;
}
