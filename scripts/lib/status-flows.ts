import { WARRANTY_TRANSITIONS } from "../../src/features/warranty/services/warranty-rules";
import { TICKET_TRANSITIONS } from "../../src/features/tickets/services/tickets";
import { PO_TRANSITIONS } from "../../src/features/purchasing/services/purchase-rules";
import { BILL_TRANSITIONS } from "../../src/features/purchasing/services/bill-rules";
import { RETURN_TRANSITIONS } from "../../src/features/returns/services/return-rules";
import { LEAD_TRANSITIONS } from "../../src/features/leads/services/pipeline";
import { TRANSFER_TRANSITIONS } from "../../src/features/inventory/services/transfers";
import { ORDER_TRANSITIONS } from "../../src/features/orders/services/order-rules";
import type { TransitionMap } from "../../src/lib/transitions";

/**
 * Every status machine in the app, as the services enforce it. The maps are
 * imported, not restated, so docs/status-flows.md is drawn from the same
 * objects `assertTransition` checks, and tests/status-flows.test.ts fails if
 * the committed file stops matching them.
 */
export type Flow = {
  title: string;
  constant: string;
  source: string;
  map: TransitionMap<string>;
  /** Where a record starts. */
  entry: readonly string[];
  /** Where a lifecycle is finished, even if a reopen edge leads out again. */
  ends: readonly string[];
  notes: readonly string[];
};

export const FLOWS: readonly Flow[] = [
  {
    title: "Sales order",
    constant: "ORDER_TRANSITIONS",
    source: "src/features/orders/services/order-rules.ts",
    map: ORDER_TRANSITIONS,
    entry: ["DRAFT", "PENDING"],
    ends: ["COMPLETED", "CANCELLED", "REFUNDED"],
    notes: [
      "Marketplace orders (Shopee, Lazada, TikTok Shop) start at Pending, because the marketplace has already taken them. Every other channel may start as a Draft.",
      "Pending reserves stock (`reserved += qty`). Paid turns the reservation into SALE movements and snapshots each line's cost from the moving average.",
      "Cancelling a Draft or Pending order releases the reservation. Cancelling a Paid or Packed order restocks each line with a RETURN movement at the cost it left at and refunds what was paid.",
      "Completed refreshes the customer's lifetime value, order count and segment.",
      "Refunded is reached through returns and refunds, and only once all the money or every unit has gone back (D-33). A partial refund leaves the status where it was.",
      "A POS sale walks the same ladder, Draft to Completed, in one transaction (D-38). There is no POS-only edge.",
    ],
  },
  {
    title: "Return (RMA)",
    constant: "RETURN_TRANSITIONS",
    source: "src/features/returns/services/return-rules.ts",
    map: RETURN_TRANSITIONS,
    entry: ["REQUESTED"],
    ends: ["COMPLETED", "REJECTED"],
    notes: [
      "Received to Completed is the only step with stock or money effects. Each line is either restocked (a RETURN movement at the original line cost) or written off (a WRITE_OFF row that books the loss and leaves on-hand alone).",
      "A return never covers more units than are still out on the order line.",
    ],
  },
  {
    title: "Warranty claim",
    constant: "WARRANTY_TRANSITIONS",
    source: "src/features/warranty/services/warranty-rules.ts",
    map: WARRANTY_TRANSITIONS,
    entry: ["SUBMITTED"],
    ends: ["CLOSED"],
    notes: [
      "A claim is raised against a delivered order line whose warranty has not expired.",
      "Replaced issues a zero-value replacement order with a real SALE movement at average cost, so the warranty cost lands in the P&L (D-20).",
      "Refunded pays one unit's share back and writes the faulty unit off.",
      "Rejected to Under review is the appeal path.",
    ],
  },
  {
    title: "Purchase order",
    constant: "PO_TRANSITIONS",
    source: "src/features/purchasing/services/purchase-rules.ts",
    map: PO_TRANSITIONS,
    entry: ["DRAFT"],
    ends: ["CLOSED", "CANCELLED"],
    notes: [
      "The status after a delivery is computed by `statusAfterReceipt`, never chosen: everything in gives Received, anything short gives Partially received (which can repeat).",
      "Receiving is the only code that writes RECEIPT movements or moves the moving-average cost.",
      "Cancel is refused once any delivery has been booked. Closing a partly received PO needs a reason.",
      "Rejected units stay outstanding on the PO, so a replacement delivery can bring them in (D-41).",
    ],
  },
  {
    title: "Supplier bill",
    constant: "BILL_TRANSITIONS",
    source: "src/features/purchasing/services/bill-rules.ts",
    map: BILL_TRANSITIONS,
    entry: ["DRAFT"],
    ends: ["PAID", "VOID"],
    notes: [
      "Payments lock the bill and can never exceed its balance. Partially paid repeats until the balance reaches zero.",
      "A bill with any payment cannot be voided.",
    ],
  },
  {
    title: "Stock transfer",
    constant: "TRANSFER_TRANSITIONS",
    source: "src/features/inventory/services/transfers.ts",
    map: TRANSFER_TRANSITIONS,
    entry: ["DRAFT"],
    ends: ["RECEIVED", "CANCELLED"],
    notes: [
      "Dispatch writes TRANSFER_OUT at the source. Receiving writes TRANSFER_IN at the destination. In between, the units are on the truck and in neither warehouse's on-hand.",
      "Cancelling in transit brings the units back to the source with a TRANSFER_IN there.",
      "Every change locks the transfer row first, so two people pressing Receive add the stock once.",
    ],
  },
  {
    title: "Lead",
    constant: "LEAD_TRANSITIONS",
    source: "src/features/leads/services/pipeline.ts",
    map: LEAD_TRANSITIONS,
    entry: ["NEW"],
    ends: ["WON", "LOST"],
    notes: [
      "One stage forward or one back, so a mis-drag on the kanban is recoverable. A skip is refused with the missing step named.",
      "Won is reachable only by converting the lead into a customer, so every won deal has an account for its orders (D-28).",
      "Lost can be reopened to New.",
    ],
  },
  {
    title: "Support ticket",
    constant: "TICKET_TRANSITIONS",
    source: "src/features/tickets/services/tickets.ts",
    map: TICKET_TRANSITIONS,
    entry: ["OPEN"],
    ends: ["RESOLVED", "CLOSED"],
    notes: [
      "The SLA target is set from priority in business hours, Monday to Saturday, 9 to 6, Manila (D-25). Reopening sets a fresh target.",
      "First response is stamped by the first reply the customer can see, never by an internal note or a status change.",
      "A closed ticket can be reopened within 7 days.",
    ],
  },
];

/** "PARTIALLY_RECEIVED" to "Partially received". */
export function stateLabel(status: string): string {
  const words = status.toLowerCase().split("_");
  return [words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1), ...words.slice(1)].join(" ");
}

export function edgesOf(map: TransitionMap<string>): string[] {
  return Object.entries(map).flatMap(([from, targets]) => targets.map((to) => `${from} --> ${to}`));
}

export function mermaidFor(flow: Flow): string {
  const lines = ["stateDiagram-v2"];
  for (const status of Object.keys(flow.map)) {
    lines.push(`  state "${stateLabel(status)}" as ${status}`);
  }
  for (const status of flow.entry) lines.push(`  [*] --> ${status}`);
  for (const edge of edgesOf(flow.map)) lines.push(`  ${edge}`);
  for (const status of flow.ends) lines.push(`  ${status} --> [*]`);
  return lines.join("\n");
}

export function renderStatusFlows(): string {
  const out: string[] = [
    "# Status flows",
    "",
    "> Generated by `npm run gen:status-flows` from the transition maps the services",
    "> enforce. Do not edit by hand; `tests/status-flows.test.ts` fails when this",
    "> file and the code disagree.",
    "",
    "Every entity with a lifecycle declares its allowed moves as a typed map, and",
    "every status write goes through `assertTransition` (`src/lib/transitions.ts`)",
    "after locking the record's row. There is no direct status assignment anywhere,",
    "so an illegal move is a thrown `InvalidTransitionError`, never a quietly",
    "corrupted record. `[*]` marks where a record starts and where its lifecycle",
    "ends. Decision numbers (D-xx) refer to docs/PLAN.md section 8.",
    "",
    "| Entity | Map | Source |",
    "| --- | --- | --- |",
    ...FLOWS.map(
      (flow) => `| ${flow.title} | \`${flow.constant}\` | [${flow.source}](../${flow.source}) |`,
    ),
    "",
  ];

  for (const flow of FLOWS) {
    out.push(`## ${flow.title}`, "", "```mermaid", mermaidFor(flow), "```", "");
    for (const note of flow.notes) out.push(`- ${note}`);
    out.push("");
  }

  return out.join("\n");
}
