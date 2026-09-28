import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import { DispositionBadge, ReturnStatusBadge } from "@/features/returns/components/badges";
import { ReturnActions } from "@/features/returns/components/return-actions";
import { getReturn } from "@/features/returns/queries";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDateTime } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const record = await getReturn(id, { viewMoney: false });
  return { title: record?.rmaNumber ?? "Return" };
}

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

type Step = {
  label: string;
  at: Date | null;
  detail?: string;
  state: "done" | "current" | "todo" | "void";
};

export default async function ReturnDetailPage({ params }: { params: Params }) {
  const { user } = await requirePermission("returns.view");
  const { id } = await params;
  const viewMoney = can(user.role, "orders.viewMoney");
  const record = await getReturn(id, { viewMoney });
  if (!record) notFound();

  const { status } = record;
  const completed = status === "COMPLETED";
  const rejected = status === "REJECTED";
  const units = record.items.reduce((sum, item) => sum + item.qty, 0);

  // Each line carries its refund: estimated when the return was raised, final once completed.
  const estimate = record.items.reduce((sum, item) => sum + item.refundAmountCentavos, 0);
  const refunded = record.refunds.reduce((sum, refund) => sum + refund.amountCentavos, 0);

  const steps: Step[] = [
    {
      label: "Requested",
      at: record.requestedAt,
      detail: record.createdBy ? `by ${record.createdBy.name}` : undefined,
      state: "done",
    },
    {
      label: "Approved",
      at: record.approvedAt,
      state: record.approvedAt ? "done" : status === "REQUESTED" ? "current" : "void",
    },
    {
      label: "Received",
      at: record.receivedAt,
      detail: record.receivedAt ? `into ${record.warehouse.code}` : undefined,
      state: record.receivedAt
        ? "done"
        : status === "APPROVED"
          ? "current"
          : rejected
            ? "void"
            : "todo",
    },
    rejected
      ? { label: "Rejected", at: null, state: "void" }
      : {
          label: "Completed",
          at: record.completedAt,
          detail: completed && viewMoney ? `${formatPeso(refunded)} refunded` : undefined,
          state: completed ? "done" : status === "RECEIVED" ? "current" : "todo",
        },
  ];
  const notes = (record.notes ?? "").split("\n").filter((line) => line.trim() !== "");

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <div>
        <PageHeader
          title={record.rmaNumber}
          className="pb-2"
          actions={
            <ReturnActions
              returnId={record.id}
              rmaNumber={record.rmaNumber}
              status={status}
              lines={record.items.map((item) => ({
                id: item.id,
                sku: item.orderItem.skuSnapshot,
                name: item.orderItem.nameSnapshot,
                qty: item.qty,
                disposition: item.disposition,
              }))}
              can={{
                approve: can(user.role, "returns.approve"),
                receive: can(user.role, "returns.receive"),
                refund: can(user.role, "returns.refund"),
              }}
              estimateCentavos={estimate}
              shippingCentavos={record.order.shippingCentavos}
              shippingRefundable={record.order.returns.length === 0}
              defaultMethod={record.order.payments[0]?.method ?? null}
            />
          }
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-body-sm text-ink-subtle">
          <ReturnStatusBadge status={status} />
          <span>
            From{" "}
            <Link
              href={`/orders/${record.order.id}`}
              className="font-mono text-[12px] text-accent-strong hover:underline"
            >
              {record.order.orderNumber}
            </Link>
            , {CHANNEL_LABEL[record.order.channel]}
          </span>
          <span>{record.customer.displayName}</span>
          <span data-numeric>
            {units} unit{units === 1 ? "" : "s"} back to{" "}
            <span className="font-mono text-[12px] text-ink-muted">{record.warehouse.code}</span>
          </span>
        </div>
      </div>

      <p className="rounded-md border border-hairline bg-surface-1 px-3 py-2 text-body-sm text-ink-muted">
        <span className="text-ink">Reason:</span> {record.reason}
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-2 text-section text-ink">Lines</h2>
            <div className="relative overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-1">
                    <th className={`${th} text-left`}>Item</th>
                    <th className={`${th} text-right`}>Units</th>
                    <th className={`${th} text-left`}>Disposition</th>
                    {viewMoney ? (
                      <th className={`${th} text-right`}>
                        {completed ? "Refunded" : "Refund, est."}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {record.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-b border-hairline align-top last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/products/${item.orderItem.variant.productId}`}
                          className="block max-w-[24rem] truncate text-ink hover:text-accent-strong"
                        >
                          {item.orderItem.nameSnapshot}
                        </Link>
                        <span className="font-mono text-[11px] text-ink-subtle">
                          {item.orderItem.skuSnapshot}
                        </span>
                        {item.conditionNote ? (
                          <span className="block text-caption text-ink-muted">
                            {item.conditionNote}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-ink" data-numeric>
                        {item.qty}
                        <span className="block text-[11px] text-ink-subtle">
                          of {item.orderItem.qty}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {status === "REQUESTED" || status === "APPROVED" ? (
                          <span className="text-caption text-ink-subtle">decided on receipt</span>
                        ) : (
                          <DispositionBadge disposition={item.disposition} />
                        )}
                        {item.movements.length > 0 ? (
                          <span className="mt-1 block text-caption text-ink-subtle">
                            {item.movements.some((movement) => movement.type === "RETURN")
                              ? "back on the shelf"
                              : "booked to loss"}
                          </span>
                        ) : null}
                      </td>
                      {viewMoney ? (
                        <td
                          className="px-3 py-2 text-right font-mono whitespace-nowrap text-ink"
                          data-numeric
                        >
                          {rejected ? "none" : formatPeso(item.refundAmountCentavos)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {viewMoney && record.refunds.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Refund</h2>
              <ul className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline">
                {record.refunds.map((refund) => (
                  <li key={refund.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div>
                      <p className="text-body-sm text-ink">{PAYMENT_METHOD_LABEL[refund.method]}</p>
                      <p className="text-caption text-ink-subtle" data-numeric>
                        {formatDateTime(refund.refundedAt)}
                        {refund.reference ? (
                          <span className="ml-1.5 font-mono">{refund.reference}</span>
                        ) : null}
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
          <section>
            <h2 className="mb-2 text-section text-ink">Timeline</h2>
            <ol className="flex flex-col">
              {steps.map((step, index) => (
                <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < steps.length - 1 ? (
                    <span
                      className="absolute top-4 bottom-0 left-[5px] w-px bg-hairline"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-[11px] shrink-0 rounded-full border",
                      step.state === "done" && "border-success bg-success",
                      step.state === "current" && "border-accent-fill bg-canvas",
                      step.state === "todo" && "border-hairline-strong bg-canvas",
                      step.state === "void" && "border-hairline-strong bg-surface-3",
                    )}
                  />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "text-body-sm font-medium",
                        step.state === "todo" ? "text-ink-subtle" : "text-ink",
                      )}
                    >
                      {step.label}
                    </p>
                    {step.at ? (
                      <p className="font-mono text-[12px] text-ink-muted" data-numeric>
                        {formatDateTime(step.at)}
                      </p>
                    ) : (
                      <p className="text-caption text-ink-subtle">
                        {step.state === "current"
                          ? "waiting"
                          : step.state === "void"
                            ? "skipped"
                            : "pending"}
                      </p>
                    )}
                    {step.detail ? (
                      <p className="text-caption text-ink-subtle">{step.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {notes.length > 0 ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Notes</h2>
              <ul className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-1 p-3">
                {notes.map((note, index) => (
                  <li key={index} className="text-body-sm text-ink-muted">
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 text-section text-ink">Customer</h2>
            <p className="text-body-sm text-ink">
              {can(user.role, "customers.view360") ? (
                <Link
                  href={`/customers/${record.customer.id}`}
                  className="hover:text-accent-strong"
                >
                  {record.customer.displayName}
                </Link>
              ) : (
                record.customer.displayName
              )}
            </p>
            <p className="font-mono text-[11px] text-ink-subtle">{record.customer.code}</p>
            {record.customer.phone ? (
              <p className="font-mono text-[12px] text-ink-muted">{record.customer.phone}</p>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
