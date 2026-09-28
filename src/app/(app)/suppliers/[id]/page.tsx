import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { StatStrip } from "@/components/layout/stat-strip";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { BillStatusBadge, PoStatusBadge } from "@/features/purchasing/components/badges";
import { AgingStrip } from "@/features/purchasing/components/payables-aging";
import { getSupplierDetail } from "@/features/purchasing/queries";
import { isPayable } from "@/features/purchasing/services/bill-rules";
import { PAYMENT_TERMS_LABELS } from "@/features/suppliers/schemas";
import { formatRate, isOnTime } from "@/features/suppliers/services/performance-rules";
import { formatDate } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { can } from "@/lib/rbac/can";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const supplier = await getSupplierDetail(id, { withBills: false });
  return { title: supplier?.name ?? "Supplier" };
}

const th =
  "px-3 py-2 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase whitespace-nowrap";

export default async function SupplierPage({ params }: { params: Params }) {
  const { user } = await requirePermission("suppliers.view");
  const { id } = await params;

  const viewBills = can(user.role, "bills.view");
  const supplier = await getSupplierDetail(id, { withBills: viewBills });
  if (!supplier) notFound();

  const { performance } = supplier;
  const leadDrift =
    performance.averageLeadDays !== null
      ? performance.averageLeadDays - supplier.leadTimeDays
      : null;
  const canOrder = can(user.role, "purchasing.manage") && supplier.isActive;
  const canSeePurchasing = can(user.role, "purchasing.view");

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
      <PageHeader
        title={supplier.name}
        description={[
          supplier.contactName,
          supplier.address ? `${supplier.address.city}, ${supplier.address.province}` : null,
          PAYMENT_TERMS_LABELS[supplier.paymentTerms],
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canOrder ? (
            <Button asChild variant="primary" size="sm">
              <Link href={`/purchasing/new?supplierId=${supplier.id}&reorder=1`}>
                <Plus aria-hidden />
                New purchase order
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="-mt-2 flex flex-wrap items-center gap-3 text-body-sm text-ink-subtle">
        <span className="font-mono text-[12px] text-ink-muted">{supplier.code}</span>
        {supplier.isActive ? null : <StatusBadge tone="neutral">inactive</StatusBadge>}
        {supplier.email ? <span>{supplier.email}</span> : null}
        {supplier.phone ? <span className="font-mono text-[12px]">{supplier.phone}</span> : null}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-section text-ink">Performance</h2>
        <StatStrip
          stats={[
            {
              label: "On time",
              value: formatRate(performance.onTimeRateBps),
              hint:
                performance.deliveries === 0
                  ? "no deliveries yet"
                  : `${performance.onTimeDeliveries} of ${performance.deliveries} deliveries by the expected date`,
              tone:
                performance.onTimeRateBps !== null && performance.onTimeRateBps < 7500
                  ? "warning"
                  : "default",
            },
            {
              label: "Defects",
              value: formatRate(performance.defectRateBps),
              hint:
                performance.unitsArrived === 0
                  ? "nothing has arrived"
                  : `${performance.unitsRejected} of ${performance.unitsArrived.toLocaleString("en-PH")} units rejected at the dock`,
              tone:
                performance.defectRateBps !== null && performance.defectRateBps >= 300
                  ? "warning"
                  : "default",
            },
            {
              label: "Actual lead time",
              value:
                performance.averageLeadDays === null
                  ? "none"
                  : `${performance.averageLeadDays} days`,
              hint:
                leadDrift === null
                  ? `quoted ${supplier.leadTimeDays} days`
                  : `quoted ${supplier.leadTimeDays}, ${
                      Math.abs(leadDrift) < 0.5
                        ? "on the mark"
                        : `${Math.abs(Math.round(leadDrift * 10) / 10)} days ${leadDrift > 0 ? "slower" : "faster"}`
                    }`,
              tone: leadDrift !== null && leadDrift >= 3 ? "warning" : "default",
            },
            {
              label: "Bought, 12 months",
              value: formatPeso(supplier.spend12mCentavos),
              hint: "received at cost, before VAT",
            },
          ]}
        />
      </section>

      {viewBills && supplier.payables.total > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-section text-ink">Owed to {supplier.name}</h2>
            <Link
              href={`/purchasing/bills?supplierId=${supplier.id}`}
              className="text-body-sm text-accent-strong hover:underline"
            >
              Unpaid bills
            </Link>
          </div>
          <AgingStrip totals={supplier.payables} />
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="min-w-0">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-section text-ink">Purchase orders</h2>
            {canSeePurchasing ? (
              <Link
                href={`/purchasing?supplierId=${supplier.id}`}
                className="text-body-sm text-accent-strong hover:underline"
              >
                All orders
              </Link>
            ) : null}
          </div>
          {supplier.purchaseOrders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
              Nothing ordered from {supplier.name} yet.
            </p>
          ) : (
            <div className="relative overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-1">
                    <th className={`${th} text-left`}>PO</th>
                    <th className={`${th} text-left`}>Status</th>
                    <th className={`${th} hidden text-left sm:table-cell`}>Ordered</th>
                    <th className={`${th} text-right`}>Received</th>
                    <th className={`${th} hidden text-right md:table-cell`}>Total, PHP</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.purchaseOrders.map((po) => (
                    <tr key={po.id} className="border-b border-hairline last:border-b-0">
                      <td className="px-3 py-2">
                        {canSeePurchasing ? (
                          <Link
                            href={`/purchasing/${po.id}`}
                            className="font-mono text-[12px] text-ink hover:text-accent-strong"
                          >
                            {po.poNumber}
                          </Link>
                        ) : (
                          <span className="font-mono text-[12px] text-ink">{po.poNumber}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <PoStatusBadge status={po.status} />
                      </td>
                      <td
                        className="hidden px-3 py-2 font-mono text-[12px] whitespace-nowrap text-ink-muted sm:table-cell"
                        data-numeric
                      >
                        {formatDate(po.orderDate)}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono whitespace-nowrap text-ink"
                        data-numeric
                      >
                        {po.unitsReceived}
                        <span className="text-ink-subtle"> / {po.unitsOrdered}</span>
                      </td>
                      <td
                        className="hidden px-3 py-2 text-right font-mono text-ink-muted md:table-cell"
                        data-numeric
                      >
                        {formatAmount(po.totalCentavos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="min-w-0">
          <h2 className="mb-2 text-section text-ink">Recent deliveries</h2>
          {supplier.deliveries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline-strong px-4 py-6 text-center text-body-sm text-ink-subtle">
              Nothing has arrived yet. On-time and defect rates start with the first delivery.
            </p>
          ) : (
            <div className="relative overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-hairline bg-surface-1">
                    <th className={`${th} text-left`}>Received</th>
                    <th className={`${th} text-left`}>Arrived</th>
                    <th className={`${th} text-right`}>Units</th>
                    <th className={`${th} text-right`}>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.deliveries.map((delivery) => {
                    const punctual = isOnTime(delivery);
                    return (
                      <tr
                        key={delivery.reference}
                        className="border-b border-hairline last:border-b-0"
                      >
                        <td className="px-3 py-2">
                          <span className="block font-mono text-[12px] text-ink">
                            {delivery.reference}
                          </span>
                          <span className="block font-mono text-[11px] text-ink-subtle">
                            {delivery.poNumber}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="block font-mono text-[12px] text-ink-muted" data-numeric>
                            {formatDate(delivery.receivedAt)}
                          </span>
                          {punctual === null ? null : (
                            <span
                              className={cn(
                                "block text-caption",
                                punctual ? "text-success" : "text-warning",
                              )}
                            >
                              {punctual ? "on time" : "late"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink" data-numeric>
                          {delivery.qtyReceived}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right font-mono",
                            delivery.qtyRejected > 0 ? "text-danger" : "text-ink-subtle",
                          )}
                          data-numeric
                        >
                          {delivery.qtyRejected}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {viewBills && supplier.bills.length > 0 ? (
        <section>
          <h2 className="mb-2 text-section text-ink">Recent bills</h2>
          <div className="relative overflow-x-auto rounded-lg border border-hairline">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-hairline bg-surface-1">
                  <th className={`${th} text-left`}>Bill</th>
                  <th className={`${th} text-left`}>Status</th>
                  <th className={`${th} hidden text-left sm:table-cell`}>Due</th>
                  <th className={`${th} hidden text-right md:table-cell`}>Total, PHP</th>
                  <th className={`${th} text-right`}>Owed, PHP</th>
                </tr>
              </thead>
              <tbody>
                {supplier.bills.map((bill) => (
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
                    <td
                      className="hidden px-3 py-2 text-right font-mono text-ink-muted md:table-cell"
                      data-numeric
                    >
                      {formatAmount(bill.totalCentavos)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink" data-numeric>
                      {formatAmount(
                        isPayable(bill.status) ? bill.totalCentavos - bill.amountPaidCentavos : 0,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
