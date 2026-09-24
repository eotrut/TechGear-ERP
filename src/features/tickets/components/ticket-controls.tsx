"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TicketPriority, TicketStatus } from "@prisma/client";
import { toast } from "sonner";

import { selectClass } from "@/components/forms/field";
import { Button } from "@/components/ui/button";

import { assignTicketAction, changeTicketStatusAction, setTicketPriorityAction } from "../actions";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from "../schemas";

/**
 * Status, priority and assignee for one ticket. The status buttons are the
 * moves the status machine allows from here; resolve, close and reopen only
 * show for someone who may make them on this ticket. The server re-checks
 * both, under a row lock.
 */

const ACTION_LABEL: Partial<Record<TicketStatus, string>> = {
  IN_PROGRESS: "Start work",
  WAITING_CUSTOMER: "Waiting on customer",
  RESOLVED: "Resolve",
  CLOSED: "Close",
  OPEN: "Reopen",
};

export function TicketControls({
  ticketId,
  status,
  priority,
  assigneeId,
  moves,
  canAssign,
  assignees,
}: {
  ticketId: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  /** Allowed next statuses, already filtered for this viewer. */
  moves: TicketStatus[];
  canAssign: boolean;
  assignees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(
    action: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>,
  ) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Saved.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {moves.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {moves.map((to, index) => (
            <Button
              key={to}
              size="sm"
              variant={index === 0 ? "primary" : "secondary"}
              disabled={isPending}
              onClick={() => run(() => changeTicketStatusAction({ ticketId, status: to }))}
            >
              {to === "OPEN" && status !== "RESOLVED" && status !== "CLOSED"
                ? "Back to open"
                : (ACTION_LABEL[to] ?? TICKET_STATUS_LABEL[to])}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-caption text-ink-subtle">
          {status === "CLOSED"
            ? "Closed. Only the assignee or a manager can reopen it, within seven days."
            : "Nothing for you to change on this ticket."}
        </p>
      )}

      {canAssign ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-caption text-ink-subtle">
            Priority
            <select
              className={selectClass}
              defaultValue={priority}
              disabled={isPending}
              onChange={(event) => {
                const next = TICKET_PRIORITIES.find((value) => value === event.target.value);
                if (next) run(() => setTicketPriorityAction({ ticketId, priority: next }));
              }}
            >
              {TICKET_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {TICKET_PRIORITY_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-caption text-ink-subtle">
            Assignee
            <select
              className={selectClass}
              defaultValue={assigneeId ?? ""}
              disabled={isPending}
              onChange={(event) =>
                run(() => assignTicketAction({ ticketId, assigneeId: event.target.value }))
              }
            >
              <option value="">Unassigned</option>
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.id}>
                  {assignee.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
