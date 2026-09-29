import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { InvalidTransitionError } from "@/lib/errors";
import { assertTransition, isTerminal } from "@/lib/transitions";

import { edgesOf, FLOWS, type Flow } from "../scripts/lib/status-flows";

/**
 * Every status machine, checked as a graph: records can reach every state
 * from where they start, nothing gets stuck short of an end, and the
 * published diagrams in docs/status-flows.md are the maps the services run.
 */

function reachableFrom(flow: Flow, starts: readonly string[]): Set<string> {
  const seen = new Set<string>(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    const status = queue.shift()!;
    for (const next of flow.map[status] ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe.each(FLOWS.map((flow) => [flow.title, flow] as const))("%s", (_title, flow) => {
  const statuses = Object.keys(flow.map);

  it("only moves between statuses it declares", () => {
    for (const targets of Object.values(flow.map)) {
      for (const target of targets) expect(statuses).toContain(target);
    }
    for (const status of [...flow.entry, ...flow.ends]) expect(statuses).toContain(status);
  });

  it("can reach every status from where a record starts", () => {
    expect([...reachableFrom(flow, flow.entry)].sort()).toEqual([...statuses].sort());
  });

  it("can finish from every status", () => {
    for (const status of statuses) {
      const reachable = reachableFrom(flow, [status]);
      expect(
        flow.ends.some((end) => reachable.has(end)),
        `${status} cannot reach an end`,
      ).toBe(true);
    }
  });

  it("refuses every move the map does not list", () => {
    for (const from of statuses) {
      for (const to of statuses) {
        const allowed = flow.map[from]!.includes(to);
        const attempt = () => assertTransition(flow.map, flow.title, from, to);
        if (allowed) expect(attempt).not.toThrow();
        else expect(attempt).toThrow(InvalidTransitionError);
      }
    }
  });

  it("treats as terminal only statuses that are ends", () => {
    for (const status of statuses) {
      if (isTerminal(flow.map, status)) expect(flow.ends).toContain(status);
    }
  });
});

describe("self transitions", () => {
  it("exist only where a document is paid or received in parts", () => {
    const loops = FLOWS.flatMap((flow) =>
      Object.entries(flow.map)
        .filter(([status, targets]) => targets.includes(status))
        .map(([status]) => `${flow.constant}.${status}`),
    );
    expect(loops.sort()).toEqual([
      "BILL_TRANSITIONS.PARTIALLY_PAID",
      "PO_TRANSITIONS.PARTIALLY_RECEIVED",
    ]);
  });
});

describe("docs/status-flows.md", () => {
  // A Windows checkout may carry CRLF line endings.
  const doc = readFileSync("docs/status-flows.md", "utf8").replace(/\r\n/g, "\n");

  it.each(FLOWS.map((flow) => [flow.title, flow] as const))(
    "draws exactly the %s map",
    (title, flow) => {
      const section = doc.split(/^## /m).find((part) => part.startsWith(`${title}\n`));
      expect(section, `no "## ${title}" section; run npm run gen:status-flows`).toBeDefined();

      const diagram = section!.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? "";
      const arrows = diagram
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.includes("-->"));
      const edges = arrows.filter((line) => !line.includes("[*]"));

      expect(edges.sort()).toEqual(edgesOf(flow.map).sort());
      for (const status of flow.entry) expect(arrows).toContain(`[*] --> ${status}`);
      for (const status of flow.ends) expect(arrows).toContain(`${status} --> [*]`);
    },
  );
});
