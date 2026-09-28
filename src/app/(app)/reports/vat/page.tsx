import type { Metadata } from "next";

import { ReportFrame } from "@/features/reports/components/report-frame";
import { KpiGrid, ReportSection, ReportTable } from "@/features/reports/components/report-kit";
import { loadVat } from "@/features/reports/queries";
import { readRange, withParams } from "@/features/reports/schemas";
import { bucketLabel, PERIOD_HEADER } from "@/features/reports/services/date-range";
import type { VatBucket } from "@/features/reports/services/finance";
import { formatAmount, formatPeso } from "@/lib/money";
import { requirePermission } from "@/lib/rbac/guard";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "VAT summary" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function VatPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission("reports.finance");
  const params = await searchParams;
  const now = new Date();
  const range = readRange(params, now, "qtd");
  const { rows, total } = await loadVat(range);
  const periodWord = PERIOD_HEADER[range.granularity];
  const inputVat = total.inputVatPurchases + total.inputVatExpenses;

  return (
    <ReportFrame
      slug="vat"
      user={user}
      now={now}
      range={range}
      comparison="off"
      query={withParams(params, {})}
    >
      <KpiGrid
        items={[
          {
            label: "Vatable sales",
            value: formatPeso(total.vatableSales),
            hint: "Net sales, VAT exclusive",
          },
          {
            label: "Output VAT",
            value: formatPeso(total.outputVat),
            hint: "12% inside sales prices",
          },
          {
            label: "Input VAT",
            value: formatPeso(inputVat),
            hint: `${formatPeso(total.inputVatPurchases)} on supplier bills`,
          },
          {
            label: total.netPayable >= 0 ? "Net VAT payable" : "Excess input VAT",
            value: formatPeso(Math.abs(total.netPayable)),
            tone: total.netPayable < 0 ? "warning" : "default",
            hint: total.netPayable >= 0 ? "Output less input" : "Carried to the next period",
          },
        ]}
      />

      <ReportSection
        title={`By ${periodWord.toLowerCase()}`}
        description="Output VAT follows the sales base, less the VAT inside refunds. Input VAT comes from supplier bills by issue date and from VAT-registered expenses. The quarterly return adds up three of these months."
      >
        <ReportTable<VatBucket>
          caption={`VAT by ${periodWord.toLowerCase()}`}
          rows={[...rows].reverse()}
          rowKey={(row) => row.key}
          footerLabel="Total"
          columns={[
            {
              key: "period",
              header: periodWord,
              cell: (row) => bucketLabel(row.key, range.granularity),
            },
            {
              key: "vatableSales",
              header: "Vatable sales",
              align: "right",
              numeric: true,
              hideBelow: "md",
              cell: (row) => formatAmount(row.vatableSales),
              footer: formatAmount(total.vatableSales),
            },
            {
              key: "outputVat",
              header: "Output VAT",
              align: "right",
              numeric: true,
              cell: (row) => formatAmount(row.outputVat),
              footer: formatAmount(total.outputVat),
            },
            {
              key: "inputPurchases",
              header: "Input, bills",
              align: "right",
              numeric: true,
              hideBelow: "sm",
              cell: (row) => formatAmount(row.inputVatPurchases),
              footer: formatAmount(total.inputVatPurchases),
            },
            {
              key: "inputExpenses",
              header: "Input, expenses",
              align: "right",
              numeric: true,
              hideBelow: "sm",
              cell: (row) => formatAmount(row.inputVatExpenses),
              footer: formatAmount(total.inputVatExpenses),
            },
            {
              key: "net",
              header: "Net payable, PHP",
              align: "right",
              numeric: true,
              cell: (row) => (
                <span className={cn(row.netPayable < 0 && "text-warning")}>
                  {row.netPayable < 0
                    ? `(${formatAmount(-row.netPayable)})`
                    : formatAmount(row.netPayable)}
                </span>
              ),
              footer:
                total.netPayable < 0
                  ? `(${formatAmount(-total.netPayable)})`
                  : formatAmount(total.netPayable),
            },
          ]}
        />
        <p className="text-caption text-ink-subtle">
          Figures in brackets are excess input VAT. This is a working summary for the bookkeeper,
          not a filed return.
        </p>
      </ReportSection>
    </ReportFrame>
  );
}
