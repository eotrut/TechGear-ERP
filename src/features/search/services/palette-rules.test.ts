import { describe, expect, it } from "vitest";

import { rankMatches, scoreMatch } from "./palette-rules";

const pages = [
  { label: "Dashboard" },
  { label: "Orders" },
  { label: "Purchase orders", keywords: ["po"] },
  { label: "Point of sale", keywords: ["register", "pos"] },
  { label: "Stock" },
  { label: "Slow-moving stock" },
];

describe("palette matching", () => {
  it("prefers a label that starts with the query over one that contains it", () => {
    expect(rankMatches("stock", pages).map((page) => page.label)).toEqual([
      "Stock",
      "Slow-moving stock",
    ]);
  });

  it("finds a page by a word inside it and by its initials", () => {
    expect(rankMatches("orders", pages).map((page) => page.label)).toEqual([
      "Orders",
      "Purchase orders",
    ]);
    expect(rankMatches("pos", pages)[0]?.label).toBe("Point of sale");
  });

  it("matches keywords, and letters in order as a last resort", () => {
    expect(rankMatches("register", pages).map((page) => page.label)).toEqual(["Point of sale"]);
    expect(scoreMatch("dshbd", { label: "Dashboard" })).toBeGreaterThan(0);
    expect(scoreMatch("xyz", { label: "Dashboard" })).toBe(0);
  });

  it("returns everything, in order, for an empty query", () => {
    expect(rankMatches("  ", pages, 99)).toEqual(pages);
  });
});
