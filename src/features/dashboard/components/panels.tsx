import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { ACTIVITY_TYPE_LABEL } from "@/features/activities/schemas";
import { PriorityBadge, SlaIndicator } from "@/features/tickets/components/badges";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatNumber, formatWeekday } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { stockAlerts, tasksDue, ticketQueue, warehouseQueue } from "../queries";

/**
 * The work lists on the dashboard: short, ranked by urgency, each ending in
 * a link to the full page. Five or six rows, because a dashboard list is a
 * prompt to act, not the place to do the work.
 */

export function Panel({
  title,
  count,
  href,
  linkLabel,
  children,
  empty,
}: {
  title: string;
  count?: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
  empty?: string | null;
}) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col rounded-lg border border-hairline bg-canvas"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2 id={id} className="text-body font-medium text-ink">
          {title}
        </h2>
        {count ? (
          <span data-numeric className="font-mono text-caption text-ink-subtle">
            {count}
          </span>
        ) : null}
      </div>
      {empty ? (
        <p className="flex-1 px-4 py-6 text-body-sm text-ink-subtle">{empty}</p>
      ) : (
        <ul className="flex-1 divide-y divide-hairline">{children}</ul>
      )}
      <Link
        href={href}
        className="group flex items-center gap-1 border-t border-hairline px-4 py-2.5 text-body-sm text-accent-strong hover:bg-surface-1 focus-visible:-outline-offset-2"
      >
        {linkLabel}
        <ArrowRight
          aria-hidden
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </section>
  );
}

function Row({
  href,
  primary,
  secondary,
  aside,
}: {
  href: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-1 focus-visible:-outline-offset-2"
      >
        <span className="min-w-0">
          <span className="block truncate text-body-sm text-ink">{primary}</span>
          {secondary ? (
            <span className="block truncate text-caption text-ink-subtle">{secondary}</span>
          ) : null}
        </span>
        {aside ? <span className="shrink-0 text-right">{aside}</span> : null}
      </Link>
    </li>
  );
}

export function LowStockPanel({ alerts }: { alerts: Awaited<ReturnType<typeof stockAlerts>> }) {
  return (
    <Panel
      title="Low and out of stock"
      count={`${formatNumber(alerts.out)} out, ${formatNumber(alerts.low)} low`}
      href="/inventory/alerts"
      linkLabel="All stock alerts"
      empty={alerts.rows.length === 0 ? "Every position is above its reorder level." : null}
    >
      {alerts.rows.map((row) => (
        <Row
          key={`${row.variantId}:${row.warehouseId}`}
          href={`/products/${row.productId}`}
          primary={<span className="font-mono text-[12px]">{row.sku}</span>}
          secondary={`${row.productName}, ${row.optionSummary}`}
          aside={
            <>
              <StatusBadge tone={row.level === "out" ? "critical" : "warning"}>
                {row.level === "out" ? "out" : `${row.available} left`}
              </StatusBadge>
              <span className="mt-0.5 block font-mono text-[11px] text-ink-subtle">
                {row.warehouseCode}
              </span>
            </>
          }
        />
      ))}
    </Panel>
  );
}

export function TicketsPanel({
  queue,
  mine,
}: {
  queue: Awaited<ReturnType<typeof ticketQueue>>;
  mine: boolean;
}) {
  return (
    <Panel
      title={mine ? "Your open tickets" : "Open tickets"}
      count={`${formatNumber(queue.open)} open${queue.breached > 0 ? `, ${queue.breached} past SLA` : ""}`}
      href={mine ? "/tickets?view=mine" : "/tickets"}
      linkLabel="Ticket queue"
      empty={queue.rows.length === 0 ? "No open tickets. The queue is clear." : null}
    >
      {queue.rows.map((row) => (
        <Row
          key={row.id}
          href={`/tickets/${row.id}`}
          primary={row.subject}
          secondary={
            <>
              <span className="font-mono">{row.ticketNumber}</span>, {row.customerName}
            </>
          }
          aside={
            <span className="flex flex-col items-end gap-1">
              <PriorityBadge priority={row.priority} />
              <SlaIndicator state={row.sla} compact />
            </span>
          }
        />
      ))}
    </Panel>
  );
}

export function TasksPanel({ tasks }: { tasks: Awaited<ReturnType<typeof tasksDue>> }) {
  return (
    <Panel
      title="Your tasks"
      count={`${formatNumber(tasks.overdue)} overdue, ${formatNumber(tasks.dueToday)} today`}
      href="/activities/mine"
      linkLabel="All your tasks"
      empty={tasks.rows.length === 0 ? "Nothing scheduled. Plan the next follow-up." : null}
    >
      {tasks.rows.map((row) => (
        <Row
          key={row.id}
          href="/activities/mine"
          primary={row.subject}
          secondary={`${ACTIVITY_TYPE_LABEL[row.type]}${row.about ? `, ${row.about}` : ""}`}
          aside={
            row.dueAt ? (
              <span
                data-numeric
                className={cn(
                  "font-mono text-[12px] whitespace-nowrap",
                  row.overdue ? "text-danger" : "text-ink-muted",
                )}
              >
                {row.overdue ? "overdue" : formatWeekday(row.dueAt)}
              </span>
            ) : null
          }
        />
      ))}
    </Panel>
  );
}

type Queue = Awaited<ReturnType<typeof warehouseQueue>>;

export function IncomingPanel({ queue }: { queue: Queue }) {
  return (
    <Panel
      title="Deliveries expected"
      count={`${formatNumber(queue.incomingCount)} open${queue.lateCount > 0 ? `, ${queue.lateCount} late` : ""}`}
      href="/purchasing?view=open"
      linkLabel="Open purchase orders"
      empty={queue.incoming.length === 0 ? "No purchase orders are waiting on a delivery." : null}
    >
      {queue.incoming.map((po) => (
        <Row
          key={po.id}
          href={`/purchasing/${po.id}`}
          primary={<span className="font-mono text-[12px]">{po.poNumber}</span>}
          secondary={`${po.supplierName}${po.partial ? ", partly received" : ""}`}
          aside={
            <>
              <span
                data-numeric
                className={cn(
                  "block font-mono text-[12px] whitespace-nowrap",
                  po.late ? "text-danger" : "text-ink-muted",
                )}
              >
                {po.expectedDate ? formatDate(po.expectedDate) : "No date"}
              </span>
              <span className="font-mono text-[11px] text-ink-subtle">{po.warehouseCode}</span>
            </>
          }
        />
      ))}
    </Panel>
  );
}

export function PackPanel({ queue }: { queue: Queue }) {
  return (
    <Panel
      title="Waiting to pack"
      count={`${formatNumber(queue.toPack)} paid, ${formatNumber(queue.toShip)} packed`}
      href="/orders?view=to-fulfil"
      linkLabel="Orders to fulfil"
      empty={queue.packRows.length === 0 ? "Every paid order is packed." : null}
    >
      {queue.packRows.map((order) => (
        <Row
          key={order.id}
          href={`/orders/${order.id}`}
          primary={<span className="font-mono text-[12px]">{order.orderNumber}</span>}
          secondary={`${CHANNEL_LABEL[order.channel]}, ${order.lines} line${order.lines === 1 ? "" : "s"}`}
          aside={
            <>
              <span data-numeric className="block font-mono text-[12px] text-ink-muted">
                {order.paidAt ? formatDate(order.paidAt) : ""}
              </span>
              <span className="font-mono text-[11px] text-ink-subtle">{order.warehouseCode}</span>
            </>
          }
        />
      ))}
    </Panel>
  );
}

/** A ranked top-five with the value at the end, for products and customers. */
export function TopList({
  title,
  href,
  linkLabel,
  rows,
}: {
  title: string;
  href: string;
  linkLabel: string;
  rows: { key: string; href: string; primary: string; secondary?: string; value: number }[];
}) {
  return (
    <Panel
      title={title}
      href={href}
      linkLabel={linkLabel}
      empty={rows.length === 0 ? "No sales in this period." : null}
    >
      {rows.map((row, index) => (
        <li key={row.key}>
          <Link
            href={row.href}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-1 focus-visible:-outline-offset-2"
          >
            <span data-numeric className="w-4 shrink-0 font-mono text-caption text-ink-subtle">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm text-ink">{row.primary}</span>
              {row.secondary ? (
                <span className="block truncate text-caption text-ink-subtle">{row.secondary}</span>
              ) : null}
            </span>
            <span data-numeric className="shrink-0 font-mono text-body-sm text-ink">
              {formatPeso(row.value)}
            </span>
          </Link>
        </li>
      ))}
    </Panel>
  );
}
