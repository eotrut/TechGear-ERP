import type { Metadata } from "next";

import { ColumnChart } from "@/components/charts/column-chart";
import { ReportFrame } from "@/features/reports/components/report-frame";
import {
  ChartPanel,
  formatBps,
  formatShare,
  KpiGrid,
  ReportSection,
  ReportTable,
} from "@/features/reports/components/report-kit";
import { ChannelTable } from "@/features/reports/components/sales-parts";
import { hasComparison, loadGrossProfit } from "@/features/reports/queries";
import { readRange, withParams } from "@/features/reports/schemas";
import { bucketLabel, byPeriod, PERIOD_HEADER } from "@/features/reports/services/date-range";
import { marginBps } from "@/features/reports/services/measures";
import type { SalesBucket } from "@/features/reports/services/sales";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";

export const metadata: Metadata = { title: "Gross profit" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GrossProfitPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.finance");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now, "12m");
  const [{ period, channels }, comparable] = await Promise.all([
    loadGrossProfit(range),
    hasComparison(range),
  ]);
  const { totals, previous } = period;
  const against = "vs prior period";
  const margin = marginBps(totals.grossProfit, totals.netSales);
  const previousMargin = marginBps(previous.grossProfit, previous.netSales);
  const periodWord = PERIOD_HEADER[range.granularity];

  return (
    <ReportFrame
      slug="gross-profit"
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
            label: "Net sales",
            value: formatPeso(totals.netSales),
            hint: "Revenue less output VAT",
            delta: { current: totals.netSales, previous: previous.netSales, against },
          },
          {
            label: "Cost of goods sold",
            value: formatPeso(totals.cogs),
            hint: "At moving-average cost, less restocked returns",
            delta: { current: totals.cogs, previous: previous.cogs, against, upIsGood: false },
          },
          {
            label: "Gross profit",
            value: formatPeso(totals.grossProfit),
            delta: { current: totals.grossProfit, previous: previous.grossProfit, against },
          },
          {
            label: "Gross margin",
            value: formatBps(margin),
            hint:
              previousMargin === null || !comparable
                ? "No prior period to compare"
                : `${formatBps(previousMargin)} in the prior period`,
          },
        ]}
      />

      <ReportSection
        title={`Gross profit ${byPeriod(range.granularity)}`}
        description="VAT exclusive. Refunds and returns are netted against the order they belong to, so a month's figure settles as returns come in."
      >
        <ChartPanel>
          <ColumnChart
            data={period.series.map((bucket) => ({
              key: bucket.key,
              label: bucketLabel(bucket.key, range.granularity),
              grossProfit: bucket.grossProfit,
            }))}
            series={[{ key: "grossProfit", label: "Gross profit" }]}
            caption={`Gross profit ${byPeriod(range.granularity)}, ${range.label}`}
          />
        </ChartPanel>
        <ReportTable<SalesBucket>
          caption={`Gross profit ${byPeriod(range.granularity)}`}
          rows={[...period.series].reverse()}
          rowKey={(row) => row.key}
          footerLabel="Total"
          columns={[
            {
              key: "period",
              header: periodWord,
              cell: (row) => bucketLabel(row.key, range.granularity),
            },
            {
              key: "netSales",
              header: "Net sales, PHP",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.netSales),
              footer: formatAmount(totals.netSales),
            },
            {
              key: "cogs",
              header: "COGS, PHP",
              align: "right",
              numeric: true,
              hideBelow: "sm",
              cell: (row) => formatAmount(row.cogs),
              footer: formatAmount(totals.cogs),
            },
            {
              key: "grossProfit",
              header: "Gross profit, PHP",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.grossProfit),
              footer: formatAmount(totals.grossProfit),
            },
            {
              key: "margin",
              header: "Margin",
              align: "right",
              numeric: true,
              cell: (row) => formatShare(row.grossProfit, row.netSales),
              footer: formatShare(totals.grossProfit, totals.netSales),
            },
          ]}
        />
      </ReportSection>

      <ReportSection
        title="By channel"
        description="Marketplace commissions and payment fees are not modelled, so channel margin is before those costs."
      >
        <ChannelTable rows={channels} revenueTotal={totals.revenue} showMargin />
      </ReportSection>
    </ReportFrame>
  );
}
