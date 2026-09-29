import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SegmentBadge } from "@/features/customers/components/badges";
import { FulfilmentBadge, OrderStatusBadge } from "@/features/orders/components/badges";
import { OrderActions } from "@/features/orders/components/order-actions";
import { getOrder } from "@/features/orders/queries";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import {
  cancelNeedsRefund,
  hasShipped,
  isWithCustomer,
  ORDER_TRANSITIONS,
  refundableBalance,
} from "@/features/orders/services/order-rules";
import { RETURN_STATUS_LABEL } from "@/features/returns/schemas";
import { CLAIM_STATUS_LABEL } from "@/features/warranty/schemas";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can, scopeFor } from "@/lib/rbac/can";
import { currentUserCan, requirePermission } from "@/lib/rbac/guard";
import { canTransition } from "@/lib/transitions";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!(await currentUserCan("orders.view"))) return { title: "Order" };
  const { id } = await params;
  const order = await getOrder(id, { viewMoney: false });
  return { title: order?.orderNumber ?? "Order" };
}

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

function Rail({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-hairline pt-3">
      <h2 className="mb-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
  tone?: "danger" | "subtle";
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1", strong && "pt-2")}>
      <dt className={cn("text-body-sm", strong ? "font-medium text-ink" : "text-ink-muted")}>
        {label}
      </dt>
      <dd
        data-numeric
        className={cn(
          "font-mono whitespace-nowrap",
          strong ? "text-lead font-medium text-ink" : "text-body-sm text-ink",
          tone === "danger" && "text-danger",
          tone === "subtle" && "text-ink-subtle",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

const STEP_ORDER: OrderStatus[] = [
  "DRAFT",
  "PENDING",
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "COMPLETED",
];

export default async function OrderDetailPage({ params }: { params: Params }) {
  const { user } = await requirePermission("orders.view");
  const { id } = await params;

  const viewMoney = can(user.role, "orders.viewMoney");
  const order = await getOrder(id, { viewMoney });
  if (!order) notFound();

  const { status } = order;
  const units = order.items.reduce((sum, item) => sum + item.qty, 0);
  const returned = order.items.reduce((sum, item) => sum + item.qtyReturned, 0);
  const balance = order.totalCentavos - order.amountPaidCentavos;
  const refundable = refundableBalance(order);
  const owner = order.salespersonId ?? order.createdById;
  const canCancelThis =
    canTransition(ORDER_TRANSITIONS, status, "CANCELLED") &&
    can(user.role, "orders.cancel") &&
    (!cancelNeedsRefund(status) || can(user.role, "orders.refund")) &&
    // "own" scope cancels only the viewer's own orders. The action re-checks.
    (scopeFor(user.role, "orders.cancel") === "all" || owner === user.id);

  const flags = {
    place: status === "DRAFT" && can(user.role, "orders.create"),
    edit: status === "DRAFT" && can(user.role, "orders.create"),
    pay: status === "PENDING" && can(user.role, "orders.recordPayment"),
    fulfil: can(user.role, "orders.fulfil"),
    complete: can(user.role, "orders.complete"),
    cancel: canCancelThis,
    cancelRefunds: cancelNeedsRefund(status),
    refund:
      viewMoney &&
      can(user.role, "orders.refund") &&
      hasShipped(status) &&
      status !== "REFUNDED" &&
      refundable > 0,
    startReturn:
      isWithCustomer(status) &&
      can(user.role, "returns.create") &&
      order.customer !== null &&
      returned < units,
    print: viewMoney && can(user.role, "orders.print") && hasShipped(status),
  };
  const canClaim =
    isWithCustomer(status) && order.customer !== null && can(user.role, "warranty.create");
  const canSeeMargin = viewMoney && can(user.role, "products.viewCost") && hasShipped(status);

  const paidMethod = order.payments[0]?.method ?? null;
  const reached = STEP_ORDER.indexOf(status);
  const upcoming = reached >= 0 && status !== "COMPLETED" ? STEP_ORDER.slice(reached + 1) : [];
  const address = order.shippingAddress;

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <div>
        <PageHeader
          title={order.orderNumber}
          className="pb-2"
          actions={
            <OrderActions
              orderId={order.id}
              orderNumber={order.orderNumber}
              status={status}
              flags={flags}
              balanceCentavos={balance}
              refundableCentavos={refundable}
              paidMethod={paidMethod}
              channel={order.channel}
            />
          }
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm text-ink-subtle">
          <OrderStatusBadge status={status} />
          <StatusBadge tone={order.payment.tone}>{order.payment.label}</StatusBadge>
          <FulfilmentBadge status={status} />
          <span>{CHANNEL_LABEL[order.channel]}</span>
          {order.channelReference ? (
            <span className="font-mono text-[12px] text-ink-muted">{order.channelReference}</span>
          ) : null}
          <span data-numeric>Placed {formatDateTime(order.placedAt)}</span>
          <span>
            Ships from{" "}
            <span className="font-mono text-[12px] text-ink-muted">{order.warehouse.code}</span>
          </span>
        </div>
      </div>

      {order.replacementFor ? (
        <p className="rounded-md border border-hairline bg-surface-1 px-3 py-2 text-body-sm text-ink-muted">
          No-charge warranty replacement for{" "}
          <Link
            href={`/warranty/${order.replacementFor.id}`}
            className="font-mono text-accent-strong hover:underline"
          >
            {order.replacementFor.claimNumber}
          </Link>
          . The unit left stock at cost, which is booked as warranty expense.
        </p>
      ) : null}
      {status === "CANCELLED" && order.cancelReason ? (
        <p className="rounded-md border border-hairline bg-surface-1 px-3 py-2 text-body-sm text-ink-muted">
          Cancelled {order.cancelledAt ? formatDate(order.cancelledAt) : ""}: {order.cancelReason}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-section text-ink">Items</h2>
              <span className="text-caption text-ink-subtle" data-numeric>
                {units} unit{units === 1 ? "" : "s"} on {order.items.length} line
                {order.items.length === 1 ? "" : "s"}
                {returned > 0 ? `, ${returned} returned` : ""}
              </span>
            </div>
            <div className="relative overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-1">
                    <th className={`${th} text-left`}>Item</th>
                    <th className={`${th} text-right`}>Qty</th>
                    {viewMoney ? (
                      <>
                        <th className={`${th} hidden text-right sm:table-cell`}>Unit price</th>
                        <th className={`${th} hidden text-right md:table-cell`}>Discount</th>
                        <th className={`${th} text-right`}>Line total</th>
                      </>
                    ) : null}
                    {canClaim ? (
                      <th className={`${th} hidden text-right md:table-cell`}>Warranty</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item) => {
                    const openClaim = item.warrantyClaims.find(
                      (claim) => claim.status !== "CLOSED" && claim.status !== "REJECTED",
                    );
                    return (
                      <tr key={item.id} className="border-b border-hairline last:border-b-0">
                        <td className="px-3 py-2">
                          <Link
                            href={`/products/${item.variant.productId}`}
                            className="block max-w-[26rem] truncate text-ink hover:text-accent-strong"
                          >
                            {item.nameSnapshot}
                          </Link>
                          <span className="font-mono text-[11px] text-ink-subtle">
                            {item.skuSnapshot}
                          </span>
                          {item.warrantyClaims.length > 0 ? (
                            <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                              {item.warrantyClaims.map((claim) => (
                                <Link key={claim.id} href={`/warranty/${claim.id}`}>
                                  <StatusBadge tone="info">
                                    {claim.claimNumber}{" "}
                                    {CLAIM_STATUS_LABEL[claim.status].toLowerCase()}
                                  </StatusBadge>
                                </Link>
                              ))}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap" data-numeric>
                          <span className="font-mono text-ink">{item.qty}</span>
                          {item.qtyReturned > 0 ? (
                            <span className="block text-caption text-danger">
                              {item.qtyReturned} returned
                            </span>
                          ) : null}
                        </td>
                        {viewMoney ? (
                          <>
                            <td
                              className="hidden px-3 py-2 text-right font-mono text-ink-muted sm:table-cell"
                              data-numeric
                            >
                              {formatPeso(item.unitPriceCentavos)}
                            </td>
                            <td
                              className="hidden px-3 py-2 text-right font-mono md:table-cell"
                              data-numeric
                            >
                              {item.discountCentavos > 0 ? (
                                <span className="text-ink-muted">
                                  -{formatPeso(item.discountCentavos)}
                                </span>
                              ) : (
                                <span className="text-ink-subtle">none</span>
                              )}
                            </td>
                            <td
                              className="px-3 py-2 text-right font-mono whitespace-nowrap text-ink"
                              data-numeric
                            >
                              {formatPeso(item.lineTotalCentavos)}
                            </td>
                          </>
                        ) : null}
                        {canClaim ? (
                          <td className="hidden px-3 py-2 text-right whitespace-nowrap md:table-cell">
                            {openClaim ? (
                              <span className="text-caption text-ink-subtle">claim open</span>
                            ) : item.qtyReturned < item.qty && item.variant.warrantyMonths > 0 ? (
                              <Link
                                href={`/warranty/new?orderItemId=${item.id}`}
                                className="inline-flex items-center gap-1 text-caption text-accent-strong hover:underline"
                              >
                                <ShieldCheck className="size-3.5" aria-hidden />
                                Claim
                              </Link>
                            ) : (
                              <span className="text-caption text-ink-subtle">none</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {viewMoney ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <section>
                <h2 className="mb-2 text-section text-ink">Payments</h2>
                {order.payments.length === 0 ? (
                  <p className="rounded-lg border border-hairline bg-surface-1 px-3 py-3 text-body-sm text-ink-subtle">
                    {status === "DRAFT" || status === "PENDING"
                      ? `Nothing paid yet. ${formatPeso(balance)} is due${status === "PENDING" ? "; stock stays reserved until it is paid" : " once the order is placed"}.`
                      : order.totalCentavos === 0
                        ? "No charge on this order."
                        : "No payment was recorded."}
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline">
                    {order.payments.map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-body-sm text-ink">
                            {PAYMENT_METHOD_LABEL[payment.method]}
                          </p>
                          <p className="text-caption text-ink-subtle" data-numeric>
                            {formatDateTime(payment.paidAt)}
                            {payment.reference ? (
                              <span className="ml-1.5 font-mono">{payment.reference}</span>
                            ) : null}
                          </p>
                          {payment.tenderedCentavos !== null && payment.changeCentavos ? (
                            <p className="text-caption text-ink-subtle" data-numeric>
                              {formatPeso(payment.tenderedCentavos)} handed over,{" "}
                              {formatPeso(payment.changeCentavos)} change
                            </p>
                          ) : null}
                        </div>
                        <span
                          className="font-mono text-body-sm whitespace-nowrap text-ink"
                          data-numeric
                        >
                          {formatPeso(payment.amountCentavos)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 className="mb-2 text-section text-ink">Refunds</h2>
                {order.refunds.length === 0 ? (
                  <p className="rounded-lg border border-hairline bg-surface-1 px-3 py-3 text-body-sm text-ink-subtle">
                    Nothing has gone back to the customer.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline">
                    {order.refunds.map((refund) => (
                      <li
                        key={refund.id}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-body-sm text-ink">
                            {refund.return ? (
                              <Link
                                href={`/returns/${refund.return.id}`}
                                className="hover:text-accent-strong"
                              >
                                {refund.reason}
                              </Link>
                            ) : (
                              refund.reason
                            )}
                          </p>
                          <p className="text-caption text-ink-subtle" data-numeric>
                            {PAYMENT_METHOD_LABEL[refund.method]},{" "}
                            {formatDateTime(refund.refundedAt)}
                            {refund.reference ? (
                              <span className="ml-1.5 font-mono">{refund.reference}</span>
                            ) : null}
                          </p>
                        </div>
                        <span
                          className="font-mono text-body-sm whitespace-nowrap text-danger"
                          data-numeric
                        >
                          -{formatPeso(refund.amountCentavos)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {order.notes ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Notes</h2>
              <p className="rounded-lg border border-hairline bg-surface-1 px-3 py-2 text-body-sm whitespace-pre-line text-ink-muted">
                {order.notes}
              </p>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-5">
          {viewMoney ? (
            <section className="rounded-lg border border-hairline bg-surface-1 px-4 py-3">
              {/* Three lists, not one: a <dl> may only group its terms one level deep. */}
              <div className="flex flex-col divide-y divide-hairline">
                <dl className="pb-1">
                  <SummaryRow label="Subtotal" value={formatPeso(order.subtotalCentavos)} />
                  {order.discountCentavos > 0 ? (
                    <SummaryRow
                      label={
                        order.promoCodeSnapshot ? (
                          <>
                            Discount{" "}
                            <span className="font-mono text-[11px] text-ink-subtle">
                              {order.promoCodeSnapshot}
                            </span>
                          </>
                        ) : (
                          "Discount"
                        )
                      }
                      value={`-${formatPeso(order.discountCentavos)}`}
                    />
                  ) : null}
                  <SummaryRow
                    label="Shipping"
                    value={order.shippingCentavos > 0 ? formatPeso(order.shippingCentavos) : "Free"}
                  />
                </dl>
                <dl>
                  <SummaryRow label="Total" value={formatPeso(order.totalCentavos)} strong />
                  <SummaryRow
                    label="VAT included, 12%"
                    value={formatPeso(order.vatCentavos)}
                    tone="subtle"
                  />
                  <SummaryRow
                    label="VATable sales"
                    value={formatPeso(order.totalCentavos - order.vatCentavos)}
                    tone="subtle"
                  />
                </dl>
                <dl className="pt-1">
                  <SummaryRow label="Paid" value={formatPeso(order.amountPaidCentavos)} />
                  {order.amountRefundedCentavos > 0 ? (
                    <SummaryRow
                      label="Refunded"
                      value={`-${formatPeso(order.amountRefundedCentavos)}`}
                      tone="danger"
                    />
                  ) : null}
                  {balance > 0 && status !== "CANCELLED" ? (
                    <SummaryRow label="Balance due" value={formatPeso(balance)} strong />
                  ) : null}
                  {canSeeMargin ? (
                    <SummaryRow
                      label="Gross margin, ex VAT"
                      value={formatPeso(
                        order.totalCentavos - order.vatCentavos - order.costTotalCentavos,
                      )}
                      tone="subtle"
                    />
                  ) : null}
                </dl>
              </div>
            </section>
          ) : null}

          <Rail title="Customer">
            {order.customer ? (
              <div className="flex flex-col gap-1">
                {can(user.role, "customers.view360") ? (
                  <Link
                    href={`/customers/${order.customer.id}`}
                    className="text-body text-ink hover:text-accent-strong"
                  >
                    {order.customer.displayName}
                  </Link>
                ) : (
                  <span className="text-body text-ink">{order.customer.displayName}</span>
                )}
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-subtle">
                    {order.customer.code}
                  </span>
                  <SegmentBadge segment={order.customer.segment} />
                </span>
                {order.customer.email ? (
                  <span className="truncate text-caption text-ink-muted">
                    {order.customer.email}
                  </span>
                ) : null}
                {order.customer.phone ? (
                  <span className="font-mono text-[12px] text-ink-muted">
                    {order.customer.phone}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-body-sm text-ink-subtle">Walk-in, no customer on file.</p>
            )}
          </Rail>

          <Rail title="Ship to">
            {address ? (
              <address className="text-body-sm leading-relaxed text-ink-muted not-italic">
                {address.recipient ? (
                  <span className="block text-ink">{address.recipient}</span>
                ) : null}
                {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}
                <br />
                {address.barangay}, {address.city}
                <br />
                {address.province} {address.postalCode}
                {address.phone ? (
                  <span className="mt-1 block font-mono text-[12px]">{address.phone}</span>
                ) : null}
              </address>
            ) : (
              <p className="text-body-sm text-ink-subtle">
                {order.channel === "POS"
                  ? "Taken at the counter."
                  : "No shipping address on the order."}
              </p>
            )}
          </Rail>

          <Rail title="Timeline">
            <ol className="flex flex-col">
              {order.statusEvents.map((event, index) => (
                <li key={event.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {index < order.statusEvents.length - 1 || upcoming.length > 0 ? (
                    <span
                      className="absolute top-4 bottom-0 left-[5px] w-px bg-hairline"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-[11px] shrink-0 rounded-full border",
                      event.toStatus === "CANCELLED" || event.toStatus === "REFUNDED"
                        ? "border-hairline-strong bg-surface-3"
                        : "border-success bg-success",
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium text-ink">
                      {ORDER_STATUS_LABEL[event.toStatus]}
                    </p>
                    <p className="font-mono text-[12px] text-ink-muted" data-numeric>
                      {formatDateTime(event.createdAt)}
                    </p>
                    <p className="text-caption text-ink-subtle">
                      {event.actor ? `by ${event.actor.name}` : "by the system"}
                      {event.note ? `. ${event.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
              {upcoming.map((step, index) => (
                <li key={step} className="relative flex gap-3 pb-3 last:pb-0">
                  {index < upcoming.length - 1 ? (
                    <span
                      className="absolute top-4 bottom-0 left-[5px] w-px bg-hairline"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className="mt-1.5 size-[11px] shrink-0 rounded-full border border-hairline-strong bg-canvas"
                  />
                  <p className="text-body-sm text-ink-subtle">{ORDER_STATUS_LABEL[step]}</p>
                </li>
              ))}
            </ol>
          </Rail>

          {order.returns.length > 0 ? (
            <Rail title="Returns">
              <ul className="flex flex-col gap-2">
                {order.returns.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/returns/${item.id}`}
                      className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface-1 px-2.5 py-2 transition-colors hover:bg-surface-2"
                    >
                      <span className="font-mono text-[12px] text-ink">{item.rmaNumber}</span>
                      <span className="text-caption text-ink-subtle" data-numeric>
                        {item.items.reduce((sum, line) => sum + line.qty, 0)} units,{" "}
                        {RETURN_STATUS_LABEL[item.status].toLowerCase()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Rail>
          ) : null}

          <Rail title="People">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
              <dt className="text-ink-subtle">Sold by</dt>
              <dd className="text-ink-muted">
                {order.salesperson?.name ?? CHANNEL_LABEL[order.channel]}
              </dd>
              <dt className="text-ink-subtle">Keyed by</dt>
              <dd className="text-ink-muted">{order.createdBy?.name ?? "Import"}</dd>
            </dl>
          </Rail>
        </aside>
      </div>
    </div>
  );
}
