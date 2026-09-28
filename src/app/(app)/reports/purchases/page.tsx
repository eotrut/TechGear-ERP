import type { Metadata } from "next";
import Link from "next/link";

import { ColumnChart } from "@/components/charts/column-chart";
import { ReportFrame } from "@/features/reports/components/report-frame";
import {
  ChartPanel,
  KpiGrid,
  ReportSection,
  ReportTable,
} from "@/features/reports/components/report-kit";
import { hasComparison, loadPurchases } from "@/features/reports/queries";
import { readRange, withParams } from "@/features/reports/schemas";
import { bucketLabel, byPeriod } from "@/features/reports/services/date-range";
import type { SupplierPurchaseRow } from "@/features/reports/services/operations";
import { formatNumber } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Purchases" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.finance");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now, "12m");
  const [{ suppliers, series, totals, previous }, comparable] = await Promise.all([
    loadPurchases(range),
    hasComparison(range),
  ]);
  const against = "vs prior period";
  const arrived = totals.receivedUnits + totals.rejectedUnits;

  return (
    <ReportFrame
      slug="purchases"
      user={user}
      now={now}
      range={range}
      comparison={comparable ? "on" : "unavailable"}
      query={withParams(params, {})}
    >
      <KpiGrid
        compare={comparable}
        items={[
          {
            label: "Ordered",
            value: formatPeso(totals.ordered),
            hint: `${formatNumber(totals.pos)} POs, goods and freight, VAT exclusive`,
            delta: {
              current: totals.ordered,
              previous: previous.ordered,
              against,
              upIsGood: false,
            },
          },
          {
            label: "Received at cost",
            value: formatPeso(totals.received),
            hint: `${formatNumber(totals.receivedUnits)} units accepted`,
            delta: {
              current: totals.received,
              previous: previous.received,
              against,
              upIsGood: false,
            },
          },
          {
            label: "Billed",
            value: formatPeso(totals.billed),
            hint: "Supplier bills, VAT inclusive",
          },
          {
            label: "Rejected at the dock",
            value: arrived > 0 ? `${((totals.rejectedUnits / arrived) * 100).toFixed(1)}%` : "0%",
            hint: `${formatNumber(totals.rejectedUnits)} of ${formatNumber(arrived)} units`,
            tone: totals.rejectedUnits > 0 ? "warning" : "default",
          },
        ]}
      />

      <ReportSection
        title={`Received ${byPeriod(range.granularity)}`}
        description="Accepted units at the cost on the delivery, the value that entered the moving average."
      >
        <ChartPanel>
          <ColumnChart
            data={series.map((bucket) => ({
              key: bucket.key,
              label: bucketLabel(bucket.key, range.granularity),
              value: bucket.value,
            }))}
            series={[{ key: "value", label: "Received at cost" }]}
            caption={`Goods received at cost ${byPeriod(range.granularity)}, ${range.label}`}
          />
        </ChartPanel>
      </ReportSection>

      <ReportSection
        title="By supplier"
        description="Each column is dated by its own event: a PO by the day it was raised, a delivery by the day it arrived, a bill by its issue date."
      >
        <ReportTable<SupplierPurchaseRow>
          caption="Purchases by supplier"
          rows={suppliers}
          rowKey={(row) => row.supplierId}
          footerLabel="Total"
          empty="No purchasing activity in this period."
          columns={[
            {
              key: "supplier",
              header: "Supplier",
              cell: (row) => (
                <>
                  <Link
                    href={`/suppliers/${row.supplierId}`}
                    className="text-ink hover:text-accent-strong"
                  >
                    {row.supplierName}
                  </Link>
                  <span className="block font-mono text-caption text-ink-subtle">{row.code}</span>
                </>
              ),
            },
            {
              key: "pos",
              header: "POs",
              align: "right",
              numeric: true,
              hideBelow: "md",
              cell: (row) => formatNumber(row.posRaised),
              footer: formatNumber(totals.pos),
            },
            {
              key: "ordered",
              header: "Ordered",
              align: "right",
              numeric: true,
              hideBelow: "sm",
              cell: (row) => formatAmount(row.orderedCentavos),
              footer: formatAmount(totals.ordered),
            },
            {
              key: "received",
              header: "Received",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.receivedCentavos),
              footer: formatAmount(totals.received),
            },
            {
              key: "rejected",
              header: "Rejected",
              align: "right",
              numeric: true,
              hideBelow: "lg",
              cell: (row) =>
                row.rejectedUnits === 0 ? (
                  <span className="text-ink-subtle">0</span>
                ) : (
                  <span className="text-warning">{formatNumber(row.rejectedUnits)}</span>
                ),
              footer: formatNumber(totals.rejectedUnits),
            },
            {
              key: "billed",
              header: "Billed",
              align: "right",
              numeric: true,
              hideBelow: "md",
              cell: (row) => formatAmount(row.billedCentavos),
              footer: formatAmount(totals.billed),
            },
            {
              key: "paid",
              header: "Paid, PHP",
              align: "right",
              numeric: true,
              hideBelow: "lg",
              cell: (row) => formatAmount(row.paidCentavos),
              footer: formatAmount(totals.paid),
            },
          ]}
        />
      </ReportSection>
    </ReportFrame>
  );
}
