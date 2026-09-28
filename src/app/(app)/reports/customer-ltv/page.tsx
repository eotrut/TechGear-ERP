import type { Metadata } from "next";
import Link from "next/link";

import { BarList } from "@/components/charts/bar-list";
import { SegmentBadge } from "@/features/customers/components/badges";
import { SEGMENT_META } from "@/features/customers/services/segment-rules";
import { ReportFrame } from "@/features/reports/components/report-frame";
import {
  formatShare,
  KpiGrid,
  ReportSection,
  ReportTable,
} from "@/features/reports/components/report-kit";
import { loadCustomerValue } from "@/features/reports/queries";
import { readRange, withParams } from "@/features/reports/schemas";
import { averageOrderValue } from "@/features/reports/services/measures";
import type { CustomerValueRow } from "@/features/reports/services/operations";
import { formatDate, formatNumber } from "@/lib/format";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Customer lifetime value" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TOP = 40;
const SEGMENT_ORDER = ["VIP", "REPEAT", "NEW", "DORMANT"] as const;

export default async function CustomerLtvPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.customerLtv");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now, "12m");
  const report = await loadCustomerValue(range, { limit: TOP });

  const customers = report.segments.reduce((sum, row) => sum + row.customers, 0);
  const lifetime = report.segments.reduce((sum, row) => sum + row.lifetimeValueCentavos, 0);
  const buyersWithValue = report.segments
    .filter((row) => row.lifetimeValueCentavos > 0)
    .reduce((sum, row) => sum + row.customers, 0);
  const segments = SEGMENT_ORDER.map(
    (segment) =>
      report.segments.find((row) => row.segment === segment) ?? {
        segment,
        customers: 0,
        lifetimeValueCentavos: 0,
      },
  );

  return (
    <ReportFrame
      slug="customer-ltv"
      user={user}
      now={now}
      range={range}
      comparison="off"
      query={withParams(params, {})}
    >
      <KpiGrid
        items={[
          {
            label: "Customers who bought",
            value: formatNumber(report.buyers),
            hint: `${formatNumber(report.newBuyers)} first-time buyers in the period`,
          },
          {
            label: "Repeat rate",
            value: formatShare(report.repeatBuyers, report.buyers),
            hint: "Bought more than once in the period",
          },
          {
            label: "Revenue per buyer",
            value: formatPeso(averageOrderValue(report.buyerRevenueCentavos, report.buyers)),
            hint: "Walk-in sales have no customer and are left out",
          },
          {
            label: "Average lifetime value",
            value: formatPeso(averageOrderValue(lifetime, buyersWithValue)),
            hint: `Across ${formatNumber(buyersWithValue)} customers with a purchase`,
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ReportSection
          title="Lifetime value by segment"
          description="Where the value sits. Segments are recomputed on every completed order and nightly."
        >
          <BarList
            caption="Lifetime value by segment"
            items={segments.map((row) => ({
              key: row.segment,
              label: `${SEGMENT_META[row.segment].label}, ${formatNumber(row.customers)} customers`,
              value: row.lifetimeValueCentavos,
              display: formatPeso(row.lifetimeValueCentavos),
              detail: formatShare(row.lifetimeValueCentavos, lifetime),
              href: `/customers?segment=${row.segment}`,
            }))}
          />
        </ReportSection>
        <ReportSection title="Customers by segment" description="How many, not how much.">
          <BarList
            caption="Customers by segment"
            items={segments.map((row) => ({
              key: row.segment,
              label: SEGMENT_META[row.segment].label,
              value: row.customers,
              display: formatNumber(row.customers),
              detail: formatShare(row.customers, customers),
              href: `/customers?segment=${row.segment}`,
            }))}
          />
        </ReportSection>
      </div>

      <ReportSection
        title={`Top ${TOP} by lifetime value`}
        description="Lifetime columns cover every realised order; the period columns cover the selected range only. The export has every customer."
      >
        <ReportTable<CustomerValueRow>
          caption="Customers by lifetime value"
          rows={report.customers}
          rowKey={(row) => row.customerId}
          empty="No customer has bought anything yet."
          columns={[
            {
              key: "customer",
              header: "Customer",
              cell: (row) => (
                <>
                  <Link
                    href={`/customers/${row.customerId}`}
                    className="text-ink hover:text-accent-strong"
                  >
                    {row.name}
                  </Link>
                  <span className="block font-mono text-caption text-ink-subtle">{row.code}</span>
                </>
              ),
            },
            {
              key: "segment",
              header: "Segment",
              hideBelow: "sm",
              cell: (row) => <SegmentBadge segment={row.segment} />,
            },
            {
              key: "orders",
              header: "Orders",
              align: "right",
              numeric: true,
              hideBelow: "md",
              cell: (row) => formatNumber(row.lifetimeOrders),
            },
            {
              key: "aov",
              header: "Avg order",
              align: "right",
              numeric: true,
              hideBelow: "lg",
              cell: (row) =>
                formatAmount(averageOrderValue(row.lifetimeValueCentavos, row.lifetimeOrders)),
            },
            {
              key: "last",
              header: "Last order",
              numeric: true,
              hideBelow: "lg",
              cell: (row) => (row.lastOrderAt ? formatDate(row.lastOrderAt) : ""),
            },
            {
              key: "period",
              header: "In period",
              align: "right",
              numeric: true,
              hideBelow: "md",
              cell: (row) =>
                row.periodRevenueCentavos === 0 ? (
                  <span className="text-ink-subtle">0.00</span>
                ) : (
                  formatAmount(row.periodRevenueCentavos)
                ),
            },
            {
              key: "ltv",
              header: "Lifetime, PHP",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.lifetimeValueCentavos),
            },
          ]}
        />
      </ReportSection>
    </ReportFrame>
  );
}
