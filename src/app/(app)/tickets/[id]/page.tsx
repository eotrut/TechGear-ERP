import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { TicketStatus } from "@prisma/client";
import { Lock, Mail, Package, Phone, ShoppingBag } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ActivityList } from "@/features/activities/components/activity-list";
import { LogActivityDialog } from "@/features/activities/components/log-activity-dialog";
import { activityOwners } from "@/features/activities/queries";
import { OrderStatusBadge, SegmentBadge } from "@/features/customers/components/badges";
import {
  PriorityBadge,
  SlaIndicator,
  TicketStatusBadge,
} from "@/features/tickets/components/badges";
import { TicketComposer } from "@/features/tickets/components/ticket-composer";
import { TicketControls } from "@/features/tickets/components/ticket-controls";
import { getTicket, ticketAssignees } from "@/features/tickets/queries";
import { canReopenClosed, slaState } from "@/features/tickets/services/sla";
import { needsResolvePermission, TICKET_TRANSITIONS } from "@/features/tickets/services/tickets";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can, scopeFor } from "@/lib/rbac/can";
import { currentUserCan, requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!(await currentUserCan("tickets.view"))) return { title: "Ticket" };
  const { id } = await params;
  const ticket = await getTicket(id);
  return { title: ticket ? `${ticket.ticketNumber} ${ticket.subject}` : "Ticket" };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline pt-3">
      <h2 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stamp({ label, at }: { label: string; at: Date | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-body-sm">
      <dt className="text-ink-subtle">{label}</dt>
      <dd
        data-numeric
        className={cn("font-mono text-[12px]", at ? "text-ink-muted" : "text-ink-subtle")}
      >
        {at ? formatDateTime(at) : "not yet"}
      </dd>
    </div>
  );
}

export default async function TicketPage({ params }: { params: Params }) {
  const { user } = await requirePermission("tickets.view");
  const { id } = await params;

  const ticket = await getTicket(id);
  if (!ticket) notFound();

  const now = new Date();
  const sla = slaState(ticket, now);
  const canAssign = can(user.role, "tickets.assign");
  const canAssignActivities = can(user.role, "activities.assignToOthers");
  const [assignees, owners] = await Promise.all([
    canAssign ? ticketAssignees() : Promise.resolve([]),
    canAssignActivities ? activityOwners() : Promise.resolve(undefined),
  ]);

  // Offer only the moves this person may make on this ticket right now.
  const resolveScope = scopeFor(user.role, "tickets.resolve");
  const mayResolve =
    resolveScope === "all" || (resolveScope === "own" && ticket.assigneeId === user.id);
  const moves = TICKET_TRANSITIONS[ticket.status].filter((to: TicketStatus) => {
    if (needsResolvePermission(ticket.status, to) && !mayResolve) return false;
    if (ticket.status === "CLOSED" && !canReopenClosed(ticket.closedAt, now)) return false;
    return true;
  });

  const publicReplies = ticket.comments.filter((comment) => !comment.isInternal).length;

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5">
      <div>
        <PageHeader
          title={ticket.subject}
          className="pb-2"
          actions={
            <LogActivityDialog
              currentUserId={user.id}
              owners={owners}
              title="Add a follow-up"
              context={{ ticketId: ticket.id, label: ticket.ticketNumber }}
            />
          }
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm text-ink-subtle">
          <span className="font-mono text-[12px] text-ink-muted">{ticket.ticketNumber}</span>
          <TicketStatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
          <span>
            opened <span data-numeric>{formatRelative(ticket.createdAt)}</span>
          </span>
          <span>{ticket.assignee ? `assigned to ${ticket.assignee.name}` : "unassigned"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <ol className="flex flex-col gap-3" aria-label="Conversation">
            <li className="rounded-lg border border-hairline bg-surface-1 p-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <p className="text-body-sm font-medium text-ink">
                  {ticket.customer.displayName}
                  <span className="ml-2 text-caption font-normal text-ink-subtle">reported</span>
                </p>
                <time data-numeric className="font-mono text-[11px] text-ink-subtle">
                  {formatDateTime(ticket.createdAt)}
                </time>
              </div>
              <p className="text-body-sm whitespace-pre-line text-ink-muted">
                {ticket.description}
              </p>
            </li>

            {ticket.comments.map((comment) => (
              <li
                key={comment.id}
                className={cn(
                  "flex gap-3 rounded-lg border p-3",
                  comment.isInternal
                    ? "border-warning/35 bg-warning-wash"
                    : "border-hairline bg-canvas",
                )}
              >
                <span
                  aria-hidden
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-2 font-mono text-[10px] text-ink-muted"
                >
                  {initials(comment.author.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="flex items-center gap-2 text-body-sm font-medium text-ink">
                      {comment.author.name}
                      {comment.isInternal ? (
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] font-normal text-warning">
                          <Lock className="size-3" aria-hidden />
                          internal note
                        </span>
                      ) : null}
                    </p>
                    <time data-numeric className="font-mono text-[11px] text-ink-subtle">
                      {formatDateTime(comment.createdAt)}
                    </time>
                  </div>
                  <p className="text-body-sm whitespace-pre-line text-ink-muted">{comment.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <TicketComposer
            ticketId={ticket.id}
            canNote={can(user.role, "tickets.internalNote")}
            closed={ticket.status === "CLOSED"}
            firstResponsePending={ticket.firstResponseAt === null && publicReplies === 0}
          />

          {ticket.activities.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Follow-ups</h2>
              <ActivityList
                activities={ticket.activities.map((activity) => ({
                  id: activity.id,
                  type: activity.type,
                  status: activity.status,
                  subject: activity.subject,
                  note: null,
                  dueAt: activity.dueAt?.toISOString() ?? null,
                  completedAt: activity.completedAt?.toISOString() ?? null,
                  ownerId: activity.ownerId,
                  ownerName: activity.owner.name,
                }))}
                currentUserId={user.id}
                canManageOthers={canAssignActivities}
                showOwner
                showRelated={false}
              />
            </section>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section
            className={cn(
              "rounded-lg border p-3",
              sla.kind === "breached"
                ? "border-danger/35 bg-danger-wash"
                : sla.kind === "at-risk"
                  ? "border-warning/35 bg-warning-wash"
                  : "border-hairline bg-surface-1",
            )}
          >
            <p className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
              Resolution target
            </p>
            <p className="mt-1 flex items-baseline justify-between gap-2">
              <span data-numeric className="font-mono text-body-sm text-ink">
                {formatDateTime(ticket.slaDueAt)}
              </span>
              <SlaIndicator state={sla} />
            </p>
          </section>

          <TicketControls
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            assigneeId={ticket.assigneeId}
            moves={moves}
            canAssign={canAssign}
            assignees={assignees}
          />

          <RailSection title="Customer">
            <Link
              href={`/customers/${ticket.customer.id}`}
              className="block rounded-md border border-hairline bg-surface-1 px-3 py-2 transition-colors hover:bg-surface-2"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-body-sm font-medium text-ink">
                  {ticket.customer.displayName}
                </span>
                <SegmentBadge segment={ticket.customer.segment} />
              </span>
              <span data-numeric className="font-mono text-[11px] text-ink-subtle">
                {ticket.customer.code} · {ticket.customer.orderCount} orders ·{" "}
                {formatPeso(ticket.customer.lifetimeValueCentavos)}
              </span>
              {ticket.customer._count.tickets > 1 ? (
                <span className="mt-1 block text-caption text-warning">
                  {ticket.customer._count.tickets} open tickets for this customer
                </span>
              ) : null}
            </Link>
            <ul className="mt-2 flex flex-col gap-1 text-body-sm">
              {ticket.customer.phone ? (
                <li className="flex items-center gap-2">
                  <Phone className="size-3.5 text-ink-subtle" aria-hidden />
                  <span className="font-mono text-[12px] text-ink-muted">
                    {ticket.customer.phone}
                  </span>
                </li>
              ) : null}
              {ticket.customer.email ? (
                <li className="flex min-w-0 items-center gap-2">
                  <Mail className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <a
                    href={`mailto:${ticket.customer.email}`}
                    className="truncate text-ink-muted hover:text-accent-strong"
                  >
                    {ticket.customer.email}
                  </a>
                </li>
              ) : null}
            </ul>
          </RailSection>

          {ticket.order ? (
            <RailSection title="Order">
              <div className="flex items-start gap-2 text-body-sm">
                <ShoppingBag className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2">
                    <Link
                      href={`/orders/${ticket.order.id}`}
                      className="font-mono text-[12px] text-ink hover:text-accent-strong"
                    >
                      {ticket.order.orderNumber}
                    </Link>
                    <OrderStatusBadge status={ticket.order.status} />
                  </p>
                  <p data-numeric className="text-caption text-ink-subtle">
                    {formatDate(ticket.order.placedAt)} via {CHANNEL_LABEL[ticket.order.channel]},{" "}
                    {ticket.order._count.items} line{ticket.order._count.items === 1 ? "" : "s"},{" "}
                    <span className="font-mono">{formatPeso(ticket.order.totalCentavos)}</span>
                  </p>
                </div>
              </div>
            </RailSection>
          ) : null}

          {ticket.variant ? (
            <RailSection title="Product">
              <Link
                href={`/products/${ticket.variant.product.id}`}
                className="flex items-start gap-2 text-body-sm hover:text-accent-strong"
              >
                <Package className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-ink">{ticket.variant.product.name}</span>
                  <span className="block truncate text-caption text-ink-subtle">
                    {ticket.variant.optionSummary}{" "}
                    <span className="font-mono text-[11px]">{ticket.variant.sku}</span>
                  </span>
                </span>
              </Link>
            </RailSection>
          ) : null}

          <RailSection title="Timeline">
            <dl className="flex flex-col gap-1">
              <Stamp label="Opened" at={ticket.createdAt} />
              <Stamp label="First response" at={ticket.firstResponseAt} />
              <Stamp label="Resolved" at={ticket.resolvedAt} />
              <Stamp label="Closed" at={ticket.closedAt} />
            </dl>
          </RailSection>
        </aside>
      </div>
    </div>
  );
}
