import type { LeadStage } from "@prisma/client";

import { canTransition, type TransitionMap } from "@/lib/transitions";

/**
 * The lead pipeline, docs/PLAN.md section 5.3. Pure, so the kanban can check a
 * drop before it asks the server, and the server can check it again.
 *
 *   NEW         -> CONTACTED, LOST
 *   CONTACTED   -> QUOTED, NEW, LOST
 *   QUOTED      -> NEGOTIATION, CONTACTED, WON, LOST
 *   NEGOTIATION -> WON, LOST, QUOTED
 *   WON         -> terminal
 *   LOST        -> NEW
 *
 * Forward moves go one stage at a time; a quote can be accepted outright, so
 * Quoted may jump to Won. One step backwards is allowed so a mis-drag is
 * recoverable. Lost is reachable from anywhere open and reopens to New.
 */

export const LEAD_STAGES = [
  "NEW",
  "CONTACTED",
  "QUOTED",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const satisfies readonly LeadStage[];

export const OPEN_STAGES = ["NEW", "CONTACTED", "QUOTED", "NEGOTIATION"] as const;

export const LEAD_TRANSITIONS: TransitionMap<LeadStage> = {
  NEW: ["CONTACTED", "LOST"],
  CONTACTED: ["QUOTED", "NEW", "LOST"],
  QUOTED: ["NEGOTIATION", "CONTACTED", "WON", "LOST"],
  NEGOTIATION: ["WON", "LOST", "QUOTED"],
  WON: [],
  LOST: ["NEW"],
};

export const STAGE_LABEL: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUOTED: "Quoted",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

const LADDER: LeadStage[] = ["NEW", "CONTACTED", "QUOTED", "NEGOTIATION"];

/**
 * Why a move is refused, in words a salesperson can act on, or null when the
 * move is allowed. Names the missing step rather than just saying no.
 */
export function explainLeadMove(from: LeadStage, to: LeadStage): string | null {
  if (from === to || canTransition(LEAD_TRANSITIONS, from, to)) return null;

  if (from === "WON") {
    return "Won leads are closed. The customer record carries the relationship from here.";
  }
  if (from === "LOST") return "A lost lead reopens to New first.";

  if (to === "WON") {
    return `Only a quoted lead can be won. Move it to ${STAGE_LABEL.QUOTED} first.`;
  }

  const fromIndex = LADDER.indexOf(from);
  const toIndex = LADDER.indexOf(to);
  if (toIndex > fromIndex) {
    const next = LADDER[fromIndex + 1] ?? to;
    return `Leads move one stage at a time. Move it to ${STAGE_LABEL[next]} first.`;
  }
  const previous = LADDER[fromIndex - 1] ?? to;
  return `Leads step back one stage at a time, to ${STAGE_LABEL[previous]}.`;
}

// ------------------------------------------------------------ card ordering

/**
 * Kanban order within a column, decision D-11. A dropped card takes the
 * midpoint of its new neighbours, so a drop rewrites one row. When repeated
 * drops into the same gap squeeze it below MIN_GAP, the caller rebalances that
 * one column back to even spacing.
 */
export const POSITION_STEP = 1000;
export const MIN_GAP = 1e-6;

export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return POSITION_STEP;
  if (before === null) return (after as number) - POSITION_STEP;
  if (after === null) return before + POSITION_STEP;
  if (after - before < MIN_GAP * 2) return null;
  return before + (after - before) / 2;
}

/** Evenly spaced positions for a column, in the order given. */
export function rebalancedPositions(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, (index + 1) * POSITION_STEP]));
}

/** Probability-weighted value, the forecast a pipeline total should show. */
export function weightedValue(valueCentavos: number, probabilityBps: number): number {
  return Math.round((valueCentavos * probabilityBps) / 10_000);
}

/** Default win probability when a lead enters a stage, in basis points. */
export const STAGE_PROBABILITY_BPS: Record<LeadStage, number> = {
  NEW: 1000,
  CONTACTED: 2500,
  QUOTED: 5000,
  NEGOTIATION: 7500,
  WON: 10_000,
  LOST: 0,
};
