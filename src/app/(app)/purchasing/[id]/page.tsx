import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  BillStatusBadge,
  OverdueNote,
  PoStatusBadge,
} from "@/features/purchasing/components/badges";
import { PoActions } from "@/features/purchasing/components/po-actions";
import { getPurchaseOrder } from "@/features/purchasing/queries";
import { daysOverdue } from "@/features/purchasing/services/bill-rules";
import {
  BILLABLE_STATUSES,
  canCancel,
  closeNeedsReason,
  isReceivable,
  PO_TRANSITIONS,
} from "@/features/purchasing/services/purchase-rules";
import { PAYMENT_TERMS_LABELS } from "@/features/suppliers/schemas";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { canTransition } from "@/lib/transitions";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const po = await getPurchaseOrder(id, { withBills: false });
  return { title: po?.poNumber ?? "Purchase order" };
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

type Step = {
  label: string;
  at: Date | null;
  detail?: string;
  state: "done" | "current" | "todo" | "void";
};

export default async function PurchaseOrderPage({ params }: { params: Params }) {
  const { user } = await requirePermission("purchasing.view");
  const { id } = await params;

  const viewBills = can(user.role, "bills.view");
  const po = await getPurchaseOrder(id, { withBills: viewBills });
  if (!po) notFound();

  const now = new Date();
  const { status } = po;
  const ordered = po.items.reduce((sum, item) => sum + item.qtyOrdered, 0);
  const received = po.items.reduce((sum, item) => sum + item.qtyReceived, 0);
  const outstanding = po.items.reduce((sum, item) => sum + item.outstanding, 0);
  const rejected = po.receipts.reduce(
    (sum, receipt) => sum + receipt.lines.reduce((inner, line) => inner + line.qtyRejected, 0),
    0,
  );
  const late = isReceivable(status) && po.expectedDate ? daysOverdue(po.expectedDate, now) : 0;
  const notes = (po.notes ?? "").split("\n").filter((line) => line.trim() !== "");
  const lastReceipt = po.receipts[po.receipts.length - 1];

  const flags = {
    edit: status === "DRAFT" && can(user.role, "purchasing.manage"),
    send: status === "DRAFT" && can(user.role, "purchasing.send"),
    receive: isReceivable(status) && can(user.role, "purchasing.receive"),
    bill:
      BILLABLE_STATUSES.includes(status) &&
      can(user.role, "bills.manage") &&
      po.unbilledCentavos > 0,
    cancel: canCancel(status, po.receipts.length) && can(user.role, "purchasing.close"),
    close: canTransition(PO_TRANSITIONS, status, "CLOSED") && can(user.role, "purchasing.close"),
  };

  const steps: Step[] = [
    { label: "Raised", at: po.createdAt, detail: `by ${po.createdBy.name}`, state: "done" },
    {
      label: "Sent",
      at: po.sentAt,
      detail: po.approvedBy ? `approved by ${po.approvedBy.name}` : undefined,
      state: po.sentAt ? "done" : status === "DRAFT" ? "current" : "void",
    },
  ];
  if (status === "CANCELLED") {
    steps.push({
      label: "Cancelled",
      at: po.cancelledAt,
      detail: "nothing received",
      state: "void",
    });
  } else {
    steps.push({
      label: status === "PARTIALLY_RECEIVED" ? "Partly received" : "Received",
      at:
        status === "RECEIVED" || status === "CLOSED" || status === "PARTIALLY_RECEIVED"
          ? (lastReceipt?.receivedAt ?? null)
          : null,
      detail:
        po.receipts.length > 0
          ? `${po.receipts.length} deliver${po.receipts.length === 1 ? "y" : "ies"}, ${received} of ${ordered} units`
          : undefined,
      state:
        status === "RECEIVED" || status === "CLOSED"
          ? "done"
          : status === "SENT" || status === "PARTIALLY_RECEIVED"
            ? "current"
            : "todo",
    });
    steps.push({
      label: "Closed",
      at: po.closedAt,
      detail: status === "CLOSED" && outstanding > 0 ? `short by ${outstanding}` : undefined,
      state: status === "CLOSED" ? "done" : "todo",
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title={po.poNumber}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {po.receipts.length > 0 && can(user.role, "inventory.viewLedger") ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/inventory/ledger?search=${encodeURIComponent(po.poNumber)}`}>
                  <ScrollText aria-hidden />
                  Ledger
                </Link>
              </Button>
            ) : null}
            <PoActions
              purchaseOrderId={po.id}
              poNumber={po.poNumber}
              flags={flags}
              outstandingUnits={outstanding}
              closeNeedsReason={closeNeedsReason(status)}
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PoStatusBadge status={status} />
        <span className="text-body text-ink">
          {can(user.role, "suppliers.view") ? (
            <Link href={`/suppliers/${po.supplier.id}`} className="hover:text-accent-strong">
              {po.supplier.name}
            </Link>
          ) : (
            po.supplier.name
          )}
        </span>
        <span className="text-body-sm text-ink-subtle">
          into <span className="font-mono text-[12px] text-ink-muted">{po.warehouse.code}</span>
        </span>
        <span className="text-body-sm text-ink-subtle" data-numeric>
          {received} of {ordered} units received
          {rejected > 0 ? `, ${rejected} rejected` : ""}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-2 text-section text-ink">Lines</h2>
            <div className="overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-1">
                    <th className={`${th} text-left`}>Item</th>
                    <th className={`${th} hidden text-right sm:table-cell`}>Ordered</th>
                    <th className={`${th} text-right`}>Received</th>
                    <th className={`${th} hidden text-right md:table-cell`}>Unit cost</th>
                    <th className={`${th} hidden text-right sm:table-cell`}>Line, PHP</th>
                    <th className={`${th} hidden text-right xl:table-cell`}>Avg cost now</th>
                  </tr>
                </thead>
                <tbody>
                  {po.items.map((item) => (
                    <tr key={item.id} className="border-b border-hairline last:border-b-0">
                      <td className="px-3 py-2">
                        <Link
                          href={`/inventory/ledger?variantId=${item.variantId}`}
                          className="block max-w-[11rem] truncate text-ink hover:text-accent-strong sm:max-w-[22rem]"
                        >
                          {item.productName}
                        </Link>
                        <span className="block max-w-[11rem] truncate text-caption text-ink-subtle sm:max-w-[22rem]">
                          {item.optionSummary}{" "}
                          <span className="font-mono text-[11px]">{item.sku}</span>
                        </span>
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink sm:table-cell"
                        data-numeric
                      >
                        {item.qtyOrdered}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span
                          data-numeric
                          className={cn(
                            "font-mono",
                            item.qtyReceived >= item.qtyOrdered
                              ? "text-success"
                              : item.qtyReceived > 0
                                ? "text-ink"
                                : "text-ink-subtle",
                          )}
                        >
                          {item.qtyReceived}
                        </span>
                        <span className="font-mono text-ink-subtle sm:hidden" data-numeric>
                          {" "}
                          / {item.qtyOrdered}
                        </span>
                        {item.outstanding > 0 && status !== "DRAFT" && status !== "CANCELLED" ? (
                          <span className="block text-caption text-ink-subtle" data-numeric>
                            {item.outstanding} {status === "CLOSED" ? "short" : "owed"}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-muted md:table-cell"
                        data-numeric
                      >
                        {formatAmount(item.unitCostCentavos)}
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink sm:table-cell"
                        data-numeric
                      >
                        {formatAmount(item.lineTotalCentavos)}
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-muted xl:table-cell"
                        data-numeric
                      >
                        {formatAmount(item.avgCostCentavos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-3 ml-auto w-full max-w-xs">
              {[
                { label: "Goods", value: po.subtotalCentavos },
                { label: "Freight", value: po.shippingCentavos },
                { label: "VAT 12%", value: po.vatCentavos },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-0.5">
                  <dt className="text-body-sm text-ink-muted">{row.label}</dt>
                  <dd data-numeric className="font-mono text-body-sm text-ink">
                    {formatAmount(row.value)}
                  </dd>
                </div>
              ))}
              <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
                <dt className="text-body-sm font-medium text-ink">Total</dt>
                <dd data-numeric className="font-mono text-lead font-medium text-ink">
                  {formatPeso(po.totalCentavos)}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="mb-2 text-section text-ink">Deliveries</h2>
            {po.receipts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
                {status === "DRAFT"
                  ? "Nothing can arrive until the order is sent."
                  : status === "CANCELLED"
                    ? "Cancelled before anything arrived."
                    : "Nothing has arrived yet. Each delivery gets its own goods received note here."}
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {po.receipts.map((receipt) => (
                  <li key={receipt.id} className="rounded-lg border border-hairline">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline bg-surface-1 px-3 py-2">
                      <span className="font-mono text-[12px] text-ink">{receipt.reference}</span>
                      <span className="text-caption text-ink-subtle">
                        <span className="font-mono" data-numeric>
                          {formatDateTime(receipt.receivedAt)}
                        </span>{" "}
                        by {receipt.receivedBy}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-body-sm">
                        <thead>
                          <tr className="border-b border-hairline">
                            <th className={`${th} text-left`}>SKU</th>
                            <th className={`${th} text-right`}>In</th>
                            <th className={`${th} text-right`}>Rejected</th>
                            <th className={`${th} text-right`}>Cost</th>
                            <th className={`${th} hidden text-right sm:table-cell`}>Avg after</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receipt.lines.map((line) => (
                            <tr key={line.id} className="border-b border-hairline last:border-b-0">
                              <td className="px-3 py-1.5 font-mono text-[12px] text-ink-muted">
                                {line.sku}
                              </td>
                              <td
                                className="px-3 py-1.5 text-right font-mono text-success"
                                data-numeric
                              >
                                {line.qtyReceived > 0 ? `+${line.qtyReceived}` : "0"}
                              </td>
                              <td
                                className={cn(
                                  "px-3 py-1.5 text-right font-mono",
                                  line.qtyRejected > 0 ? "text-danger" : "text-ink-subtle",
                                )}
                                data-numeric
                              >
                                {line.qtyRejected}
                              </td>
                              <td
                                className="px-3 py-1.5 text-right font-mono text-ink"
                                data-numeric
                              >
                                {formatAmount(line.unitCostCentavos)}
                              </td>
                              <td
                                className="hidden px-3 py-1.5 text-right font-mono text-ink-muted sm:table-cell"
                                data-numeric
                              >
                                {line.avgCostAfterCentavos === null
                                  ? "none"
                                  : formatAmount(line.avgCostAfterCentavos)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {receipt.note ? (
                      <p className="border-t border-hairline px-3 py-2 text-body-sm text-ink-muted">
                        {receipt.note}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {viewBills && BILLABLE_STATUSES.includes(status) ? (
            <section>
              <h2 className="mb-2 text-section text-ink">Bills</h2>
              {po.bills.length === 0 ? (
                <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
                  No supplier invoice recorded yet.{" "}
                  <span data-numeric className="font-mono text-ink-muted">
                    {formatPeso(po.unbilledCentavos)}
                  </span>{" "}
                  of goods and freight is unbilled.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-hairline">
                  <table className="w-full text-body-sm">
                    <thead>
                      <tr className="border-b border-hairline bg-surface-1">
                        <th className={`${th} text-left`}>Bill</th>
                        <th className={`${th} text-left`}>Status</th>
                        <th className={`${th} hidden text-left sm:table-cell`}>Due</th>
                        <th className={`${th} text-right`}>Total, PHP</th>
                        <th className={`${th} hidden text-right md:table-cell`}>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {po.bills.map((bill) => (
                        <tr key={bill.id} className="border-b border-hairline last:border-b-0">
                          <td className="px-3 py-2">
                            <Link
                              href={`/purchasing/bills/${bill.id}`}
                              className="font-mono text-[12px] text-ink hover:text-accent-strong"
                            >
                              {bill.billNumber}
                            </Link>
                            {bill.supplierReference ? (
                              <span className="block font-mono text-[11px] text-ink-subtle">
                                {bill.supplierReference}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            <BillStatusBadge status={bill.status} />
                          </td>
                          <td
                            className="hidden px-3 py-2 font-mono text-[12px] text-ink-muted sm:table-cell"
                            data-numeric
                          >
                            {formatDate(bill.dueDate)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-ink" data-numeric>
                            {formatAmount(bill.totalCentavos)}
                          </td>
                          <td
                            className="hidden px-3 py-2 text-right font-mono text-ink-muted md:table-cell"
                            data-numeric
                          >
                            {formatAmount(bill.amountPaidCentavos)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {po.unbilledCentavos > 0 ? (
                    <p className="border-t border-hairline px-3 py-2 text-caption text-ink-subtle">
                      <span data-numeric className="font-mono text-ink-muted">
                        {formatPeso(po.unbilledCentavos)}
                      </span>{" "}
                      of received goods and freight is not yet billed.
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <Rail title="Timeline">
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
                        step.state === "todo" || (step.state === "void" && !step.at)
                          ? "text-ink-subtle"
                          : "text-ink",
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
          </Rail>

          <Rail title="Dates">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
              <dt className="text-ink-subtle">Ordered</dt>
              <dd className="text-right font-mono text-[12px] text-ink" data-numeric>
                {formatDate(po.orderDate)}
              </dd>
              <dt className="text-ink-subtle">Expected</dt>
              <dd className="text-right font-mono text-[12px] text-ink" data-numeric>
                {po.expectedDate ? formatDate(po.expectedDate) : "not set"}
                <OverdueNote days={late} />
              </dd>
            </dl>
          </Rail>

          <Rail title="Supplier">
            <p className="text-body-sm text-ink">{po.supplier.name}</p>
            <p className="font-mono text-[11px] text-ink-subtle">{po.supplier.code}</p>
            {po.supplier.contactName ? (
              <p className="mt-1 text-body-sm text-ink-muted">{po.supplier.contactName}</p>
            ) : null}
            {po.supplier.email ? (
              <p className="truncate text-caption text-ink-subtle">{po.supplier.email}</p>
            ) : null}
            {po.supplier.phone ? (
              <p className="font-mono text-[12px] text-ink-subtle">{po.supplier.phone}</p>
            ) : null}
            <p className="mt-1 text-caption text-ink-subtle">
              {PAYMENT_TERMS_LABELS[po.supplier.paymentTerms]}, {po.supplier.leadTimeDays} day lead
              time
            </p>
          </Rail>

          {notes.length > 0 ? (
            <Rail title="Notes">
              <ul className="flex flex-col gap-1.5">
                {notes.map((note, index) => (
                  <li key={index} className="text-body-sm text-ink-muted">
                    {note}
                  </li>
                ))}
              </ul>
            </Rail>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
