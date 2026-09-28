import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import {
  AgingBadge,
  BillStatusBadge,
  PoStatusBadge,
} from "@/features/purchasing/components/badges";
import { BillActions } from "@/features/purchasing/components/bill-actions";
import { getBill } from "@/features/purchasing/queries";
import {
  agingBucket,
  billBalance,
  BILL_TRANSITIONS,
  daysOverdue,
  isPayable,
} from "@/features/purchasing/services/bill-rules";
import { PAYMENT_TERMS_LABELS } from "@/features/suppliers/schemas";
import { formatDate, formatDateTime, manilaDayKey } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { canTransition } from "@/lib/transitions";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const bill = await getBill(id);
  return { title: bill?.billNumber ?? "Bill" };
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

export default async function BillPage({ params }: { params: Params }) {
  const { user } = await requirePermission("bills.view");
  const { id } = await params;

  const bill = await getBill(id);
  if (!bill) notFound();

  const now = new Date();
  const balance = isPayable(bill.status) ? billBalance(bill) : 0;
  const late = isPayable(bill.status) ? daysOverdue(bill.dueDate, now) : 0;
  const notes = (bill.notes ?? "").split("\n").filter((line) => line.trim() !== "");

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
      <PageHeader
        title={bill.billNumber}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BillActions
              billId={bill.id}
              billNumber={bill.billNumber}
              balanceCentavos={balance}
              today={manilaDayKey(now)}
              canPay={isPayable(bill.status) && can(user.role, "bills.manage")}
              canVoid={
                canTransition(BILL_TRANSITIONS, bill.status, "VOID") &&
                bill.amountPaidCentavos === 0 &&
                can(user.role, "bills.void")
              }
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BillStatusBadge status={bill.status} />
        {isPayable(bill.status) ? <AgingBadge bucket={agingBucket(bill.dueDate, now)} /> : null}
        <span className="text-body text-ink">
          <Link href={`/suppliers/${bill.supplier.id}`} className="hover:text-accent-strong">
            {bill.supplier.name}
          </Link>
        </span>
        {bill.supplierReference ? (
          <span className="text-body-sm text-ink-subtle">
            invoice{" "}
            <span className="font-mono text-[12px] text-ink-muted">{bill.supplierReference}</span>
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
              {[
                { label: "Total", value: formatPeso(bill.totalCentavos), tone: "text-ink" },
                { label: "Paid", value: formatPeso(bill.amountPaidCentavos), tone: "text-ink" },
                {
                  label: "Owed",
                  value: formatPeso(balance),
                  tone: balance === 0 ? "text-ink-subtle" : late > 0 ? "text-danger" : "text-ink",
                },
                {
                  label: late > 0 ? "Overdue" : "Due",
                  value:
                    late > 0 ? `${late} day${late === 1 ? "" : "s"}` : formatDate(bill.dueDate),
                  tone: late > 0 ? "text-danger" : "text-ink",
                },
              ].map((stat) => (
                <div key={stat.label} className="min-w-0 border-t border-hairline pt-2">
                  <dt className="text-[11px] tracking-[0.06em] text-ink-subtle uppercase">
                    {stat.label}
                  </dt>
                  <dd
                    data-numeric
                    className={cn("mt-0.5 truncate font-mono text-lead font-medium", stat.tone)}
                  >
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h2 className="mb-2 text-section text-ink">Payments</h2>
            {bill.payments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
                {bill.status === "VOID"
                  ? "Voided before anything was paid."
                  : "Nothing paid yet. Each payment against this bill is listed here."}
              </p>
            ) : (
              <div className="relative overflow-x-auto rounded-lg border border-hairline">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr className="border-b border-hairline bg-surface-1">
                      <th className={`${th} text-left`}>Paid</th>
                      <th className={`${th} text-left`}>Method</th>
                      <th className={`${th} hidden text-left sm:table-cell`}>Reference</th>
                      <th className={`${th} hidden text-left lg:table-cell`}>By</th>
                      <th className={`${th} text-right`}>Amount, PHP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.payments.map((payment) => (
                      <tr key={payment.id} className="border-b border-hairline last:border-b-0">
                        <td
                          className="px-3 py-2 font-mono text-[12px] whitespace-nowrap text-ink-muted"
                          data-numeric
                        >
                          {formatDateTime(payment.paidAt)}
                        </td>
                        <td className="px-3 py-2 text-ink">
                          {PAYMENT_METHOD_LABEL[payment.method]}
                        </td>
                        <td className="hidden px-3 py-2 font-mono text-[12px] text-ink-muted sm:table-cell">
                          {payment.reference ?? "none"}
                        </td>
                        <td className="hidden px-3 py-2 text-caption text-ink-subtle lg:table-cell">
                          {payment.createdBy.name}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink" data-numeric>
                          {formatAmount(payment.amountCentavos)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <Rail title="Amounts">
            <dl className="flex flex-col gap-1 text-body-sm">
              {[
                { label: "Before VAT", value: bill.subtotalCentavos },
                { label: "Input VAT 12%", value: bill.vatCentavos },
                { label: "Total", value: bill.totalCentavos },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-ink-subtle">{row.label}</dt>
                  <dd className="font-mono text-[12px] text-ink" data-numeric>
                    {formatAmount(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </Rail>

          <Rail title="Dates">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
              <dt className="text-ink-subtle">Invoice</dt>
              <dd className="text-right font-mono text-[12px] text-ink" data-numeric>
                {formatDate(bill.issueDate)}
              </dd>
              <dt className="text-ink-subtle">Due</dt>
              <dd className="text-right font-mono text-[12px] text-ink" data-numeric>
                {formatDate(bill.dueDate)}
              </dd>
            </dl>
            <p className="mt-1 text-caption text-ink-subtle">
              {PAYMENT_TERMS_LABELS[bill.supplier.paymentTerms]}
            </p>
          </Rail>

          {bill.purchaseOrder ? (
            <Rail title="Purchase order">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/purchasing/${bill.purchaseOrder.id}`}
                  className="font-mono text-[12px] text-ink hover:text-accent-strong"
                >
                  {bill.purchaseOrder.poNumber}
                </Link>
                <PoStatusBadge status={bill.purchaseOrder.status} />
              </div>
              <p className="mt-1 text-caption text-ink-subtle" data-numeric>
                ordered at {formatPeso(bill.purchaseOrder.totalCentavos)} with VAT
              </p>
            </Rail>
          ) : null}

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
