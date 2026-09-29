import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { OrderStatusBadge } from "@/features/orders/components/badges";
import { PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import { refundableBalance, refundForUnits } from "@/features/orders/services/order-rules";
import { ClaimActions } from "@/features/warranty/components/claim-actions";
import { ClaimStatusBadge } from "@/features/warranty/components/claim-status-badge";
import { getClaim, warrantyWarehouses } from "@/features/warranty/queries";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { currentUserCan, requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (!(await currentUserCan("warranty.view"))) return { title: "Warranty claim" };
  const { id } = await params;
  const claim = await getClaim(id, { viewMoney: false });
  return { title: claim?.claimNumber ?? "Warranty claim" };
}

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

export default async function ClaimDetailPage({ params }: { params: Params }) {
  const { user } = await requirePermission("warranty.view");
  const { id } = await params;
  const viewMoney = can(user.role, "orders.viewMoney");
  const [claim, warehouses] = await Promise.all([
    getClaim(id, { viewMoney }),
    warrantyWarehouses(),
  ]);
  if (!claim) notFound();

  const item = claim.orderItem;
  const order = item.order;
  const now = new Date();
  const daysLeft = Math.ceil((claim.warrantyExpiresAt.getTime() - now.getTime()) / 86_400_000);
  const unitRefund =
    viewMoney && item.qtyReturned < item.qty
      ? Math.min(refundForUnits(item, item.qtyReturned, 1), refundableBalance(order))
      : null;
  const resolution = (claim.resolution ?? "").split("\n").filter((line) => line.trim() !== "");

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <div>
        <PageHeader
          title={claim.claimNumber}
          className="pb-2"
          actions={
            <ClaimActions
              claimId={claim.id}
              claimNumber={claim.claimNumber}
              status={claim.status}
              can={{
                review: can(user.role, "warranty.review"),
                fulfil: can(user.role, "warranty.fulfil"),
                refund: can(user.role, "warranty.review") && can(user.role, "orders.refund"),
              }}
              warehouses={warehouses}
              defaultWarehouseId={
                warehouses.find((warehouse) => warehouse.id === order.warehouseId)?.id ??
                warehouses[0]?.id ??
                ""
              }
              unitRefundCentavos={unitRefund}
              defaultMethod={order.payments[0]?.method ?? null}
            />
          }
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm text-ink-subtle">
          <ClaimStatusBadge status={claim.status} />
          <span>{claim.customer.displayName}</span>
          <span data-numeric>Submitted {formatDate(claim.submittedAt)}</span>
          <span
            data-numeric
            className={daysLeft < 0 ? "text-danger" : daysLeft < 30 ? "text-warning" : undefined}
          >
            {daysLeft < 0
              ? `Coverage ended ${formatDate(claim.warrantyExpiresAt)}`
              : `Covered until ${formatDate(claim.warrantyExpiresAt)}, ${daysLeft} days left`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-2 text-section text-ink">Reported fault</h2>
            <p className="rounded-lg border border-hairline bg-surface-1 px-3 py-3 text-body whitespace-pre-line text-ink">
              {claim.issueDescription}
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-section text-ink">Item</h2>
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-hairline px-3 py-3">
              <div className="min-w-0">
                <Link
                  href={`/products/${claim.variant.productId}`}
                  className="block truncate text-body text-ink hover:text-accent-strong"
                >
                  {item.nameSnapshot}
                </Link>
                <p className="font-mono text-[11px] text-ink-subtle">{item.skuSnapshot}</p>
                {claim.serialNumber ? (
                  <p className="mt-1 text-caption text-ink-muted">
                    Serial <span className="font-mono">{claim.serialNumber}</span>
                  </p>
                ) : null}
              </div>
              <div className="text-right text-caption text-ink-subtle" data-numeric>
                <p>
                  From{" "}
                  <Link
                    href={`/orders/${order.id}`}
                    className="font-mono text-accent-strong hover:underline"
                  >
                    {order.orderNumber}
                  </Link>
                </p>
                <p>
                  {order.deliveredAt
                    ? `Delivered ${formatDate(order.deliveredAt)}`
                    : "Not delivered"}
                </p>
                <p>{claim.variant.warrantyMonths} month warranty</p>
              </div>
            </div>
          </section>

          {resolution.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Resolution notes</h2>
              <ul className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-1 p-3">
                {resolution.map((line, index) => (
                  <li key={index} className="text-body-sm text-ink-muted">
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {claim.replacementOrder ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Replacement</h2>
              <Link
                href={`/orders/${claim.replacementOrder.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-hairline px-3 py-2.5 transition-colors hover:bg-surface-1"
              >
                <span>
                  <span className="font-mono text-[12px] text-ink">
                    {claim.replacementOrder.orderNumber}
                  </span>
                  <span className="ml-2 text-caption text-ink-subtle">no charge, one unit</span>
                </span>
                <OrderStatusBadge status={claim.replacementOrder.status} />
              </Link>
            </section>
          ) : null}

          {viewMoney && order.refunds.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Refund</h2>
              <ul className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline">
                {order.refunds
                  .filter((refund) => refund.reason.includes(claim.claimNumber))
                  .map((refund) => (
                    <li
                      key={refund.id}
                      className="flex items-start justify-between gap-3 px-3 py-2"
                    >
                      <div>
                        <p className="text-body-sm text-ink">
                          {PAYMENT_METHOD_LABEL[refund.method]}
                        </p>
                        <p className="text-caption text-ink-subtle" data-numeric>
                          {formatDateTime(refund.refundedAt)}
                        </p>
                      </div>
                      <span className="font-mono text-body-sm text-danger" data-numeric>
                        -{formatPeso(refund.amountCentavos)}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-5">
          <Rail title="Customer">
            {can(user.role, "customers.view360") ? (
              <Link
                href={`/customers/${claim.customer.id}`}
                className="text-body text-ink hover:text-accent-strong"
              >
                {claim.customer.displayName}
              </Link>
            ) : (
              <p className="text-body text-ink">{claim.customer.displayName}</p>
            )}
            <p className="font-mono text-[11px] text-ink-subtle">{claim.customer.code}</p>
            {claim.customer.phone ? (
              <p className="font-mono text-[12px] text-ink-muted">{claim.customer.phone}</p>
            ) : null}
          </Rail>
          <Rail title="Handling">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
              <dt className="text-ink-subtle">Handled by</dt>
              <dd className="text-ink-muted">{claim.assignee?.name ?? "Nobody yet"}</dd>
              <dt className="text-ink-subtle">Last change</dt>
              <dd className="font-mono text-[12px] text-ink-muted" data-numeric>
                {formatDateTime(claim.updatedAt)}
              </dd>
              {claim.resolvedAt ? (
                <>
                  <dt className="text-ink-subtle">Resolved</dt>
                  <dd className="font-mono text-[12px] text-ink-muted" data-numeric>
                    {formatDateTime(claim.resolvedAt)}
                  </dd>
                </>
              ) : null}
            </dl>
          </Rail>
        </aside>
      </div>
    </div>
  );
}
