import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { CircleCheck } from "lucide-react";

import { ReceiptView } from "@/features/orders/components/sales-document";
import { printableOrder } from "@/features/orders/queries";
import { PAYMENT_METHOD_LABEL } from "@/features/orders/schemas";
import { salesDocument } from "@/features/orders/services/documents";
import { canPrintDocuments, hasDocument } from "@/features/orders/services/print-access";
import { ReceiptActions } from "@/features/pos/components/receipt-actions";
import { formatDateTime } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

type Params = Promise<{ orderId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { orderId } = await params;
  const printable = await printableOrder(orderId);
  return { title: printable ? `Sale ${printable.order.orderNumber}` : "Sale" };
}

/**
 * After the charge. The cashier needs two things at a glance, the change to
 * hand back and the receipt to hand over, and then one button that starts
 * the next sale; it has focus, so Enter does it.
 */
export default async function PosReceiptPage({ params }: { params: Params }) {
  const { user } = await requirePermission("pos.use");
  if (!canPrintDocuments(user.role)) forbidden();

  const { orderId } = await params;
  const printable = await printableOrder(orderId);
  if (!printable || printable.order.channel !== "POS" || !hasDocument(printable.order.status)) {
    notFound();
  }
  const { order } = printable;
  const doc = salesDocument("receipt", printable);
  const change = order.payments.reduce((sum, payment) => sum + (payment.changeCentavos ?? 0), 0);

  return (
    <>
      <style>{`@page { size: 80mm auto; margin: 0; }`}</style>
      <div className="flex-1 px-4 py-6 md:py-10 print:p-0">
        <div className="mx-auto grid w-full max-w-4xl gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-start print:block">
          <section className="no-print flex flex-col gap-6" aria-labelledby="sale-heading">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-success-wash text-success">
                <CircleCheck className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-body-sm text-ink-subtle">Sale complete</p>
                <h1 id="sale-heading" className="font-mono text-title text-ink">
                  {order.orderNumber}
                </h1>
                <p className="mt-0.5 text-body-sm text-ink-muted">
                  {formatDateTime(order.paidAt ?? order.placedAt)}
                  {", "}
                  {order.customer ? order.customer.displayName : "walk-in customer"}
                </p>
              </div>
            </div>

            <dl
              className="flex flex-col gap-1.5 border-y border-hairline py-4 text-body-sm"
              data-numeric
            >
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-muted">Total</dt>
                <dd className="font-mono text-lead text-ink tabular-nums">
                  {formatPeso(order.totalCentavos)}
                </dd>
              </div>
              {order.payments.map((payment, index) => (
                <div key={index} className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-subtle">
                    {PAYMENT_METHOD_LABEL[payment.method]}
                    {payment.tenderedCentavos
                      ? `, ${formatPeso(payment.tenderedCentavos)} received`
                      : payment.reference
                        ? `, ref. ${payment.reference}`
                        : ""}
                  </dt>
                  <dd className="font-mono text-ink-muted tabular-nums">
                    {formatPeso(payment.amountCentavos)}
                  </dd>
                </div>
              ))}
            </dl>

            {change > 0 ? (
              <div className="flex items-baseline justify-between gap-4 rounded-lg border border-hairline bg-surface-1 px-4 py-4">
                <span className="text-body font-medium text-ink">Change due</span>
                <span
                  className="font-mono text-display text-ink tabular-nums"
                  data-testid="change-due"
                >
                  {formatPeso(change)}
                </span>
              </div>
            ) : null}

            <ReceiptActions orderId={order.id} />
          </section>

          <div className="paper mx-auto w-fit rounded-md border border-hairline print:rounded-none print:border-0">
            <ReceiptView doc={doc} />
          </div>
        </div>
      </div>
    </>
  );
}
