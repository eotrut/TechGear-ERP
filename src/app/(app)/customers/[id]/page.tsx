import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AtSign, FileText, Globe, LifeBuoy, Mail, MapPin, Pencil, Phone } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { LogActivityDialog } from "@/features/activities/components/log-activity-dialog";
import { activityOwners } from "@/features/activities/queries";
import {
  CustomerTypeBadge,
  OrderStatusBadge,
  SegmentBadge,
} from "@/features/customers/components/badges";
import { CustomerTimeline } from "@/features/customers/components/customer-timeline";
import { getCustomer360 } from "@/features/customers/queries";
import { SEGMENT_META } from "@/features/customers/services/segment-rules";
import { LeadStageBadge } from "@/features/leads/components/badges";
import {
  PriorityBadge,
  SlaIndicator,
  TicketStatusBadge,
} from "@/features/tickets/components/badges";
import { slaState } from "@/features/tickets/services/sla";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatRelative } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const data = await getCustomer360(id);
  return { title: data?.customer.displayName ?? "Customer" };
}

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

const CLAIM_TONE = {
  SUBMITTED: "info",
  UNDER_REVIEW: "warning",
  APPROVED: "accent",
  REJECTED: "critical",
  REPLACED: "success",
  REFUNDED: "success",
  CLOSED: "neutral",
} as const;

function RailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-hairline pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function Customer360Page({ params }: { params: Params }) {
  const { user } = await requirePermission("customers.view360");
  const { id } = await params;

  const data = await getCustomer360(id);
  if (!data) notFound();
  const { customer, stats, orders, tickets, claims, leads, timeline } = data;

  const canManage = can(user.role, "customers.manage");
  const canAssign = can(user.role, "activities.assignToOthers");
  const owners = canAssign ? await activityOwners() : undefined;
  const now = new Date();
  const openTickets = tickets.filter((ticket) =>
    ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"].includes(ticket.status),
  );
  const pastTickets = tickets.length - openTickets.length;
  const defaultAddress = customer.addresses[0];

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <div>
        <PageHeader
          title={customer.displayName}
          className="pb-2"
          actions={
            <>
              <LogActivityDialog
                currentUserId={user.id}
                owners={owners}
                context={{ customerId: customer.id, label: customer.displayName }}
              />
              {can(user.role, "tickets.comment") ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/tickets/new?customerId=${customer.id}`}>
                    <LifeBuoy aria-hidden />
                    New ticket
                  </Link>
                </Button>
              ) : null}
              {canManage ? (
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/customers/${customer.id}/edit`}>
                    <Pencil aria-hidden />
                    Edit
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm text-ink-subtle">
          <span className="font-mono text-[12px] text-ink-muted">{customer.code}</span>
          <SegmentBadge segment={customer.segment} />
          <CustomerTypeBadge type={customer.type} />
          <span>
            Customer since{" "}
            <span data-numeric className="text-ink-muted">
              {formatDate(customer.createdAt)}
            </span>
          </span>
          {customer.sourceChannel ? (
            <span>
              via <span className="text-ink-muted">{CHANNEL_LABEL[customer.sourceChannel]}</span>
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-caption text-ink-subtle">
          {SEGMENT_META[customer.segment].label}: {SEGMENT_META[customer.segment].rule}.
        </p>
      </div>

      <StatStrip
        stats={[
          {
            label: "Lifetime value",
            value: formatPeso(stats.lifetimeValueCentavos),
            hint:
              stats.refundedCentavos > 0
                ? `after ${formatPeso(stats.refundedCentavos)} refunded`
                : `${stats.orderCount} paid order${stats.orderCount === 1 ? "" : "s"}`,
          },
          {
            label: "Average order",
            value: stats.orderCount > 0 ? formatPeso(stats.averageOrderCentavos) : "none yet",
            hint: stats.topChannel ? `mostly ${CHANNEL_LABEL[stats.topChannel]}` : undefined,
          },
          {
            label: "Last purchase",
            value: stats.lastOrderAt ? formatRelative(stats.lastOrderAt) : "never",
            hint: stats.lastOrderAt ? formatDate(stats.lastOrderAt) : "no paid orders on record",
            tone:
              stats.lastOrderAt && now.getTime() - stats.lastOrderAt.getTime() > 180 * 86_400_000
                ? "warning"
                : "default",
          },
          {
            label: "Open tickets",
            value: String(stats.openTickets),
            hint: `${claims.length} warranty claim${claims.length === 1 ? "" : "s"}`,
            tone: openTickets.some((ticket) => ticket.slaDueAt < now) ? "critical" : "default",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-section text-ink">Purchase history</h2>
              {stats.totalOrders > orders.length ? (
                <span className="text-caption text-ink-subtle" data-numeric>
                  latest {orders.length} of {stats.totalOrders}
                </span>
              ) : null}
            </div>
            {orders.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No orders yet"
                description="Their first order through the POS or any channel will show here, with lifetime value and segment updating from it."
              />
            ) : (
              <div className="relative overflow-x-auto rounded-lg border border-hairline">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-hairline bg-surface-1">
                      <th className={`${th} text-left`}>Order</th>
                      <th className={`${th} hidden text-left md:table-cell`}>Items</th>
                      <th className={`${th} hidden text-left sm:table-cell`}>Channel</th>
                      <th className={`${th} text-left`}>Status</th>
                      <th className={`${th} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-hairline last:border-b-0">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="block font-mono text-[12px] text-ink">
                            {order.orderNumber}
                          </span>
                          <span className="block text-caption text-ink-subtle" data-numeric>
                            {formatDate(order.placedAt)}
                          </span>
                        </td>
                        <td className="hidden px-3 py-2 md:table-cell">
                          <span className="block max-w-[20rem] truncate text-ink-muted">
                            {order.leadItem ?? "No items"}
                          </span>
                          {order.itemCount > 1 ? (
                            <span className="text-caption text-ink-subtle" data-numeric>
                              and {order.itemCount - 1} more line{order.itemCount === 2 ? "" : "s"}
                            </span>
                          ) : null}
                        </td>
                        <td className="hidden px-3 py-2 whitespace-nowrap text-ink-muted sm:table-cell">
                          {CHANNEL_LABEL[order.channel]}
                        </td>
                        <td className="px-3 py-2">
                          <OrderStatusBadge status={order.status} />
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span data-numeric className="font-mono text-ink">
                            {formatPeso(order.totalCentavos)}
                          </span>
                          {order.amountRefundedCentavos > 0 ? (
                            <span data-numeric className="block font-mono text-[11px] text-danger">
                              {formatPeso(order.amountRefundedCentavos)} refunded
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-section text-ink">Activity</h2>
            <CustomerTimeline entries={timeline} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <RailSection title="Contact">
            <ul className="flex flex-col gap-1.5 text-body-sm">
              {customer.phone ? (
                <li className="flex items-center gap-2 text-ink">
                  <Phone className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <a
                    href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}
                    className="font-mono text-[12px] hover:text-accent-strong"
                  >
                    {customer.phone}
                  </a>
                </li>
              ) : null}
              {customer.email ? (
                <li className="flex items-center gap-2 text-ink">
                  <Mail className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <a
                    href={`mailto:${customer.email}`}
                    className="truncate hover:text-accent-strong"
                  >
                    {customer.email}
                  </a>
                </li>
              ) : null}
              {customer.facebookHandle ? (
                <li className="flex items-center gap-2 text-ink-muted">
                  <Globe className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <span className="truncate">{customer.facebookHandle}</span>
                </li>
              ) : null}
              {customer.instagramHandle ? (
                <li className="flex items-center gap-2 text-ink-muted">
                  <AtSign className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                  <span className="truncate">{customer.instagramHandle}</span>
                </li>
              ) : null}
            </ul>
            {customer.type === "BUSINESS" ? (
              <dl className="mt-3 grid grid-cols-2 gap-2 text-body-sm">
                <div>
                  <dt className="text-caption text-ink-subtle">TIN</dt>
                  <dd className="font-mono text-[12px] text-ink">
                    {customer.taxId ?? "not on file"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-ink-subtle">Credit limit</dt>
                  <dd data-numeric className="font-mono text-[12px] text-ink">
                    {customer.creditLimitCentavos > 0
                      ? formatPeso(customer.creditLimitCentavos)
                      : "prepaid"}
                  </dd>
                </div>
              </dl>
            ) : null}
          </RailSection>

          <RailSection title={customer.addresses.length > 1 ? "Addresses" : "Address"}>
            {defaultAddress ? (
              <ul className="flex flex-col gap-3">
                {customer.addresses.map((address) => (
                  <li key={address.id} className="flex gap-2 text-body-sm">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-ink">{address.line1}</p>
                      {address.line2 ? <p className="text-ink-subtle">{address.line2}</p> : null}
                      <p className="text-ink-muted">
                        Brgy. {address.barangay}, {address.city}
                      </p>
                      <p className="text-ink-muted">
                        {address.province}{" "}
                        <span className="font-mono text-[12px]">{address.postalCode}</span>
                      </p>
                      <p className="mt-0.5 text-caption text-ink-subtle">
                        {address.type.toLowerCase()}
                        {address.isDefault ? ", default" : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-ink-subtle">
                No address yet.{" "}
                {canManage ? (
                  <Link
                    href={`/customers/${customer.id}/edit`}
                    className="text-accent-strong hover:underline"
                  >
                    Add one
                  </Link>
                ) : null}
              </p>
            )}
          </RailSection>

          {customer.tags.length > 0 || customer.notes ? (
            <RailSection title="Notes">
              {customer.tags.length > 0 ? (
                <ul className="mb-2 flex flex-wrap gap-1">
                  {customer.tags.map((tag) => (
                    <li key={tag}>
                      <Link
                        href={`/customers?search=${encodeURIComponent(tag)}`}
                        className="inline-flex rounded-sm border border-hairline bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-ink-muted hover:text-ink"
                      >
                        {tag}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
              {customer.notes ? (
                <p className="text-body-sm whitespace-pre-line text-ink-muted">{customer.notes}</p>
              ) : null}
            </RailSection>
          ) : null}

          <RailSection
            title="Support"
            action={
              pastTickets > 0 ? (
                <span className="text-caption text-ink-subtle" data-numeric>
                  {pastTickets} closed
                </span>
              ) : null
            }
          >
            {openTickets.length === 0 ? (
              <p className="text-body-sm text-ink-subtle">No open tickets.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {openTickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link
                      href={`/tickets/${ticket.id}`}
                      className="block rounded-md border border-hairline bg-surface-1 px-2.5 py-2 transition-colors hover:bg-surface-2"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-ink-subtle">
                          {ticket.ticketNumber}
                        </span>
                        <SlaIndicator state={slaState(ticket, now)} compact />
                      </span>
                      <span className="mt-0.5 block truncate text-body-sm text-ink">
                        {ticket.subject}
                      </span>
                      <span className="mt-1 flex gap-1.5">
                        <TicketStatusBadge status={ticket.status} />
                        <PriorityBadge priority={ticket.priority} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>

          <RailSection title="Warranty claims">
            {claims.length === 0 ? (
              <p className="text-body-sm text-ink-subtle">None filed.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {claims.map((claim) => (
                  <li key={claim.id} className="text-body-sm">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-ink-subtle">
                        {claim.claimNumber}
                      </span>
                      <StatusBadge tone={CLAIM_TONE[claim.status]}>
                        {claim.status.toLowerCase().replace(/_/g, " ")}
                      </StatusBadge>
                    </span>
                    <span className="block truncate text-ink">{claim.variant.product.name}</span>
                    <span className="block text-caption text-ink-subtle" data-numeric>
                      filed {formatDate(claim.submittedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </RailSection>

          {leads.length > 0 ? (
            <RailSection title="Deals">
              <ul className="flex flex-col gap-2">
                {leads.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="flex items-center justify-between gap-2 text-body-sm hover:text-accent-strong"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{lead.title}</span>
                        <span data-numeric className="font-mono text-[11px] text-ink-subtle">
                          {lead.code} · {formatPeso(lead.valueCentavos)}
                        </span>
                      </span>
                      <LeadStageBadge stage={lead.stage} />
                    </Link>
                  </li>
                ))}
              </ul>
            </RailSection>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
