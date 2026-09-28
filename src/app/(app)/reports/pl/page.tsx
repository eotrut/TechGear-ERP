import type { Metadata } from "next";
import Link from "next/link";

import { ColumnChart } from "@/components/charts/column-chart";
import { ReportFrame } from "@/features/reports/components/report-frame";
import {
  ChartPanel,
  Delta,
  formatBps,
  KpiGrid,
  ReportSection,
} from "@/features/reports/components/report-kit";
import { hasComparison, loadProfitAndLoss } from "@/features/reports/queries";
import { readRange, withParams } from "@/features/reports/schemas";
import { bucketLabel, byPeriod, describeWindow } from "@/features/reports/services/date-range";
import { marginBps } from "@/features/reports/services/measures";
import type { PlLine } from "@/features/reports/services/pl-rules";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Profit and loss" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Costs print in brackets, the accounting convention, rather than with a minus. */
function amount(value: number): string {
  if (value === 0) return "0.00";
  if (value < 0) return `(${formatAmount(-value)})`;
  return formatAmount(value);
}

export default async function ProfitAndLossPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.finance");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now, "12m");
  const [pl, comparable] = await Promise.all([loadProfitAndLoss(range), hasComparison(range)]);
  const { statement, previousStatement } = pl;
  const previousByKey = new Map(previousStatement.lines.map((line) => [line.key, line.amount]));
  const against = "vs prior period";

  return (
    <ReportFrame
      slug="pl"
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
            value: formatPeso(statement.netSales),
            delta: {
              current: statement.netSales,
              previous: previousStatement.netSales,
              against,
            },
          },
          {
            label: "Gross profit",
            value: formatPeso(statement.grossProfit),
            hint: `${formatBps(marginBps(statement.grossProfit, statement.netSales))} gross margin`,
          },
          {
            label: "Operating expenses",
            value: formatPeso(statement.operatingExpenses),
            delta: {
              current: statement.operatingExpenses,
              previous: previousStatement.operatingExpenses,
              against,
              upIsGood: false,
            },
          },
          {
            label: "Operating profit",
            value: formatPeso(statement.operatingProfit),
            tone: statement.operatingProfit < 0 ? "critical" : "default",
            hint: `${formatBps(marginBps(statement.operatingProfit, statement.netSales))} of net sales`,
          },
        ]}
      />

      <ReportSection
        title={`Profit ${byPeriod(range.granularity)}`}
        description="Gross profit, and what is left of it once operating expenses and stock losses are paid."
      >
        <ChartPanel>
          <ColumnChart
            data={pl.months.map((month) => ({
              key: month.key,
              label: bucketLabel(month.key, range.granularity),
              grossProfit: month.statement.grossProfit,
              operatingProfit: month.statement.operatingProfit,
            }))}
            series={[
              { key: "grossProfit", label: "Gross profit" },
              { key: "operatingProfit", label: "Operating profit" },
            ]}
            caption={`Gross and operating profit ${byPeriod(range.granularity)}, ${range.label}`}
          />
        </ChartPanel>
      </ReportSection>

      <ReportSection
        title="Statement"
        description="VAT exclusive throughout. Gross profit here is the gross profit report's figure for the same range."
      >
        <div className="relative overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full text-body-sm">
            <caption className="sr-only">Profit and loss statement</caption>
            <thead>
              <tr className="border-b border-hairline bg-surface-1 text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase">
                <th scope="col" className="px-3 py-2 text-left">
                  PHP
                </th>
                <th scope="col" className="px-3 py-2 text-right whitespace-nowrap">
                  This period
                </th>
                {comparable ? (
                  <>
                    <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell">
                      Prior period
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">
                      Change
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line: PlLine, index) => {
                const heading =
                  line.key.startsWith("expense.") &&
                  !statement.lines[index - 1]?.key.startsWith("expense.");
                return (
                  <PlRow
                    key={line.key}
                    line={line}
                    prior={comparable ? (previousByKey.get(line.key) ?? 0) : null}
                    strong={line.kind === "subtotal" || line.kind === "total"}
                    heading={heading ? "Operating expenses" : null}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-caption text-ink-subtle">
          Expenses come from the{" "}
          <Link
            href="/expenses"
            className="text-accent-strong underline decoration-accent-strong/40 underline-offset-2 hover:decoration-accent-strong"
          >
            expense register
          </Link>{" "}
          net of input VAT. Stock lines come from the ledger at moving-average cost.
          {comparable ? ` Prior period: ${describeWindow(range.previous)}.` : ""}
        </p>
      </ReportSection>
    </ReportFrame>
  );
}

function PlRow({
  line,
  prior,
  strong,
  heading,
}: {
  line: PlLine;
  /** Null when there is no honest prior period to show. */
  prior: number | null;
  strong: boolean;
  heading: string | null;
}) {
  const indent = line.kind === "cost" && line.key !== "cogs";
  return (
    <>
      {heading ? (
        <tr className="border-b border-hairline">
          <th
            scope="rowgroup"
            colSpan={prior === null ? 2 : 4}
            className="px-3 pt-4 pb-1.5 text-left text-[11px] font-medium tracking-[0.06em] text-ink-subtle uppercase"
          >
            {heading}
          </th>
        </tr>
      ) : null}
      <tr
        className={cn(
          "border-b border-hairline last:border-b-0",
          strong && "bg-surface-1",
          line.kind === "total" && "border-t border-t-hairline-strong",
        )}
      >
        <th
          scope="row"
          className={cn(
            "px-3 py-2 text-left font-normal",
            indent && "pl-6",
            strong ? "font-medium text-ink" : "text-ink-muted",
          )}
        >
          {line.label}
          {line.note ? (
            <span className="block text-caption font-normal text-ink-subtle">{line.note}</span>
          ) : null}
        </th>
        <td
          data-numeric
          className={cn(
            "px-3 py-2 text-right align-top font-mono whitespace-nowrap",
            strong ? "font-medium text-ink" : "text-ink",
            line.kind === "total" && line.amount < 0 && "text-danger",
          )}
        >
          {amount(line.amount)}
        </td>
        {prior === null ? null : (
          <>
            <td
              data-numeric
              className="hidden px-3 py-2 text-right align-top font-mono whitespace-nowrap text-ink-subtle sm:table-cell"
            >
              {amount(prior)}
            </td>
            <td className="hidden px-3 py-2 text-right align-top whitespace-nowrap md:table-cell">
              {line.amount === 0 && prior === 0 ? null : (
                <Delta
                  current={Math.abs(line.amount)}
                  previous={Math.abs(prior)}
                  upIsGood={line.kind !== "cost"}
                  against=""
                />
              )}
            </td>
          </>
        )}
      </tr>
    </>
  );
}
