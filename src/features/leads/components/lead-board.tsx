"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LeadStage } from "@prisma/client";
import { CalendarClock, GripVertical, ListTodo, Lock } from "lucide-react";
import { toast } from "sonner";

import { formatDate } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import { moveLeadAction } from "../actions";
import type { LeadBoard as BoardData, LeadCard } from "../queries";
import { explainLeadMove, LEAD_STAGES, STAGE_LABEL } from "../services/pipeline";
import { ConvertLeadDialog, MarkLostDialog, type ConvertTarget } from "./lead-dialogs";

/**
 * The lead pipeline as a kanban board.
 *
 * Moves are optimistic: the card lands where it was dropped and the server is
 * told afterwards. If the server refuses (somebody else moved it first, or the
 * owner changed) the board snaps back to where it was and a toast says why.
 *
 * The pipeline rules are checked twice. While a card is in the air, columns it
 * may not enter are dimmed and name the missing step, and a drop there is
 * refused on the spot without a round trip. The server checks the same rules
 * again under a row lock, which is the check that counts.
 *
 * Won and Lost need more than a drop: Won opens the convert dialog, since a
 * won deal needs a customer, and Lost asks for a reason. Cancelling either
 * puts the card back.
 */

type Columns = Record<LeadStage, LeadCard[]>;

const COLUMN_PREFIX = "column:";

function columnId(stage: LeadStage) {
  return `${COLUMN_PREFIX}${stage}`;
}

function stageOfColumn(id: UniqueIdentifier): LeadStage | null {
  const value = String(id);
  if (!value.startsWith(COLUMN_PREFIX)) return null;
  const stage = value.slice(COLUMN_PREFIX.length);
  return (LEAD_STAGES as readonly string[]).includes(stage) ? (stage as LeadStage) : null;
}

function findStage(columns: Columns, id: UniqueIdentifier): LeadStage | null {
  const column = stageOfColumn(id);
  if (column) return column;
  for (const stage of LEAD_STAGES) {
    if (columns[stage].some((card) => card.id === id)) return stage;
  }
  return null;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

// -------------------------------------------------------------------- card

function CardBody({
  card,
  locked,
  dragging = false,
  handle,
}: {
  card: LeadCard;
  locked: boolean;
  dragging?: boolean;
  /** The keyboard's way to pick the card up; the pointer can grab it anywhere. */
  handle?: React.ReactNode;
}) {
  const closed = card.stage === "WON" || card.stage === "LOST";
  const overdue =
    !closed &&
    card.expectedCloseDate !== null &&
    new Date(card.expectedCloseDate).getTime() < Date.now();

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-hairline bg-canvas p-2.5 text-left",
        !locked && "cursor-grab active:cursor-grabbing",
        dragging && "cursor-grabbing border-hairline-strong shadow-[var(--shadow-overlay)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          {handle}
          <span className="font-mono text-[11px] text-ink-subtle">{card.code}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {locked ? (
            <Lock className="size-3 text-ink-subtle" aria-label={`Owned by ${card.ownerName}`} />
          ) : null}
          <span
            title={card.ownerName}
            className="inline-flex size-5 items-center justify-center rounded-full border border-hairline bg-surface-2 font-mono text-[9px] font-medium text-ink-muted"
          >
            {initials(card.ownerName)}
          </span>
        </span>
      </div>

      <Link
        href={`/leads/${card.id}`}
        draggable={false}
        className="line-clamp-2 text-body-sm leading-snug font-medium text-ink hover:text-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fill"
      >
        {card.title}
      </Link>
      <p className="truncate text-caption text-ink-subtle">
        {card.customerName ?? card.company ?? card.contactName}
      </p>

      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="flex items-baseline gap-1.5">
          <span data-numeric className="font-mono text-[12px] font-medium text-ink">
            {formatPeso(card.valueCentavos)}
          </span>
          {!closed ? (
            <span data-numeric className="font-mono text-[11px] text-ink-subtle">
              {Math.round(card.probabilityBps / 100)}%
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          {card.openActivities > 0 ? (
            <span
              className="inline-flex items-center gap-0.5 font-mono text-[11px] text-ink-subtle"
              title={`${card.openActivities} open activit${card.openActivities === 1 ? "y" : "ies"}`}
            >
              <ListTodo className="size-3" aria-hidden />
              {card.openActivities}
            </span>
          ) : null}
          {closed ? (
            card.closedAt ? (
              <span data-numeric className="font-mono text-[11px] text-ink-subtle">
                {formatDate(card.closedAt)}
              </span>
            ) : null
          ) : card.expectedCloseDate ? (
            <span
              data-numeric
              title={overdue ? "Expected close date has passed" : "Expected close"}
              className={cn(
                "inline-flex items-center gap-1 font-mono text-[11px]",
                overdue ? "text-danger" : "text-ink-subtle",
              )}
            >
              <CalendarClock className="size-3" aria-hidden />
              {formatDate(card.expectedCloseDate).replace(/, \d{4}$/, "")}
            </span>
          ) : null}
        </span>
      </div>
      {card.stage === "LOST" && card.lostReason ? (
        <p className="line-clamp-2 border-t border-hairline pt-1.5 text-caption text-ink-subtle">
          {card.lostReason}
        </p>
      ) : null}
    </div>
  );
}

function SortableCard({ card, locked }: { card: LeadCard; locked: boolean }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    disabled: locked,
    data: { stage: card.stage },
  });

  // The pointer can grab the card anywhere, so the pointer listener sits on
  // the list item. The keyboard picks it up from a grip button beside the
  // title link, never around it: a link inside a button is two controls in
  // one, which screen readers cannot operate, and the item has to stay a
  // list item for the column to stay a list.
  return (
    <li
      ref={setNodeRef}
      data-lead-card={card.code}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation rounded-md", isDragging && "opacity-40")}
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler | undefined}
    >
      <CardBody
        card={card}
        locked={locked}
        handle={
          locked ? null : (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              onKeyDown={listeners?.onKeyDown as React.KeyboardEventHandler | undefined}
              aria-roledescription="draggable lead"
              aria-label={`Move ${card.code} ${card.title}, ${STAGE_LABEL[card.stage]}, ${formatPeso(card.valueCentavos)}`}
              className="-ml-1 inline-flex size-5 items-center justify-center rounded-xs text-ink-subtle hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-fill"
            >
              <GripVertical className="size-3.5" aria-hidden />
            </button>
          )
        }
      />
    </li>
  );
}

// ------------------------------------------------------------------ column

function Column({
  stage,
  cards,
  total,
  blockedReason,
  isTarget,
  canMove,
}: {
  stage: LeadStage;
  cards: LeadCard[];
  total: { count: number; valueCentavos: number };
  blockedReason: string | null;
  isTarget: boolean;
  canMove: (card: LeadCard) => boolean;
}) {
  const { setNodeRef } = useDroppable({ id: columnId(stage) });
  const hidden = total.count - cards.length;

  return (
    <section
      aria-label={`${STAGE_LABEL[stage]}, ${total.count} leads`}
      data-stage={stage}
      className={cn(
        "flex w-[272px] shrink-0 snap-start flex-col rounded-lg border bg-surface-1 transition-colors",
        isTarget && !blockedReason ? "border-accent-fill/60 bg-accent-wash/40" : "border-hairline",
        blockedReason && "opacity-50",
      )}
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-hairline px-3 py-2">
        <h2 className="flex items-baseline gap-2 text-body-sm font-semibold text-ink">
          {STAGE_LABEL[stage]}
          <span data-numeric className="font-mono text-[11px] font-normal text-ink-subtle">
            {total.count}
          </span>
        </h2>
        <span data-numeric className="font-mono text-[12px] text-ink-muted">
          {formatPeso(total.valueCentavos).replace(/\.\d{2}$/, "")}
        </span>
      </header>

      {blockedReason ? (
        <p className="border-b border-hairline px-3 py-1.5 text-caption text-ink-muted">
          {blockedReason}
        </p>
      ) : null}

      <SortableContext
        id={columnId(stage)}
        items={cards.map((card) => card.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 p-2">
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} locked={!canMove(card)} />
          ))}
          {cards.length === 0 ? (
            <li className="flex flex-1 items-center justify-center rounded-md border border-dashed border-hairline-strong px-3 py-6 text-center text-caption text-ink-subtle">
              {stage === "WON"
                ? "Drop a quoted lead here to convert it"
                : stage === "LOST"
                  ? "Nothing lost. Keep it that way."
                  : "No leads at this stage"}
            </li>
          ) : null}
        </ol>
      </SortableContext>
      {hidden > 0 ? (
        <p
          className="border-t border-hairline px-3 py-1.5 text-caption text-ink-subtle"
          data-numeric
        >
          and {hidden} older, not shown
        </p>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------- board

type Pending =
  | { kind: "won"; card: LeadCard; snapshot: Columns }
  | { kind: "lost"; card: LeadCard; snapshot: Columns }
  | null;

export function LeadBoard({
  board,
  currentUserId,
  moveScope,
  canCreateCustomer,
}: {
  board: BoardData;
  currentUserId: string;
  /** Sales holds moving and converting as "own"; both scopes are the same. */
  moveScope: "all" | "own" | null;
  canCreateCustomer: boolean;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState<Columns>(board.columns);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overStage, setOverStage] = useState<LeadStage | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [fromStage, setFromStage] = useState<LeadStage | null>(null);
  const [, startTransition] = useTransition();
  const origin = useRef<{ stage: LeadStage; snapshot: Columns } | null>(null);
  const busy = useRef(false);
  busy.current = activeId !== null || pending !== null;

  // Fresh server data replaces local state, unless a drag or a dialog is open.
  useEffect(() => {
    if (!busy.current) setColumns(board.columns);
  }, [board.columns]);

  const sensors = useSensors(
    // A small travel threshold keeps a click on the title a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const canMove = (card: LeadCard) =>
    moveScope === "all" || (moveScope === "own" && card.ownerId === currentUserId);

  const activeCard = useMemo(() => {
    if (activeId === null) return null;
    for (const stage of LEAD_STAGES) {
      const card = columns[stage].find((item) => item.id === activeId);
      if (card) return card;
    }
    return null;
  }, [activeId, columns]);

  const blockedFor = (stage: LeadStage): string | null => {
    if (!fromStage || activeId === null) return null;
    return explainLeadMove(fromStage, stage);
  };

  function revert(snapshot: Columns, message?: string) {
    setColumns(snapshot);
    if (message) toast.error(message);
  }

  function neighbours(list: LeadCard[], id: string) {
    const index = list.findIndex((card) => card.id === id);
    return {
      beforeId: index > 0 ? (list[index - 1]?.id ?? null) : null,
      afterId: index >= 0 && index < list.length - 1 ? (list[index + 1]?.id ?? null) : null,
    };
  }

  function persist(card: LeadCard, stage: LeadStage, list: LeadCard[], snapshot: Columns) {
    const { beforeId, afterId } = neighbours(list, card.id);
    startTransition(async () => {
      const result = await moveLeadAction({ leadId: card.id, toStage: stage, beforeId, afterId });
      if (!result.ok) {
        revert(snapshot, result.error);
        return;
      }
      if (stage !== card.stage) toast.success(result.message ?? `Moved to ${STAGE_LABEL[stage]}.`);
      router.refresh();
    });
  }

  function onDragStart(event: DragStartEvent) {
    const stage = findStage(columns, event.active.id);
    if (!stage) return;
    origin.current = { stage, snapshot: columns };
    setFromStage(stage);
    setActiveId(event.active.id);
    setOverStage(stage);
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !origin.current) return;
    const targetStage = findStage(columns, over.id);
    const currentStage = findStage(columns, active.id);
    if (!targetStage || !currentStage) return;
    setOverStage(targetStage);
    if (targetStage === currentStage) return;

    // Only follow the pointer into columns the card may enter.
    if (explainLeadMove(origin.current.stage, targetStage) !== null) return;

    setColumns((previous) => {
      const source = previous[currentStage];
      const target = previous[targetStage];
      const moving = source.find((card) => card.id === active.id);
      if (!moving) return previous;
      const overIndex = target.findIndex((card) => card.id === over.id);
      const insertAt = overIndex >= 0 ? overIndex : target.length;
      return {
        ...previous,
        [currentStage]: source.filter((card) => card.id !== active.id),
        [targetStage]: [...target.slice(0, insertAt), moving, ...target.slice(insertAt)],
      };
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const start = origin.current;
    origin.current = null;
    setFromStage(null);
    setActiveId(null);
    setOverStage(null);
    if (!start) return;

    const card = start.snapshot[start.stage].find((item) => item.id === active.id);
    if (!card) return;

    // Dropped over a column the card could not enter: refuse without asking.
    const droppedOn = over ? findStage(columns, over.id) : null;
    if (droppedOn && droppedOn !== start.stage) {
      const refusal = explainLeadMove(start.stage, droppedOn);
      if (refusal) {
        revert(start.snapshot, refusal);
        return;
      }
    }

    const stage = findStage(columns, active.id);
    if (!stage || !over) {
      revert(start.snapshot);
      return;
    }

    let list = columns[stage];
    const from = list.findIndex((item) => item.id === active.id);
    const to = list.findIndex((item) => item.id === over.id);
    if (to >= 0 && from !== to) {
      list = arrayMove(list, from, to);
      setColumns((previous) => ({ ...previous, [stage]: list }));
    }

    const unchanged =
      stage === start.stage &&
      start.snapshot[stage].findIndex((item) => item.id === card.id) ===
        list.findIndex((item) => item.id === card.id);
    if (unchanged) return;

    if (stage === "WON" && start.stage !== "WON") {
      setPending({ kind: "won", card, snapshot: start.snapshot });
      return;
    }
    if (stage === "LOST" && start.stage !== "LOST") {
      setPending({ kind: "lost", card, snapshot: start.snapshot });
      return;
    }

    const moved = { ...card, stage };
    const nextList = list.map((item) => (item.id === card.id ? moved : item));
    setColumns((previous) => ({ ...previous, [stage]: nextList }));
    persist(card, stage, nextList, start.snapshot);
  }

  function onDragCancel() {
    if (origin.current) revert(origin.current.snapshot);
    origin.current = null;
    setFromStage(null);
    setActiveId(null);
    setOverStage(null);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const card = findCardById(columns, active.id);
      return card ? `Picked up ${card.code}, ${card.title}, in ${STAGE_LABEL[card.stage]}.` : "";
    },
    onDragOver: ({ over }) => {
      if (!over) return "Not over a column.";
      const stage = findStage(columns, over.id);
      if (!stage) return "";
      const refusal = origin.current ? explainLeadMove(origin.current.stage, stage) : null;
      return refusal
        ? `${STAGE_LABEL[stage]}: not allowed. ${refusal}`
        : `Over ${STAGE_LABEL[stage]}.`;
    },
    onDragEnd: ({ over }) => {
      const stage = over ? findStage(columns, over.id) : null;
      return stage ? `Dropped in ${STAGE_LABEL[stage]}.` : "Dropped.";
    },
    onDragCancel: () => "Move cancelled. The lead is back where it was.",
  };

  const convertTarget: ConvertTarget | null =
    pending?.kind === "won"
      ? {
          id: pending.card.id,
          code: pending.card.code,
          title: pending.card.title,
          contactName: pending.card.contactName,
          company: pending.card.company,
          email: pending.card.email,
          phone: pending.card.phone,
          customerId: pending.card.customerId,
          customerName: pending.card.customerName,
        }
      : null;

  return (
    <>
      <DndContext
        // A fixed id keeps dnd-kit's generated aria ids identical on the
        // server and the client; its counter otherwise differs and React
        // reports a hydration mismatch.
        id="lead-board"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Press space or enter to pick up a lead. Use the arrow keys to move it between stages and within a stage, then space or enter to drop it, or escape to cancel.",
          },
        }}
      >
        <div
          className="relative -mx-4 flex scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 max-md:snap-x max-md:snap-mandatory lg:-mx-6 lg:scroll-px-6 lg:px-6"
          data-board
        >
          {LEAD_STAGES.map((stage) => (
            <Column
              key={stage}
              stage={stage}
              cards={columns[stage]}
              total={
                stage === "WON" || stage === "LOST"
                  ? board.totals[stage]
                  : {
                      count: columns[stage].length,
                      valueCentavos: columns[stage].reduce(
                        (sum, card) => sum + card.valueCentavos,
                        0,
                      ),
                    }
              }
              blockedReason={blockedFor(stage)}
              isTarget={activeId !== null && overStage === stage && stage !== fromStage}
              canMove={canMove}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeCard ? (
            <div className="w-[256px] rotate-[1.5deg]">
              <CardBody card={activeCard} locked={false} dragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConvertLeadDialog
        lead={convertTarget}
        open={pending?.kind === "won"}
        canCreateCustomer={canCreateCustomer}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onCancel={() => {
          if (pending) revert(pending.snapshot);
          setPending(null);
        }}
        onConverted={() => setPending(null)}
      />

      <MarkLostDialog
        lead={pending?.kind === "lost" ? pending.card : null}
        open={pending?.kind === "lost"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onCancel={() => {
          if (pending) revert(pending.snapshot);
          setPending(null);
        }}
        onLost={() => setPending(null)}
      />
    </>
  );
}

function findCardById(columns: Columns, id: UniqueIdentifier): LeadCard | null {
  for (const stage of LEAD_STAGES) {
    const card = columns[stage].find((item) => item.id === id);
    if (card) return card;
  }
  return null;
}
