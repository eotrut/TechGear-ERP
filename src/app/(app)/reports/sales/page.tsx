import type { Metadata } from "next";

import { TrendChart } from "@/components/charts/trend-chart";
import { ViewTabs } from "@/components/data-table/view-tabs";
import { ReportFrame } from "@/features/reports/components/report-frame";
import { ChartPanel, KpiGrid, ReportSection } from "@/features/reports/components/report-kit";
import {
  ChannelTable,
  LineGroupTable,
  RevenueBridge,
  SalespersonTable,
  trendPoints,
} from "@/features/reports/components/sales-parts";
import { hasComparison, loadSalesReport } from "@/features/reports/queries";
import {
  paramReader,
  readRange,
  salesReportSchema,
  withParams,
  type SalesBreakdown,
} from "@/features/reports/schemas";
import { byPeriod } from "@/features/reports/services/date-range";
import { averageOrderValue } from "@/features/reports/services/measures";
import { formatNumber } from "@/lib/format";
import { formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Sales report" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS: { by: SalesBreakdown; label: string }[] = [
  { by: "product", label: "By product" },
  { by: "category", label: "By category" },
  { by: "channel", label: "By channel" },
  { by: "salesperson", label: "By salesperson" },
];

export default async function SalesReportPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.sales");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now);
  const { by } = salesReportSchema.parse({ by: paramReader(params)("by") });

  const [report, comparable] = await Promise.all([
    loadSalesReport(range, by, user),
    hasComparison(range),
  ]);
  const { totals, previous } = report.period;
  const against = "vs prior period";

  return (
    <ReportFrame
      slug="sales"
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
            label: "Revenue",
            value: formatPeso(totals.revenue),
            delta: { current: totals.revenue, previous: previous.revenue, against },
          },
          {
            label: "Orders",
            value: formatNumber(totals.orders),
            delta: { current: totals.orders, previous: previous.orders, against },
          },
          {
            label: "Average order",
            value: formatPeso(averageOrderValue(totals.revenue, totals.orders)),
            delta: {
              current: averageOrderValue(totals.revenue, totals.orders),
              previous: averageOrderValue(previous.revenue, previous.orders),
              against,
            },
          },
          {
            label: "Units sold",
            value: formatNumber(report.units.units),
            hint:
              report.units.returned > 0
                ? `${formatNumber(report.units.returned)} since returned`
                : "None returned",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <ReportSection title={`Revenue ${byPeriod(range.granularity)}`}>
          <ChartPanel>
            <TrendChart
              data={trendPoints(
                report.period.series,
                comparable ? report.period.previousSeries : [],
                range.granularity,
                (bucket) => bucket.revenue,
              )}
              seriesLabel={range.label}
              previousLabel="Prior period"
              caption={`Revenue ${byPeriod(range.granularity)}, ${range.label}`}
            />
          </ChartPanel>
        </ReportSection>
        <ReportSection title="From merchandise to revenue">
          <RevenueBridge totals={totals} />
        </ReportSection>
      </div>

      <div className="flex flex-col gap-3">
        <ViewTabs
          tabs={TABS.map((tab) => ({
            label: tab.label,
            href: `/reports/sales${withParams(params, { by: tab.by === "product" ? undefined : tab.by })}`,
            active: tab.by === by,
          }))}
        />
        {report.by === "product" ? (
          <LineGroupTable
            kind="product"
            limit={25}
            rows={report.products}
            merchandiseTotal={totals.merchandise}
          />
        ) : report.by === "category" ? (
          <LineGroupTable
            kind="category"
            rows={report.categories}
            merchandiseTotal={totals.merchandise}
          />
        ) : report.by === "channel" ? (
          <ChannelTable rows={report.channels} revenueTotal={totals.revenue} />
        ) : (
          <>
            {report.scopedToSelf ? (
              <p className="text-body-sm text-ink-subtle">
                Showing your own sales. Managers see every salesperson.
              </p>
            ) : null}
            <SalespersonTable rows={report.salespeople} revenueTotal={totals.revenue} />
          </>
        )}
        {report.by === "product" || report.by === "category" ? (
          <p className="text-caption text-ink-subtle">
            Merchandise is the goods on each order after discounts, before refunds. Add shipping and
            take away refunds to reach revenue, as the bridge above shows.
          </p>
        ) : null}
      </div>
    </ReportFrame>
  );
}
