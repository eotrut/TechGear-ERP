import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { AgingStrip, SupplierAgingTable } from "@/features/purchasing/components/payables-aging";
import { AGING_BUCKET_LABEL } from "@/features/purchasing/services/bill-rules";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { ReportSection, ReportTable } from "@/features/reports/components/report-kit";
import { loadAging } from "@/features/reports/queries";
import { withParams } from "@/features/reports/schemas";
import { RECEIVABLE_TERMS_DAYS } from "@/features/reports/services/aging-rules";
import type { ReceivableRow } from "@/features/reports/services/operations";
import { CHANNEL_LABEL } from "@/lib/channels";
import { formatDate } from "@/lib/format";
import { formatAmount } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Aging" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AgingPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.aging");
  const params = await searchParams;
  const now = new Date();
  const { receivables, payables } = await loadAging(now);

  return (
    <ReportFrame slug="aging" user={user} now={now} query={withParams(params, {})}>
      <p className="-mt-4 text-caption text-ink-subtle">
        As of {formatDate(now)}. Days past due in Manila calendar days.
      </p>

      <ReportSection
        title="Receivables"
        description={`Orders placed and not yet paid. B2B accounts are due in ${RECEIVABLE_TERMS_DAYS.B2B} days; every other channel in ${RECEIVABLE_TERMS_DAYS.SHOPEE}, the time a transfer clears or a courier remits cash on delivery.`}
      >
        <AgingStrip totals={receivables.totals} totalLabel="Total owed to us" />
        <ReportTable<ReceivableRow>
          caption="Unpaid orders"
          rows={receivables.rows}
          rowKey={(row) => row.orderId}
          empty="Every placed order is paid. Nothing is owed."
          columns={[
            {
              key: "order",
              header: "Order",
              cell: (row) => (
                <>
                  <Link
                    href={`/orders/${row.orderId}`}
                    className="font-mono text-ink hover:text-accent-strong"
                  >
                    {row.orderNumber}
                  </Link>
                  <span className="block text-caption text-ink-subtle">
                    {row.customerName ?? "Walk-in"}
                  </span>
                </>
              ),
            },
            {
              key: "channel",
              header: "Channel",
              hideBelow: "md",
              cell: (row) => CHANNEL_LABEL[row.channel],
            },
            {
              key: "placed",
              header: "Placed",
              hideBelow: "sm",
              numeric: true,
              cell: (row) => formatDate(row.placedAt),
            },
            {
              key: "due",
              header: "Due",
              numeric: true,
              cell: (row) => formatDate(row.dueDate),
            },
            {
              key: "bucket",
              header: "Aging",
              hideBelow: "sm",
              cell: (row) => (
                <StatusBadge
                  tone={
                    row.bucket === "current"
                      ? "neutral"
                      : row.bucket === "d1_30"
                        ? "warning"
                        : "critical"
                  }
                >
                  {AGING_BUCKET_LABEL[row.bucket]}
                </StatusBadge>
              ),
            },
            {
              key: "balance",
              header: "Balance, PHP",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.balanceCentavos),
            },
          ]}
        />
      </ReportSection>

      <ReportSection
        title="Payables"
        description="Supplier bills not yet paid in full, by days past the due date the supplier's terms set."
      >
        <AgingStrip totals={payables.totals} />
        {payables.suppliers.length > 0 ? (
          <SupplierAgingTable rows={payables.suppliers} />
        ) : (
          <p className="text-body-sm text-ink-subtle">Every bill is paid.</p>
        )}
      </ReportSection>
    </ReportFrame>
  );
}
