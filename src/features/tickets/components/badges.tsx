import type { TicketPriority, TicketStatus } from "@prisma/client";

import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

import { TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from "../schemas";
import { formatDuration, type SlaState } from "../services/sla";

const STATUS_TONE: Record<TicketStatus, StatusTone> = {
  OPEN: "info",
  IN_PROGRESS: "accent",
  WAITING_CUSTOMER: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <StatusBadge tone={STATUS_TONE[status]}>
      {TICKET_STATUS_LABEL[status].toLowerCase()}
    </StatusBadge>
  );
}

const PRIORITY_TONE: Record<TicketPriority, StatusTone> = {
  URGENT: "critical",
  HIGH: "warning",
  MEDIUM: "neutral",
  LOW: "neutral",
};

/** Priority as a signal-strength mark plus a word, so it survives greyscale. */
export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const bars = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[priority];
  return (
    <StatusBadge tone={PRIORITY_TONE[priority]} className="gap-1.5">
      <span aria-hidden className="inline-flex items-end gap-px">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cn("w-[3px] rounded-[1px] bg-current", bar > bars && "opacity-25")}
            style={{ height: `${3 + bar * 2}px` }}
          />
        ))}
      </span>
      {TICKET_PRIORITY_LABEL[priority].toLowerCase()}
    </StatusBadge>
  );
}

/**
 * Where a ticket stands against its SLA, in the fewest words: time left,
 * how late it is, or whether it was met. Mono so a column of them aligns.
 */
export function SlaIndicator({ state, compact = false }: { state: SlaState; compact?: boolean }) {
  switch (state.kind) {
    case "on-track":
      return (
        <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-muted">
          {formatDuration(state.remainingMs)} left
        </span>
      );
    case "at-risk":
      return (
        <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-warning">
          {formatDuration(state.remainingMs)} left
        </span>
      );
    case "breached":
      return (
        <span
          data-numeric
          className="font-mono text-[12px] font-medium whitespace-nowrap text-danger"
        >
          {compact ? "" : "breached "}
          {formatDuration(state.overdueMs)} ago
        </span>
      );
    case "met":
      return <span className="text-caption whitespace-nowrap text-success">met</span>;
    case "missed":
      return (
        <span data-numeric className="font-mono text-[12px] whitespace-nowrap text-ink-subtle">
          missed by {formatDuration(state.lateByMs)}
        </span>
      );
  }
}
